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
    const themeToggle = document.getElementById('theme-toggle');

    // State
    let currentFontSize = 1.15;
    let isSerif = false;
    let articlesCache = [];

    // Initialization
    loadArticles();
    initTheme();

    // Event Listeners
    parseForm.addEventListener('submit', handleParse);
    btnBack.addEventListener('click', showDashboard);
    searchInput.addEventListener('input', handleSearch);
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

    // Theme Management
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

    // Navigation
    function showDashboard() {
        viewArticle.classList.remove('active');
        setTimeout(() => viewDashboard.classList.add('active'), 300); // Wait for fade out
        history.pushState(null, '', '/');
        document.title = 'Readerize | Premium Edge Reading';
    }

    function showArticle() {
        viewDashboard.classList.remove('active');
        setTimeout(() => viewArticle.classList.add('active'), 300);
        window.scrollTo(0,0);
    }

    // API Interactions
    async function loadArticles() {
        try {
            const res = await fetch('/api/articles');
            if (!res.ok) throw new Error('Failed to fetch library');
            const articles = await res.json();
            articlesCache = articles;
            renderArticles(articles);
        } catch (err) {
            articlesGrid.innerHTML = `<p class="error-msg">Could not load library. Ensure the worker is running with D1 configured.</p>`;
        }
    }

    function renderArticles(articles) {
        if (articles.length === 0) {
            articlesGrid.innerHTML = `<p style="color: var(--text-secondary); grid-column: 1/-1; text-align: center; padding: 2rem;">Your library is empty. Start by parsing an article above!</p>`;
            return;
        }

        articlesGrid.innerHTML = articles.map(article => `
            <div class="article-card" data-id="${article.id}">
                <h3 class="card-title">${article.title}</h3>
                <div class="card-meta">
                    <span class="author">${article.author || 'Unknown'}</span>
                    <span class="date">${new Date(article.created_at).toLocaleDateString()}</span>
                </div>
            </div>
        `).join('');

        // Add click listeners to new cards
        document.querySelectorAll('.article-card').forEach(card => {
            card.addEventListener('click', () => loadArticleView(card.dataset.id));
        });
    }

    async function handleParse(e) {
        e.preventDefault();
        const url = urlInput.value.trim();
        if (!url) return;

        // UI Loading State
        submitBtn.disabled = true;
        btnText.classList.add('hidden');
        spinner.classList.remove('hidden');
        errorMsg.textContent = '';

        try {
            const res = await fetch('/api/parse', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });

            const data = await res.json();
            
            if (!res.ok) throw new Error(data.error || 'Failed to parse article');

            // Success! Clear form and load the new article
            urlInput.value = '';
            await loadArticles(); // Refresh library
            loadArticleView(data.id); // Navigate to it immediately

        } catch (err) {
            errorMsg.textContent = err.message;
        } finally {
            submitBtn.disabled = false;
            btnText.classList.remove('hidden');
            spinner.classList.add('hidden');
        }
    }

    async function loadArticleView(id) {
        showArticle();
        readerContent.innerHTML = `
            <div class="reader-loading">
                <div class="spinner large"></div>
                <p>Retrieving parsed article...</p>
            </div>
        `;

        try {
            const res = await fetch(`/api/articles/${id}`);
            if (!res.ok) throw new Error('Article not found');
            const data = await res.json();
            
            // The content is a JSON string of the Readability output
            const payload = JSON.parse(data.content);
            
            document.title = `${payload.title} | Readerize`;
            
            readerContent.innerHTML = `
                <h1>${payload.title}</h1>
                <p style="color: var(--accent); margin-bottom: 2rem;">By ${payload.byline || 'Unknown Author'}</p>
                <div class="article-body">
                    ${payload.content}
                </div>
            `;
            
            history.pushState({ id }, '', `/?article=${id}`);
            
        } catch (err) {
            readerContent.innerHTML = `<p class="error-msg">Error loading article: ${err.message}</p>`;
        }
    }

    // Search Logic (Frontend filtering + FTS fallback mock)
    let debounceTimer;
    async function handleSearch(e) {
        const query = e.target.value.toLowerCase();
        clearTimeout(debounceTimer);
        
        debounceTimer = setTimeout(async () => {
            if (!query) {
                renderArticles(articlesCache);
                return;
            }

            // Optional: call the FTS5 endpoint for deep text search
            try {
                const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
                if (res.ok) {
                    const results = await res.json();
                    renderArticles(results);
                }
            } catch (err) {
                // Fallback to title filtering
                const filtered = articlesCache.filter(a => a.title.toLowerCase().includes(query));
                renderArticles(filtered);
            }
        }, 300);
    }

    // Handle back button natively
    window.addEventListener('popstate', (e) => {
        if (e.state && e.state.id) {
            loadArticleView(e.state.id);
        } else {
            showDashboard();
        }
    });
});
