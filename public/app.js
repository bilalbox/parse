document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const viewDashboard = document.getElementById('view-dashboard');
    const viewArticle = document.getElementById('view-article');
    const viewClipping = document.getElementById('view-clipping');
    const clippingSpinner = document.getElementById('clipping-spinner');
    const clippingIcon = document.getElementById('clipping-icon');
    const clippingStatus = document.getElementById('clipping-status');
    const clippingError = document.getElementById('clipping-error');
    const clippingActions = document.getElementById('clipping-actions');
    const btnClipRetry = document.getElementById('btn-clip-retry');
    const btnClipLibrary = document.getElementById('btn-clip-library');
    const parseForm = document.getElementById('parse-form');
    const urlInput = document.getElementById('url-input');
    const submitBtn = document.getElementById('submit-btn');
    const btnText = submitBtn.querySelector('.btn-text');
    const spinner = submitBtn.querySelector('.spinner');
    const errorMsg = document.getElementById('error-message');
    const articlesGrid = document.getElementById('articles-grid');
    const searchInput = document.getElementById('search-input');
    const readerContent = document.getElementById('reader-content');
    const btnBack = document.getElementById('btn-back');
    const btnUnsubscribe = document.getElementById('btn-unsubscribe');
    const btnSummarize = document.getElementById('btn-summarize');
    const btnArchive = document.getElementById('btn-archive');
    const btnDelete = document.getElementById('btn-delete');
    const filterToggle = document.getElementById('filter-toggle');
    const themeToggle = document.getElementById('theme-toggle');
    const settingsBtn = document.getElementById('settings-btn');
    const tokenModal = document.getElementById('token-modal');
    const tokenInput = document.getElementById('token-input');
    const tokenSaveBtn = document.getElementById('token-save-btn');
    const tokenError = document.getElementById('token-error');
    const settingsCloseBtn = document.getElementById('settings-close-btn');
    const tokenCancelBtn = document.getElementById('token-cancel-btn');
    const btnTts = document.getElementById('btn-tts');

    // State
    let currentFontSize = 1.15;
    let isSerif = false;
    let articlesCache = [];
    let onTokenSaved = null;
    let currentArticleId = null;
    let currentArticleArchived = false;
    // Which library view is shown: 'active' (default) or 'archived'.
    let currentFilter = 'active';
    // View cross-fade duration; must match the CSS .view transition.
    const FADE_MS = 300;
    // Runtime cache name — must match RUNTIME_CACHE in public/sw.js.
    const RUNTIME_CACHE = 'parse-runtime-v1';

    let ttsController = null;

    // Helper: Non-destructive DOM sentence splitter for pixel-perfect highlights
    function prepareTtsContent(container) {
        const sentences = [];
        let sentenceCount = 0;
        
        const blockSelector = 'p, li, blockquote, h1, h2, h3, h4, h5, h6, summary';
        const skipSelector = '.parsed-action-links, .parsed-rescued-images';

        // Visit every text node under the container in document order, skipping
        // the appended "Links from this email" / "Images from this email" /
        // summary sections (which aren't part of the article body to be read).
        const eachTextNode = (cb) => {
            const walk = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
            let node;
            while (node = walk.nextNode()) {
                if (node.parentElement && node.parentElement.closest(skipSelector)) continue;
                cb(node);
            }
        };

        // Group text nodes by their owning block, where a node's owner is its
        // nearest block-level ancestor. Each text node therefore belongs to
        // exactly one block — the innermost — so the same text can never be
        // voiced twice. This is what keeps quotes from repeating: a <blockquote>
        // wrapping a <p> contributes no text of its own (the <p> owns it), while
        // a <blockquote> holding both loose text and a nested <p> contributes
        // its loose text once AND lets the <p> contribute separately. Runs stay
        // contiguous in document order, so a block's text split around a nested
        // block reads in order and never merges across it.
        const runs = [];
        let currentRun = null;
        eachTextNode((textNode) => {
            // Loose text with no block ancestor (e.g. a figure caption, or stray
            // text directly under the container) is intentionally not voiced.
            const owner = textNode.parentElement && textNode.parentElement.closest(blockSelector);
            if (!owner) return;
            if (!currentRun || currentRun.owner !== owner) {
                currentRun = { owner, nodes: [] };
                runs.push(currentRun);
            }
            currentRun.nodes.push(textNode);
        });

        // Degenerate container with no block elements at all: voice its text as
        // one run so a bare-text article isn't left silent.
        if (runs.length === 0) {
            const nodes = [];
            eachTextNode((node) => nodes.push(node));
            if (nodes.length) runs.push({ owner: container, nodes });
        }
        
        const splitRegex = /[^.!?]+[.!?]+(?:\s+|\u200b|$)|[^.!?]+(?:\s+|\u200b|$)/g;
        
        runs.forEach(run => {
            const textNodes = run.nodes;
            const text = textNodes.map(n => n.textContent).join('');
            const matches = text.match(splitRegex);
            if (!matches || matches.length === 0) return;

            const blockSentences = matches.map(m => m.trim()).filter(m => m.length > 0);
            if (blockSentences.length === 0) return;

            let charOffset = 0;
            let sentenceIdx = 0;
            let currentSentenceText = blockSentences[sentenceIdx];
            let currentSentenceStart = text.indexOf(currentSentenceText, charOffset);
            
            textNodes.forEach(node => {
                const nodeText = node.textContent;
                const nodeLength = nodeText.length;
                const nodeStart = charOffset;
                charOffset += nodeLength;
                
                const parent = node.parentNode;
                const fragment = document.createDocumentFragment();
                
                let nodeOffset = 0;
                while (nodeOffset < nodeLength) {
                    if (sentenceIdx >= blockSentences.length) {
                        fragment.appendChild(document.createTextNode(nodeText.substring(nodeOffset)));
                        break;
                    }
                    
                    const sText = blockSentences[sentenceIdx];
                    const sStartInBlock = text.indexOf(sText, currentSentenceStart);
                    const sEndInBlock = sStartInBlock + sText.length;
                    
                    const absNodeOffset = nodeStart + nodeOffset;
                    
                    if (absNodeOffset < sStartInBlock) {
                        const len = Math.min(sStartInBlock - absNodeOffset, nodeLength - nodeOffset);
                        fragment.appendChild(document.createTextNode(nodeText.substring(nodeOffset, nodeOffset + len)));
                        nodeOffset += len;
                    } else if (absNodeOffset >= sStartInBlock && absNodeOffset < sEndInBlock) {
                        const len = Math.min(sEndInBlock - absNodeOffset, nodeLength - nodeOffset);
                        const matchText = nodeText.substring(nodeOffset, nodeOffset + len);
                        
                        const span = document.createElement('span');
                        span.className = 'tts-sentence';
                        const globalIdx = sentenceCount + sentenceIdx;
                        span.dataset.sentenceIndex = globalIdx;
                        span.textContent = matchText;
                        fragment.appendChild(span);
                        
                        if (!sentences[globalIdx]) {
                            sentences[globalIdx] = {
                                text: sText,
                                elements: []
                            };
                        }
                        sentences[globalIdx].elements.push(span);
                        
                        nodeOffset += len;
                        
                        if (absNodeOffset + len >= sEndInBlock) {
                            sentenceIdx++;
                            if (sentenceIdx < blockSentences.length) {
                                currentSentenceText = blockSentences[sentenceIdx];
                                currentSentenceStart = text.indexOf(currentSentenceText, sEndInBlock);
                            }
                        }
                    } else {
                        sentenceIdx++;
                        if (sentenceIdx < blockSentences.length) {
                            currentSentenceText = blockSentences[sentenceIdx];
                            currentSentenceStart = text.indexOf(currentSentenceText, absNodeOffset);
                        } else {
                            fragment.appendChild(document.createTextNode(nodeText.substring(nodeOffset)));
                            break;
                        }
                    }
                }
                
                parent.replaceChild(fragment, node);
            });
            
            sentenceCount += blockSentences.length;
        });
        
        return sentences;
    }

    // Class: client-side Text-to-Speech controller. Narration is synthesized
    // entirely in the browser via the Web Speech API, using a voice installed on
    // the device — there is no server-rendered audio. Arabic Articles are not
    // narrated (the player is hidden for them). See docs/adr/0001.
    class TTSController {
        constructor() {
            this.sentences = [];
            this.currentIndex = -1;
            this.isPlaying = false;
            this.selectedVoice = '';   // voice.name of the chosen on-device voice
            this.selectedSpeed = 1.0;
            this.hasVoice = false;     // false when the device has no usable voice
            this.currentUtterance = null; // tracked so cancel() can't fire a stale onend
            this.articleId = null;
            this.articleTitle = '';
            this.articleAuthor = '';
            this.featuredImage = '';

            this.playerPanel = document.getElementById('tts-player');
            this.playPauseBtn = document.getElementById('player-play-pause');
            this.progressBar = document.getElementById('player-progress');
            this.progressArea = document.getElementById('player-progress-area');
            this.titleEl = document.getElementById('player-title');
            this.authorEl = document.getElementById('player-author');
            this.speedSelect = document.getElementById('player-speed');
            this.voiceSelect = document.getElementById('player-voice');
            this.closeBtn = document.getElementById('player-close');
            
            this.prevBtn = document.getElementById('player-prev');
            this.nextBtn = document.getElementById('player-next');
            this.rewindBtn = document.getElementById('player-rewind');
            this.forwardBtn = document.getElementById('player-forward');
            
            this.isArabicContent = false;

            this.initListeners();

            // Re-populate voices when browser speech voices are loaded asynchronously
            if ('speechSynthesis' in window) {
                window.speechSynthesis.onvoiceschanged = () => {
                    this.initVoices();
                };
            }

            this.initVoices();
        }

        initListeners() {
            this.playPauseBtn.addEventListener('click', () => this.togglePlay());
            this.closeBtn.addEventListener('click', () => this.hidePlayer());
            
            this.speedSelect.addEventListener('change', (e) => {
                this.selectedSpeed = parseFloat(e.target.value);
                // SpeechSynthesis can't retune a sentence mid-utterance, so if we're
                // playing, restart the current sentence at the new rate.
                if (this.isPlaying) {
                    this.playSentence(this.currentIndex);
                }
            });

            this.voiceSelect.addEventListener('change', (e) => {
                this.selectedVoice = e.target.value;
                localStorage.setItem('tts_voice', this.selectedVoice);
                if (this.isPlaying) {
                    this.playSentence(this.currentIndex);
                }
            });
            
            this.prevBtn.addEventListener('click', () => this.prevSentence());
            this.nextBtn.addEventListener('click', () => this.nextSentence());
            this.rewindBtn.addEventListener('click', () => this.prevSentence());
            this.forwardBtn.addEventListener('click', () => this.nextSentence());

            this.progressArea.addEventListener('click', (e) => {
                if (this.sentences.length === 0) return;
                const rect = this.progressArea.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const width = rect.width;
                const pct = clickX / width;
                const targetIdx = Math.floor(pct * this.sentences.length);
                const clampedIdx = Math.max(0, Math.min(targetIdx, this.sentences.length - 1));
                this.jumpToSentence(clampedIdx);
            });

        }

        // On-device speech voices only. Network ("online") voices are excluded so
        // narration works offline. Returns [] when the device has no installed voice.
        usableVoices() {
            if (!('speechSynthesis' in window)) return [];
            return window.speechSynthesis.getVoices().filter(v => v.localService);
        }

        initVoices() {
            const voices = this.usableVoices();
            this.hasVoice = voices.length > 0;
            this.voiceSelect.innerHTML = '';

            if (!this.hasVoice) {
                // No installed voice — narration can't run. The play control surfaces
                // an install prompt; here we just reflect the empty state.
                const option = document.createElement('option');
                option.textContent = 'No voice installed';
                this.voiceSelect.appendChild(option);
                this.voiceSelect.disabled = true;
                return;
            }

            this.voiceSelect.disabled = false;
            voices.forEach(voice => {
                const option = document.createElement('option');
                option.value = voice.name;
                option.textContent = `🗣️ ${voice.name} (${voice.lang})`;
                this.voiceSelect.appendChild(option);
            });

            const stored = localStorage.getItem('tts_voice');
            if (stored && voices.some(v => v.name === stored)) {
                this.selectedVoice = stored;
            } else {
                // Prefer a voice for the page language, otherwise the first available.
                const pageLang = (document.documentElement.lang || 'en').slice(0, 2).toLowerCase();
                const match = voices.find(v => v.lang.toLowerCase().startsWith(pageLang));
                this.selectedVoice = (match || voices[0]).name;
            }
            this.voiceSelect.value = this.selectedVoice;
        }

        // Voices often aren't loaded on first interaction; re-check before concluding
        // none exist. Returns whether a usable voice is now available.
        ensureVoices() {
            if (!this.hasVoice) this.initVoices();
            return this.hasVoice;
        }

        // Reset the play/pause button glyph + label to reflect playback state.
        setPlayButton(playing) {
            this.playPauseBtn.textContent = playing ? '⏸' : '▶';
            this.playPauseBtn.title = playing ? 'Pause' : 'Play';
        }

        setMediaPlaybackState(state) {
            if ('mediaSession' in navigator) {
                navigator.mediaSession.playbackState = state;
            }
        }

        cancelLocalSpeech() {
            // Detach the in-flight utterance's handlers first: speechSynthesis.cancel()
            // dispatches the previous utterance's onend asynchronously, which would
            // otherwise advance currentIndex and skip the sentence we're restarting.
            if (this.currentUtterance) {
                this.currentUtterance.onend = null;
                this.currentUtterance.onerror = null;
                this.currentUtterance = null;
            }
            if ('speechSynthesis' in window) {
                window.speechSynthesis.cancel();
            }
        }

        setupMediaSession() {
            if ('mediaSession' in navigator) {
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: this.articleTitle,
                    artist: this.articleAuthor || 'Parse Reader',
                    album: 'Articles',
                    artwork: [
                        { src: this.featuredImage || '/icon.svg', sizes: '512x512', type: 'image/svg+xml' }
                    ]
                });

                navigator.mediaSession.setActionHandler('play', () => this.play());
                navigator.mediaSession.setActionHandler('pause', () => this.pause());
                navigator.mediaSession.setActionHandler('previoustrack', () => this.prevSentence());
                navigator.mediaSession.setActionHandler('nexttrack', () => this.nextSentence());
                navigator.mediaSession.setActionHandler('seekbackward', () => this.prevSentence());
                navigator.mediaSession.setActionHandler('seekforward', () => this.nextSentence());
            }
        }

        parseArticle(articleId, title, author, contentHtml) {
            this.stop();
            this.articleId = articleId;
            this.articleTitle = title;
            this.articleAuthor = author;

            const temp = document.createElement('div');
            temp.innerHTML = contentHtml;
            const img = temp.querySelector('.featured-image-container img, img');
            this.featuredImage = img ? img.src : '';

            const body = document.querySelector('#tts-content-wrapper');
            if (!body) return;

            // Detect if content is Arabic
            const arabicPattern = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
            this.isArabicContent = arabicPattern.test(body.textContent || '') || arabicPattern.test(title || '');

            // Apply RTL settings
            const readerEl = document.getElementById('reader-content');
            if (readerEl) {
                readerEl.classList.toggle('rtl-content', this.isArabicContent);
                if (this.isArabicContent) {
                    readerEl.setAttribute('dir', 'rtl');
                } else {
                    readerEl.removeAttribute('dir');
                }
            }

            this.sentences = prepareTtsContent(body);
            this.currentIndex = 0;
            this.updateProgress();

            this.titleEl.textContent = this.articleTitle;
            this.authorEl.textContent = this.articleAuthor ? `By ${this.articleAuthor}` : 'Unknown Author';

            body.querySelectorAll('.tts-sentence').forEach(el => {
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const idx = parseInt(el.dataset.sentenceIndex);
                    if (!isNaN(idx)) {
                        this.jumpToSentence(idx);
                    }
                });
            });
        }

        showPlayer() {
            this.playerPanel.classList.remove('hidden');
            setTimeout(() => this.playerPanel.classList.add('active'), 50);
        }

        hidePlayer() {
            this.stop();
            this.playerPanel.classList.remove('active');
            setTimeout(() => this.playerPanel.classList.add('hidden'), 400);
        }

        togglePlay() {
            if (!this.ensureVoices()) {
                showVoiceInstallPrompt();
                return;
            }
            if (this.isPlaying) {
                this.pause();
            } else {
                this.play();
            }
        }

        play() {
            if (this.sentences.length === 0 || !this.hasVoice) return;
            this.isPlaying = true;
            this.setupMediaSession();
            this.playSentence(this.currentIndex);
        }

        pause() {
            // SpeechSynthesis fires no audio events, so reset the UI by hand.
            this.isPlaying = false;
            this.cancelLocalSpeech();
            this.setPlayButton(false);
            this.setMediaPlaybackState('paused');
        }

        stop() {
            this.isPlaying = false;
            this.cancelLocalSpeech();
            this.clearHighlight();
            this.currentIndex = 0;
            this.updateProgress();
            this.setPlayButton(false);
            this.setMediaPlaybackState('none');
        }

        jumpToSentence(index) {
            this.clearHighlight();
            this.currentIndex = index;
            this.updateProgress();
            if (this.isPlaying) {
                this.playSentence(index);
            } else {
                this.highlightSentence(index);
                const el = this.sentences[index]?.elements[0];
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }

        prevSentence() {
            if (this.currentIndex > 0) {
                this.jumpToSentence(this.currentIndex - 1);
            }
        }

        nextSentence() {
            if (this.currentIndex < this.sentences.length - 1) {
                this.jumpToSentence(this.currentIndex + 1);
            } else {
                this.stop();
            }
        }

        clearHighlight() {
            if (this.currentIndex >= 0 && this.currentIndex < this.sentences.length) {
                this.sentences[this.currentIndex].elements.forEach(el => {
                    el.classList.remove('active-sentence');
                });
            }
        }

        highlightSentence(index) {
            if (index >= 0 && index < this.sentences.length) {
                this.sentences[index].elements.forEach(el => {
                    el.classList.add('active-sentence');
                });
            }
        }

        updateProgress() {
            if (this.sentences.length === 0) {
                this.progressBar.style.width = '0%';
                return;
            }
            const pct = (this.currentIndex / this.sentences.length) * 100;
            this.progressBar.style.width = `${pct}%`;
        }

        playSentence(index) {
            if (index < 0 || index >= this.sentences.length) {
                this.stop();
                return;
            }

            const sentence = this.sentences[index];
            this.highlightSentence(index);
            
            const firstEl = sentence.elements[0];
            if (firstEl) {
                firstEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }

            this.updateProgress();

            if (!('speechSynthesis' in window)) return;

            // Cancel any in-flight utterance, then synthesize this sentence on-device.
            this.cancelLocalSpeech();

            const utterance = new SpeechSynthesisUtterance(sentence.text);
            this.currentUtterance = utterance;
            const voice = window.speechSynthesis.getVoices().find(v => v.name === this.selectedVoice);
            if (voice) {
                utterance.voice = voice;
                utterance.lang = voice.lang;
            }
            utterance.rate = this.selectedSpeed;

            // SpeechSynthesis emits no media events, so drive the UI by hand.
            this.isPlaying = true;
            this.setPlayButton(true);
            this.setMediaPlaybackState('playing');

            utterance.onend = () => {
                if (this.isPlaying && this.currentIndex === index) {
                    this.clearHighlight();
                    this.currentIndex++;
                    if (this.currentIndex < this.sentences.length) {
                        this.playSentence(this.currentIndex);
                    } else {
                        this.stop();
                    }
                }
            };

            utterance.onerror = (e) => {
                console.error('SpeechSynthesis error:', e);
                if (e.error !== 'interrupted' && this.isPlaying) {
                    this.stop();
                }
            };

            window.speechSynthesis.speak(utterance);
        }
    }

    // ── Auth Token Management ─────────────────────────────────────────────────

    function getToken() {
        return localStorage.getItem('parse_token') || '';
    }

    function updateAuthClass() {
        document.body.classList.toggle('authed', !!getToken());
    }

    function authHeaders(extra = {}) {
        const token = getToken();
        const headers = { ...extra };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        return headers;
    }

    class AuthError extends Error {}

    let toastContainer = null;
    function ensureToastContainer() {
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'toast-container';
            document.body.appendChild(toastContainer);
        }
        return toastContainer;
    }

    function removeToast(toast) {
        toast.classList.add('toast-out');
        toast.addEventListener('animationend', () => toast.remove(), { once: true });
    }

    function dismissToast(toast, duration) {
        setTimeout(() => removeToast(toast), duration);
    }

    function showToast(message, type = 'info', duration = 3000) {
        const toast = document.createElement('div');
        toast.className = `toast${type === 'error' ? ' toast-error' : ''}`;
        toast.textContent = message;
        ensureToastContainer().appendChild(toast);
        dismissToast(toast, duration);
    }

    // Toast carrying a clickable link (e.g. a mailto: unsubscribe address the
    // user must action from their own mail client). Persists until dismissed —
    // it shouldn't vanish before the user has a chance to click.
    function showLinkToast(message, linkText, href) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        const label = document.createElement('span');
        label.textContent = `${message} `;
        const link = document.createElement('a');
        link.className = 'toast-link';
        link.href = href;
        link.textContent = linkText;
        const close = document.createElement('button');
        close.className = 'toast-close';
        close.setAttribute('aria-label', 'Dismiss');
        close.textContent = '×';
        close.addEventListener('click', () => removeToast(toast));
        toast.append(label, link, close);
        ensureToastContainer().appendChild(toast);
    }

    // Narration needs an on-device voice; when none is installed we can't speak,
    // so point the user at their OS install steps instead of failing silently.
    function showVoiceInstallPrompt() {
        const ua = navigator.userAgent;
        let hint;
        if (/Android/i.test(ua)) {
            hint = 'Install one in Settings → System → Languages & input → Text-to-speech output → install voice data.';
        } else if (/Windows/i.test(ua)) {
            hint = 'Install one in Settings → Time & Language → Language & region → add a language with a Speech pack.';
        } else {
            hint = 'Install a text-to-speech voice in your operating system settings.';
        }
        showToast(`No speech voice is installed on this device. ${hint}`, 'error', 8000);
    }

    // Writes (add / archive / delete / summarize) require the server. Offline they
    // can't run, so guard them with a clear message rather than a failed request.
    function requireOnline(action) {
        if (navigator.onLine) return true;
        showToast(`You're offline — ${action} needs a connection.`, 'error');
        return false;
    }

    async function authFetch(url, options = {}) {
        const res = await fetch(url, {
            ...options,
            headers: authHeaders(options.headers),
        });
        if (res.status === 401) {
            showTokenModal(() => loadArticles());
            throw new AuthError('Authentication required — enter your token.');
        }
        return res;
    }

    function showTokenModal(callback) {
        onTokenSaved = callback || null;
        tokenError.textContent = '';
        tokenInput.value = getToken();
        tokenModal.classList.remove('hidden');
        tokenInput.focus();
    }

    function hideTokenModal() {
        if (!getToken()) {
            tokenError.textContent = 'An API Token is required to connect to the Parse backend.';
            return;
        }
        tokenModal.classList.add('hidden');
        onTokenSaved = null;
    }

    tokenSaveBtn.addEventListener('click', () => {
        const value = tokenInput.value.trim();
        if (!value) {
            tokenError.textContent = 'Token cannot be empty.';
            return;
        }
        localStorage.setItem('parse_token', value);

        updateAuthClass();
        hideTokenModal();
        if (onTokenSaved) onTokenSaved();
    });

    tokenInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') tokenSaveBtn.click();
    });

    if (settingsCloseBtn) {
        settingsCloseBtn.addEventListener('click', () => hideTokenModal());
    }
    
    if (tokenCancelBtn) {
        tokenCancelBtn.addEventListener('click', () => hideTokenModal());
    }

    tokenModal.addEventListener('click', (e) => {
        if (e.target === tokenModal) {
            hideTokenModal();
        }
    });

    settingsBtn.addEventListener('click', () => showTokenModal());

    // ── Initialization ─────────────────────────────────────────────────────────

    initTheme();

    updateAuthClass();

    // Reflect connectivity in the UI and keep it current.
    reflectOnline();
    window.addEventListener('online', reflectOnline);
    window.addEventListener('offline', reflectOnline);

    // Instantiate TTS Engine
    ttsController = new TTSController();

    // Handle PWA Web Share Target: /share?url=...
    if (location.pathname === '/share') {
        const params = new URLSearchParams(location.search);
        // The share_target params send `url`; `text` sometimes carries the URL on Android
        const sharedUrl = params.get('url') || params.get('text') || '';
        history.replaceState(null, '', '/');

        if (sharedUrl) {
            if (!getToken()) {
                showTokenModal(() => { updateAuthClass(); triggerClipping(sharedUrl); });
            } else {
                triggerClipping(sharedUrl);
            }
        } else {
            showDashboard();
        }
    } else if (!getToken()) {
        showTokenModal(() => { updateAuthClass(); loadArticles(); });
    } else {
        loadArticles();
    }

    async function triggerClipping(url) {
        if (!requireOnline('clipping an article')) { showDashboard(); return; }
        // Show clipping view
        viewDashboard.classList.remove('active');
        viewArticle.classList.remove('active');
        viewClipping.classList.add('active');

        clippingSpinner.classList.remove('hidden');
        clippingIcon.classList.add('hidden');
        clippingError.classList.add('hidden');
        clippingActions.classList.add('hidden');
        clippingStatus.textContent = 'Clipping...';

        try {
            const res = await authFetch('/api/queue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url }),
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to queue article');
            }

            // Success
            clippingSpinner.classList.add('hidden');
            clippingIcon.classList.remove('hidden');
            clippingStatus.textContent = 'Saved!';
            clippingActions.classList.remove('hidden');
            btnClipRetry.classList.add('hidden');

            // Try to close, fallback to library button
            setTimeout(() => {
                try {
                    window.close();
                } catch (e) {}
            }, 1500);

        } catch (err) {
            clippingSpinner.classList.add('hidden');
            clippingStatus.textContent = 'Failed to clip';
            clippingError.textContent = err instanceof AuthError ? 'Authentication error' : err.message;
            clippingError.classList.remove('hidden');
            clippingActions.classList.remove('hidden');
            btnClipRetry.classList.remove('hidden');
            btnClipRetry.onclick = () => triggerClipping(url);
        }
    }

    // ── Event Listeners ────────────────────────────────────────────────────────
    
    btnClipLibrary.addEventListener('click', () => {
        viewClipping.classList.remove('active');
        showDashboard();
    });

    parseForm.addEventListener('submit', handleParse);
    btnBack.addEventListener('click', showDashboard);
    btnUnsubscribe.addEventListener('click', () => runUnsubscribe(currentArticleId, btnUnsubscribe));
    btnSummarize.addEventListener('click', () => runSummarize(currentArticleId, btnSummarize));
    btnArchive.addEventListener('click', () => archiveArticle(currentArticleId, !currentArticleArchived, btnArchive, true));
    btnDelete.addEventListener('click', () => deleteArticle(currentArticleId, btnDelete, true));
    searchInput.addEventListener('input', handleSearch);

    // Bind Listen Aloud button
    btnTts.addEventListener('click', () => {
        if (!ttsController) return;
        if (!ttsController.ensureVoices()) {
            showVoiceInstallPrompt();
            return;
        }
        ttsController.showPlayer();
        ttsController.play();
    });

    filterToggle.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.filter === currentFilter) return;
            currentFilter = btn.dataset.filter;
            filterToggle.querySelectorAll('.filter-btn').forEach(b =>
                b.classList.toggle('active', b === btn));
            searchInput.value = '';
            loadArticles();
        });
    });
    themeToggle.addEventListener('click', toggleTheme);

    // Reader Controls
    document.querySelectorAll('.font-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const action = e.target.dataset.action;
            if (action === 'increase') currentFontSize += 0.1;
            if (action === 'decrease') currentFontSize -= 0.1;
            if (action === 'serif') {
                isSerif = !isSerif;
                readerContent.className = `reader-content ${isSerif ? 'typography-serif' : 'typography-sans'}`;
                e.target.style.background = isSerif ? 'var(--bg-secondary)' : 'transparent';
            }
            readerContent.style.fontSize = `${currentFontSize}rem`;
        });
    });

    // ── Theme ──────────────────────────────────────────────────────────────────

    function initTheme() {
        const saved = localStorage.getItem('theme') || 'dark';
        document.documentElement.setAttribute('data-theme', saved);
    }

    function toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
    }

    // ── Navigation ─────────────────────────────────────────────────────────────

    function showDashboard() {
        if (ttsController) ttsController.stop();
        viewArticle.classList.remove('active');
        viewClipping.classList.remove('active');
        setTimeout(() => viewDashboard.classList.add('active'), FADE_MS);
        history.pushState(null, '', '/');
        document.title = 'Parse | Premium Edge Reading';
    }

    function showArticle() {
        viewDashboard.classList.remove('active');
        viewClipping.classList.remove('active');
        setTimeout(() => viewArticle.classList.add('active'), FADE_MS);
        window.scrollTo(0, 0);
    }

    // ── API ────────────────────────────────────────────────────────────────────

    async function loadArticles() {
        try {
            const qs = currentFilter === 'archived' ? '?archived=1' : '';
            const res = await authFetch(`/api/articles${qs}`);
            if (!res.ok) throw new Error('Failed to fetch library');
            const articles = await res.json();
            articlesCache = articles;
            renderArticles(articles);
            // Mirror the active library into the offline cache so it stays readable
            // without a connection (see docs/adr/0002).
            if (currentFilter === 'active') warmOfflineCache(articles);
        } catch (err) {
            if (!(err instanceof AuthError)) {
                articlesGrid.innerHTML = `<p class="error-msg">Could not load library. Ensure the worker is running with D1 configured.</p>`;
            }
        }
    }

    // Background-fetch every active Article's content + media so the service worker
    // caches them for offline reading, then evict cache entries for Articles that
    // have left the library. No-op when offline or unsupported.
    async function warmOfflineCache(articles) {
        if (!navigator.onLine || !('caches' in window)) return;
        const keep = new Set(['/', '/index.html', '/app.js', '/style.css', '/manifest.json', '/icon.svg']);
        try {
            const cache = await caches.open(RUNTIME_CACHE);
            for (const article of articles) {
                const contentUrl = `/api/articles/${article.id}`;
                keep.add(contentUrl);
                try {
                    // Use the already-cached copy when present; only hit the network
                    // for Articles we haven't stored yet.
                    let res = await cache.match(contentUrl);
                    if (!res) {
                        res = await authFetch(contentUrl);
                        if (!res.ok) continue;
                    }
                    const data = await res.clone().json();
                    const payload = JSON.parse(data.content);
                    // Discover and warm the Article's media so images render offline.
                    const mediaUrls = (payload.content.match(/\/media\/[A-Za-z0-9._-]+/g) || []);
                    for (const m of mediaUrls) {
                        keep.add(m);
                        if (!(await cache.match(m))) {
                            try { await fetch(m); } catch {}
                        }
                    }
                } catch {}
            }
            // Evict runtime-cached responses for Articles/media no longer in the library.
            for (const request of await cache.keys()) {
                const path = new URL(request.url).pathname;
                if ((path.startsWith('/api/articles/') || path.startsWith('/media/')) && !keep.has(path)) {
                    cache.delete(request);
                }
            }
        } catch (e) {
            // Storage quota or transient failures shouldn't break the library view.
            console.warn('Offline cache warm failed:', e);
        }
    }

    // Disable server-dependent controls and flag the UI while offline.
    function reflectOnline() {
        const offline = !navigator.onLine;
        document.body.classList.toggle('offline', offline);
        [submitBtn, btnArchive, btnDelete, btnSummarize, btnUnsubscribe].forEach(b => {
            if (b) b.disabled = offline;
        });
    }

    function renderArticles(articles) {
        if (articles.length === 0) {
            const empty = currentFilter === 'archived'
                ? 'No archived articles yet.'
                : 'Your library is empty. Start by parsing an article above!';
            articlesGrid.innerHTML = `<p style="color: var(--text-secondary); grid-column: 1/-1; text-align: center; padding: 2rem;">${empty}</p>`;
            return;
        }

        const archiveLabel = currentFilter === 'archived' ? 'Unarchive' : 'Archive';
        articlesGrid.innerHTML = articles.map(article => `
            <div class="article-card" data-id="${article.id}">
                <h3 class="card-title">${article.title}</h3>
                <div class="card-meta">
                    <span class="author">${article.author || 'Unknown'}</span>
                    <span class="date">${new Date(article.created_at).toLocaleDateString()}</span>
                </div>
                <div class="card-actions">
                    ${article.unsubscribe_link ? `<button class="card-btn card-unsub" data-id="${article.id}" title="Unsubscribe from this newsletter">Unsubscribe</button>` : ''}
                    <button class="card-btn card-archive" data-id="${article.id}">${archiveLabel}</button>
                    <button class="card-btn card-delete" data-id="${article.id}">Delete</button>
                </div>
            </div>
        `).join('');

        document.querySelectorAll('.article-card').forEach(card => {
            card.addEventListener('click', () => loadArticleView(card.dataset.id));
        });

        document.querySelectorAll('.card-unsub').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                runUnsubscribe(btn.dataset.id, btn);
            });
        });

        document.querySelectorAll('.card-archive').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                // Cards in the archived view unarchive; cards in the active view archive.
                archiveArticle(btn.dataset.id, currentFilter !== 'archived', btn, false);
            });
        });

        document.querySelectorAll('.card-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteArticle(btn.dataset.id, btn, false);
            });
        });
    }

    async function handleParse(e) {
        e.preventDefault();
        const url = urlInput.value.trim();
        if (!url) return;
        if (!requireOnline('adding an article')) return;

        urlInput.value = '';
        errorMsg.textContent = '';
        showToast('Added to queue…');

        try {
            const res = await authFetch('/api/queue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url }),
            });
            if (!res.ok) {
                const data = await res.json();
                showToast(data.error || 'Failed to queue article', 'error');
            }
        } catch (err) {
            if (!(err instanceof AuthError)) {
                showToast(err.message, 'error');
            }
        }
    }

    function injectInlineParseButtons(container) {
        container.querySelectorAll('.article-body a').forEach(link => {
            const hrefAttr = link.getAttribute('href');
            if (!hrefAttr || hrefAttr.startsWith('#')) return;
            if (!['http:', 'https:'].includes(link.protocol)) return;

            const btn = document.createElement('button');
            btn.className = 'inline-parse-btn';
            btn.title = 'Save to Parse';
            btn.innerHTML = '<span>+</span>';
            
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (btn.disabled) return;
                if (!requireOnline('adding an article')) return;

                btn.disabled = true;
                try {
                    const res = await authFetch('/api/queue', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: link.href }),
                    });
                    
                    if (!res.ok) {
                        const errData = await res.json().catch(() => ({}));
                        throw new Error(errData.error || 'Failed to queue article');
                    }
                    
                    btn.innerHTML = '<span>✓</span>';
                    btn.classList.add('success');
                    showToast('Added to queue…');
                } catch (err) {
                    btn.disabled = false;
                    if (!(err instanceof AuthError)) showToast(err.message, 'error');
                }
            });

            link.parentNode.insertBefore(btn, link.nextSibling);
        });
    }

    async function loadArticleView(id) {
        currentArticleId = id;
        btnUnsubscribe.hidden = true;
        btnArchive.disabled = false;
        btnDelete.disabled = false;
        showArticle();
        readerContent.innerHTML = `
            <div class="reader-loading">
                <div class="spinner large"></div>
                <p>Retrieving parsed article...</p>
            </div>
        `;

        try {
            const res = await authFetch(`/api/articles/${id}`);
            if (!res.ok) throw new Error('Article not found');
            const data = await res.json();

            const payload = JSON.parse(data.content);

            document.title = `${payload.title} | Parse`;

            const summaryHtml = data.summary ? renderSummary(data.summary) : '';

            readerContent.innerHTML = `
                <h1>${payload.title}</h1>
                <p style="color: var(--accent); margin-bottom: 2rem;">By ${payload.byline || 'Unknown Author'}</p>
                <div id="tts-content-wrapper">
                    <div id="summary-container">${summaryHtml}</div>
                    <div class="article-body">
                        ${payload.content}
                    </div>
                </div>
            `;

            // Setup text parsing and prepare TTS sentences. Arabic Articles aren't
            // narrated (no on-device Arabic voice exists), so hide the play control.
            if (ttsController) {
                ttsController.parseArticle(id, payload.title, data.author || payload.byline, payload.content);
                btnTts.classList.toggle('hidden', ttsController.isArabicContent);
                if (ttsController.isArabicContent) ttsController.hidePlayer();
            }

            injectInlineParseButtons(readerContent);

            btnUnsubscribe.hidden = !data.unsubscribe_link;
            btnSummarize.disabled = false;
            currentArticleArchived = !!data.archived;
            btnArchive.title = currentArticleArchived ? 'Unarchive' : 'Archive';
            // Re-apply offline state: these server actions can't run without a connection.
            reflectOnline();

            history.pushState({ id }, '', `/?article=${id}`);

        } catch (err) {
            readerContent.innerHTML = `<p class="error-msg">Error loading article: ${err.message}</p>`;
        }
    }

    // Run an async article action with the button disabled for its duration,
    // swallowing AuthError (the modal already handles it) and surfacing any
    // other failure as an error toast.
    async function withButton(btn, fn) {
        if (btn) btn.disabled = true;
        try {
            return await fn();
        } catch (err) {
            if (!(err instanceof AuthError)) showToast(err.message, 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // Mutate an article server-side then refresh the view. fromReader: when true
    // we're acting on the open article and return to the library; otherwise we
    // refresh the current list in place.
    function mutateArticle(id, btn, fromReader, requestFn, successMsg, failMsg) {
        if (!id) return;
        return withButton(btn, async () => {
            const res = await requestFn();
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                showToast(data.error || failMsg, 'error');
                return;
            }
            showToast(successMsg);
            if (fromReader) {
                showDashboard();
                loadArticles();
            } else {
                await loadArticles();
            }
        });
    }

    function runUnsubscribe(id, btn) {
        if (!id) return;
        if (!requireOnline('unsubscribing')) return;
        return withButton(btn, async () => {
            const res = await authFetch(`/api/articles/${id}/unsubscribe`, { method: 'POST' });
            const data = await res.json();
            if (!res.ok) {
                showToast(data.error || 'Unsubscribe failed', 'error');
                return;
            }
            if (data.action === 'one-click') {
                showToast(data.ok ? 'Unsubscribed ✓' : `Sender returned status ${data.status}`, data.ok ? 'info' : 'error');
            } else if (data.action === 'open') {
                window.open(data.link, '_blank', 'noopener');
                showToast('Opened the unsubscribe page in a new tab.');
            } else if (data.action === 'mailto') {
                // No server-side mail sender — surface the address as a clickable
                // mailto: link so the user can send the unsubscribe from their client.
                const address = data.link.replace(/^mailto:/i, '').split('?')[0];
                showLinkToast('Unsubscribe by email:', address, data.link);
            }
        });
    }

    function renderSummary(summaryText) {
        if (!summaryText) return '';
        
        const lines = summaryText.split('\n');
        let html = '';
        let inList = false;
        
        for (let line of lines) {
            let trimmed = line.trim();
            
            // Handle Headings (e.g. ### (1) Main points)
            const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
            if (headingMatch) {
                if (inList) {
                    html += '</ul>';
                    inList = false;
                }
                const level = headingMatch[1].length;
                const text = headingMatch[2];
                const formattedText = parseInlineMarkdown(text);
                html += `<h${level}>${formattedText}</h${level}>`;
                continue;
            }
            
            // Handle Bullet Points (e.g. * Bold text: or - Bold text:)
            const bulletMatch = trimmed.match(/^[\*\-\+]\s+(.+)$/);
            if (bulletMatch) {
                if (!inList) {
                    html += '<ul>';
                    inList = true;
                }
                const text = bulletMatch[1];
                const formattedText = parseInlineMarkdown(text);
                html += `<li>${formattedText}</li>`;
                continue;
            }
            
            // Handle empty line
            if (trimmed === '') {
                if (inList) {
                    html += '</ul>';
                    inList = false;
                }
                continue;
            }
            
            // Handle normal text line
            if (inList) {
                html += '</ul>';
                inList = false;
            }
            const formattedText = parseInlineMarkdown(trimmed);
            html += `<p>${formattedText}</p>`;
        }
        
        if (inList) {
            html += '</ul>';
        }
        
        function parseInlineMarkdown(text) {
            return text
                // Escape HTML chars
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                // Restore strong brackets for tags we will add
                .replace(/&lt;strong&gt;/g, '<strong>').replace(/&lt;\/strong&gt;/g, '</strong>')
                .replace(/&lt;em&gt;/g, '<em>').replace(/&lt;\/em&gt;/g, '</em>')
                .replace(/&lt;code&gt;/g, '<code>').replace(/&lt;\/code&gt;/g, '</code>')
                // Bold **text** or __text__
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/__(.+?)__/g, '<strong>$1</strong>')
                // Italic *text* or _text_
                .replace(/\*(.+?)\*/g, '<em>$1</em>')
                .replace(/_(.+?)_/g, '<em>$1</em>')
                // Code blocks `code`
                .replace(/`(.+?)`/g, '<code>$1</code>');
        }
        
        return `
            <details class="summary-details details-collapsible" open>
                <summary><strong>AI Summary</strong></summary>
                <div class="summary-content">${html}</div>
            </details>
        `;
    }

    async function runSummarize(id, btn) {
        if (!id) return;
        if (!requireOnline('summarizing')) return;

        // Show loading state
        const container = document.getElementById('summary-container');
        if (container && !container.innerHTML) {
            container.innerHTML = `
                <div class="summary-loading">
                    <div class="spinner small"></div>
                    <span>Generating summary...</span>
                </div>
            `;
        }

        return withButton(btn, async () => {
            const res = await authFetch(`/api/articles/${id}/summarize`, { method: 'POST' });
            const data = await res.json();
            if (!res.ok) {
                if (container) container.innerHTML = '';
                showToast(data.error || 'Failed to generate summary', 'error');
                return;
            }
            showToast('Summary generated ✓');
            
            if (container) {
                container.innerHTML = renderSummary(data.summary);
                // Auto-expand the details when generated freshly
                const details = container.querySelector('details');
                if (details) details.open = true;

                // Reload the article to sync the newly generated summary with the TTS engine
                loadArticleView(id);
            }
        });
    }

    // ── Archive / Delete ─────────────────────────────────────────────────────────

    // archived: true to archive, false to unarchive.
    function archiveArticle(id, archived, btn, fromReader) {
        if (!requireOnline('archiving')) return;
        return mutateArticle(id, btn, fromReader,
            () => authFetch(`/api/articles/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ archived }),
            }),
            archived ? 'Archived ✓' : 'Restored to library ✓',
            'Failed to update article');
    }

    function deleteArticle(id, btn, fromReader) {
        if (!id) return;
        if (!requireOnline('deleting')) return;
        if (!confirm('Delete this article permanently? This also removes its saved images and cannot be undone.')) return;
        return mutateArticle(id, btn, fromReader,
            () => authFetch(`/api/articles/${id}`, { method: 'DELETE' }),
            'Deleted ✓',
            'Failed to delete article');
    }

    // ── Search ─────────────────────────────────────────────────────────────────

    let debounceTimer;
    async function handleSearch(e) {
        const query = e.target.value.toLowerCase();
        clearTimeout(debounceTimer);

        debounceTimer = setTimeout(async () => {
            if (!query) {
                renderArticles(articlesCache);
                return;
            }

            try {
                const res = await authFetch(`/api/search?q=${encodeURIComponent(query)}`);
                if (res.ok) {
                    const results = await res.json();
                    renderArticles(results);
                }
            } catch {
                const filtered = articlesCache.filter(a => a.title.toLowerCase().includes(query));
                renderArticles(filtered);
            }
        }, 300);
    }

    // ── Browser back button ────────────────────────────────────────────────────

    window.addEventListener('popstate', (e) => {
        if (e.state && e.state.id) {
            loadArticleView(e.state.id);
        } else {
            showDashboard();
        }
    });
});
