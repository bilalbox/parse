document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const viewDashboard = document.getElementById('view-dashboard');
    const viewArticle = document.getElementById('view-article');
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
    const btnArchive = document.getElementById('btn-archive');
    const btnDelete = document.getElementById('btn-delete');
    const filterToggle = document.getElementById('filter-toggle');
    const themeToggle = document.getElementById('theme-toggle');
    const settingsBtn = document.getElementById('settings-btn');
    const tokenModal = document.getElementById('token-modal');
    const tokenInput = document.getElementById('token-input');
    const tokenSaveBtn = document.getElementById('token-save-btn');
    const tokenError = document.getElementById('token-error');

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

    settingsBtn.addEventListener('click', () => showTokenModal());

    // ── Initialization ─────────────────────────────────────────────────────────

    initTheme();

    updateAuthClass();

    // Handle PWA Web Share Target: /share?url=...
    if (location.pathname === '/share') {
        const params = new URLSearchParams(location.search);
        // The share_target params send `url`; `text` sometimes carries the URL on Android
        const sharedUrl = params.get('url') || params.get('text') || '';
        history.replaceState(null, '', '/');

        if (sharedUrl) {
            if (!getToken()) {
                showTokenModal(() => { updateAuthClass(); triggerShare(sharedUrl); });
            } else {
                triggerShare(sharedUrl);
            }
        }
    } else if (!getToken()) {
        showTokenModal(() => { updateAuthClass(); loadArticles(); });
    } else {
        loadArticles();
    }

    function triggerShare(url) {
        urlInput.value = url;
        loadArticles().then(() => {
            parseForm.dispatchEvent(new Event('submit'));
        });
    }

    // ── Event Listeners ────────────────────────────────────────────────────────

    parseForm.addEventListener('submit', handleParse);
    btnBack.addEventListener('click', showDashboard);
    btnUnsubscribe.addEventListener('click', () => runUnsubscribe(currentArticleId, btnUnsubscribe));
    btnArchive.addEventListener('click', () => archiveArticle(currentArticleId, !currentArticleArchived, btnArchive, true));
    btnDelete.addEventListener('click', () => deleteArticle(currentArticleId, btnDelete, true));
    searchInput.addEventListener('input', handleSearch);

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
        viewArticle.classList.remove('active');
        setTimeout(() => viewDashboard.classList.add('active'), FADE_MS);
        history.pushState(null, '', '/');
        document.title = 'Parse | Premium Edge Reading';
    }

    function showArticle() {
        viewDashboard.classList.remove('active');
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
        } catch (err) {
            if (!(err instanceof AuthError)) {
                articlesGrid.innerHTML = `<p class="error-msg">Could not load library. Ensure the worker is running with D1 configured.</p>`;
            }
        }
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

            readerContent.innerHTML = `
                <h1>${payload.title}</h1>
                <p style="color: var(--accent); margin-bottom: 2rem;">By ${payload.byline || 'Unknown Author'}</p>
                <div class="article-body">
                    ${payload.content}
                </div>
            `;

            btnUnsubscribe.hidden = !data.unsubscribe_link;
            currentArticleArchived = !!data.archived;
            btnArchive.textContent = currentArticleArchived ? 'Unarchive' : 'Archive';

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

    // ── Archive / Delete ─────────────────────────────────────────────────────────

    // archived: true to archive, false to unarchive.
    function archiveArticle(id, archived, btn, fromReader) {
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
