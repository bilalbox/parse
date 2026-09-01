<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { settings } from '$lib/settings.svelte';
	import { tts } from '$lib/tts.svelte';
	import { toast } from '$lib/toast.svelte';
	import LinkActionSheet from '$lib/components/LinkActionSheet.svelte';
	import ImageViewer from '$lib/components/ImageViewer.svelte';
	import ReaderMenu from '$lib/components/ReaderMenu.svelte';
	import TypePanel from '$lib/components/TypePanel.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { sanitizeArticleHtml } from '$lib/sanitize-email';
	import { readMinutes, formatDate } from '$lib/format';
	import { openExternal } from '$lib/open-external';

	// Svelte 5 States
	let articleData = $state<any>(null);
	let loading = $state(true);
	let summarizing = $state(false);
	let viewEl: HTMLElement | undefined = $state();
	let selectedLinkUrl = $state('');
	let showLinkSheet = $state(false);
	let selectedImageUrl = $state('');
	let showImageViewer = $state(false);
	let showMenu = $state(false);
	let showTypePanel = $state(false);
	let headerHidden = $state(false);
	const READER_HEADER_HEIGHT = 64; // keep in sync with .app-header height in app.css

	// Auto-hide gives the text the whole screen while reading. The header always
	// comes back on any upward scroll, and never hides while it holds a control
	// the reader needs to reach — the pause button during narration — or while
	// an overlay is anchored to it.
	const SCROLL_HIDE_THRESHOLD = 40;
	let lastScrollTop = 0;
	let hideAccumulator = 0;

	function onReaderScroll(): void {
		if (!viewEl) return;
		const top = viewEl.scrollTop;
		const delta = top - lastScrollTop;
		lastScrollTop = top;

		if (top <= READER_HEADER_HEIGHT || delta < 0) {
			hideAccumulator = 0;
			headerHidden = false;
			return;
		}

		if (showMenu || showTypePanel || (tts.isPlaying && tts.articleId === id)) return;

		hideAccumulator += delta;
		if (hideAccumulator > SCROLL_HIDE_THRESHOLD) headerHidden = true;
	}

	$effect(() => {
		// Any overlay opening, or narration starting, brings the chrome back.
		if (showMenu || showTypePanel || tts.isPlaying) headerHidden = false;
	});

	function turnPage(direction: 1 | -1): void {
		// scroll by one screen minus the sticky header, so no content is skipped between pages
		viewEl?.scrollBy({ top: direction * (viewEl.clientHeight - READER_HEADER_HEIGHT), behavior: 'auto' });
	}

	const id = $derived(page.params.id);

	async function loadArticle(articleId: string): Promise<void> {
		loading = true;
		articleData = null;
		try {
			const res = await settings.authFetch(`/api/articles/${articleId}`);
			if (!res.ok) {
				if (res.status === 401) {
					goto('/login');
					return;
				}
				throw new Error('Article not found');
			}
			articleData = (await res.json()) as any;
			
			// Update page title
			const payload = JSON.parse(articleData.content || '{}');
			document.title = `${payload.title} | Parse`;
		} catch (err: any) {
			toast.show(err.message || 'Failed to load article', 'error');
		} finally {
			loading = false;
		}
	}

	async function runSummarize(): Promise<void> {
		if (!id || !articleData) return;
		if (!settings.isOnline) {
			toast.show('Cannot summarize while offline.', 'error');
			return;
		}

		summarizing = true;
		try {
			const res = await settings.authFetch(`/api/articles/${id}/summarize`, { method: 'POST' });
			const data = (await res.json()) as any;
			if (!res.ok) {
				throw new Error(data.error || 'Failed to summarize');
			}

			articleData.summary = data.summary;
			toast.show('Summary generated ✓');
		} catch (err: any) {
			toast.show(err.message || 'Failed to generate summary', 'error');
		} finally {
			summarizing = false;
		}
	}

	async function archiveArticle(): Promise<void> {
		if (!articleData) return;
		const nextArchivedState = !articleData.archived;
		
		try {
			const res = await settings.authFetch(`/api/articles/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ archived: nextArchivedState }),
			});
			
			if (!res.ok) {
				const data = (await res.json().catch(() => ({}))) as any;
				throw new Error(data.error || 'Failed to update article');
			}

			toast.show(nextArchivedState ? 'Archived ✓' : 'Restored to library ✓');
			goto('/', { replaceState: true });
		} catch (err: any) {
			toast.show(err.message || 'Failed to archive article', 'error');
		}
	}

	async function deleteArticle(): Promise<void> {
		if (!articleData) return;
		if (!confirm('Delete this article permanently? This also removes its saved images and cannot be undone.')) return;

		try {
			const res = await settings.authFetch(`/api/articles/${id}`, { method: 'DELETE' });
			if (!res.ok) {
				const data = (await res.json().catch(() => ({}))) as any;
				throw new Error(data.error || 'Failed to delete article');
			}

			toast.show('Deleted ✓');
			goto('/', { replaceState: true });
		} catch (err: any) {
			toast.show(err.message || 'Failed to delete article', 'error');
		}
	}

	async function runUnsubscribe(): Promise<void> {
		if (!articleData) return;
		try {
			const res = await settings.authFetch(`/api/articles/${id}/unsubscribe`, { method: 'POST' });
			const data = (await res.json()) as any;
			if (!res.ok) {
				throw new Error(data.error || 'Failed to unsubscribe');
			}

			if (data.action === 'mailto') {
				toast.showLink('Send unsubscribe email via', 'Mail Client', data.link);
			} else if (data.action === 'one-click') {
				toast.show(data.ok ? 'Unsubscribe request sent ✓' : 'Failed to unsubscribe');
			} else if (data.action === 'open') {
				toast.showLink('Open unsubscribe page:', 'Unsubscribe Link', data.link);
			}
		} catch (err: any) {
			toast.show(err.message || 'Failed to unsubscribe', 'error');
		}
	}

	function interceptInteractions(node: HTMLElement) {
		const handleClick = (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			const anchor = target.closest('a');
			const img = target.closest('img');
			
			if (anchor && anchor.href && anchor.href.startsWith('http')) {
				e.preventDefault();
				selectedLinkUrl = anchor.href;
				showLinkSheet = true;
			} else if (img && img.src && img.src.startsWith('http')) {
				e.preventDefault();
				selectedImageUrl = img.src;
				showImageViewer = true;
			}
		};
		node.addEventListener('click', handleClick);
		return {
			destroy() {
				node.removeEventListener('click', handleClick);
			}
		};
	}

	async function saveLinkAndDismiss(url: string) {
		showLinkSheet = false;
		toast.show('Link saved ✓');
		try {
			await settings.authFetch('/api/queue', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url })
			});
		} catch (err: any) {
			toast.show('Failed to save link', 'error');
		}
	}

	// Custom markdown summary renderer matching the original implementation
	function renderSummary(summaryText: string): string {
		if (!summaryText) return '';
		
		const lines = summaryText.split('\n');
		let html = '';
		let inList = false;
		
		for (const line of lines) {
			const trimmed = line.trim();
			
			// Headings
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
			
			// Bullet points
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
			
			// Empty lines
			if (trimmed === '') {
				if (inList) {
					html += '</ul>';
					inList = false;
				}
				continue;
			}
			
			// Paragraphs
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
		
		function parseInlineMarkdown(text: string): string {
			return text
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/&lt;strong&gt;/g, '<strong>').replace(/&lt;\/strong&gt;/g, '</strong>')
				.replace(/&lt;em&gt;/g, '<em>').replace(/&lt;\/em&gt;/g, '</em>')
				.replace(/&lt;code&gt;/g, '<code>').replace(/&lt;\/code&gt;/g, '</code>')
				.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
				.replace(/__(.+?)__/g, '<strong>$1</strong>')
				.replace(/\*(.+?)\*/g, '<em>$1</em>')
				.replace(/_(.+?)_/g, '<em>$1</em>')
				.replace(/`(.+?)`/g, '<code>$1</code>');
		}
		
		return html;
	}

	// Fetch article whenever ID parameter changes
	$effect(() => {
		if (id) {
			loadArticle(id);
		}
	});

	function rewriteHtmlContent(html: string): string {
		if (!html) return '';
		return html;
	}

	// Reactively bind article content to global TTS engine once loaded and mounted via Svelte 5 attachment
	function ttsAttachment(element: HTMLElement): void {
		if (!articleData) return;
		const payload = JSON.parse(articleData.content || '{}');
		tts.loadArticle(
			articleData.id,
			payload.title || articleData.title,
			articleData.author || payload.byline,
			element
		);
	}

	// Clean up TTS highlights when page changes
	onMount(() => {
		return () => {
			tts.clearHighlight();
		};
	});
</script>

<main id="view-article" class="view active" bind:this={viewEl} onscroll={onReaderScroll}>
	<nav class="app-header reader-header" class:header-hidden={headerHidden}>
		<button onclick={() => goto('/', { replaceState: true })} class="icon-btn" title="Back to Library">
			<Icon name="arrow-left" />
		</button>

		{#if !loading && articleData}
			<div class="reader-controls">
				{#if settings.einkMode}
					<button class="icon-btn" onclick={() => turnPage(-1)} title="Previous Page">
						<Icon name="chevron-left" />
					</button>
					<button class="icon-btn" onclick={() => turnPage(1)} title="Next Page">
						<Icon name="chevron-right" />
					</button>
				{:else}
					<button
						class="icon-btn"
						onclick={() => tts.togglePlay()}
						title={tts.isPlaying && tts.articleId === id ? 'Pause' : 'Read Aloud'}
					>
						<Icon name={tts.isPlaying && tts.articleId === id ? 'pause' : 'play'} />
					</button>
				{/if}
				<button
					class="icon-btn"
					onclick={runSummarize}
					disabled={summarizing || !settings.isOnline}
					title="Summarize"
				>
					<Icon name="sparkle" />
				</button>
				<div class="type-anchor">
					<button
						class="icon-btn type-btn"
						class:active={showTypePanel}
						onclick={() => { showTypePanel = !showTypePanel; showMenu = false; }}
						title="Typography"
					>Aa</button>
					<TypePanel show={showTypePanel} onClose={() => (showTypePanel = false)} />
				</div>
				<button
					class="icon-btn"
					class:active={showMenu}
					onclick={() => { showMenu = !showMenu; showTypePanel = false; }}
					title="More actions"
				>
					<Icon name="more" />
				</button>
			</div>
		{/if}
	</nav>
	
	<div
		id="reader-content"
		class="reader-content"
		class:rtl-content={tts.isArabicContent}
		class:typography-sans={settings.fontFamily === 'sans'}
		class:typography-serif={settings.fontFamily === 'serif'}
		class:typography-amiri={settings.fontFamily === 'amiri'}
		class:typography-cairo={settings.fontFamily === 'cairo'}
		dir={tts.isArabicContent ? 'rtl' : 'ltr'}
		style:font-size="{settings.fontSize}rem"
	>
		{#if loading}
			<div class="reader-loading">
				<div class="spinner large"></div>
			</div>
		{:else if articleData}
			{@const payload = JSON.parse(articleData.content || '{}')}
			<h1>{payload.title}</h1>
			{#if articleData.url && /^https?:\/\//i.test(articleData.url)}
				<a
					href={articleData.url}
					target="_blank"
					rel="noopener noreferrer"
					class="view-original-link"
					onclick={(e) => {
						e.preventDefault();
						void openExternal(articleData.url);
					}}>View original</a
				>
			{/if}
			<p style="color: var(--accent); margin-bottom: 2rem;">By {articleData.author || payload.byline || 'Unknown Author'}{#if formatDate(articleData.published)} · {formatDate(articleData.published)}{/if}{#if articleData.word_count} · {readMinutes(articleData.word_count)} min read{/if}</p>
			
			<div id="tts-content-wrapper" use:interceptInteractions {@attach ttsAttachment} onclick={(e) => {
				const target = e.target as HTMLElement;
				if (target.classList.contains('tts-sentence')) {
					const idx = parseInt(target.dataset.sentenceIndex || '');
					if (!isNaN(idx)) {
						tts.jumpToSentence(idx);
					}
				}
			}} onkeydown={() => {}} role="button" tabindex="0">
				{#if articleData.summary}
					<div class="ai-summary-callout">
						<div class="ai-summary-header">
							<span class="ai-icon"><Icon name="sparkle" size={16} /></span>
							<strong>AI Summary</strong>
						</div>
						<div class="summary-content">
							{@html sanitizeArticleHtml(rewriteHtmlContent(renderSummary(articleData.summary)))}
						</div>
					</div>
				{/if}
				
				<div class="article-body">
					{@html sanitizeArticleHtml(rewriteHtmlContent(payload.content), payload.title)}
				</div>
			</div>
		{/if}
	</div>
</main>

<ReaderMenu
	show={showMenu}
	archived={!!articleData?.archived}
	canUnsubscribe={!!articleData?.unsubscribe_link}
	online={settings.isOnline}
	onClose={() => (showMenu = false)}
	onUnsubscribe={runUnsubscribe}
	onArchive={archiveArticle}
	onDelete={deleteArticle}
/>

<LinkActionSheet 
	url={selectedLinkUrl} 
	show={showLinkSheet} 
	onClose={() => showLinkSheet = false} 
	onSave={saveLinkAndDismiss} 
/>

<ImageViewer 
	src={selectedImageUrl} 
	show={showImageViewer} 
	onClose={() => showImageViewer = false} 
/>
