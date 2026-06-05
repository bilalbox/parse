import re

with open('public/index.html', 'r') as f:
    html = f.read()

# Replace head
head_replacement = """<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <meta name="theme-color" content="#000000">
    <title>Parse | Edge Reading</title>
    <link rel="manifest" href="/manifest.json">
    <link rel="apple-touch-icon" href="/icon.svg">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://api.fontshare.com/v2/css?f[]=clash-display@400,500,600,700&f[]=satoshi@400,500,700&display=swap" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;1,400&family=Amiri:ital,wght@0,400;0,700;1,400&family=Cairo:wght@300;400;600;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/style.css">
</head>"""
html = re.sub(r'<head>.*?</head>', head_replacement, html, flags=re.DOTALL)

# Replace the views inside #app-container up to but excluding <!-- Sleek Glassmorphic -->
views_replacement = """<div id="app-container">
        <!-- Dashboard View -->
        <main id="view-dashboard" class="view active">
            <header class="app-header">
                <div class="logo">PARSE</div>
                <div class="header-actions">
                    <button class="icon-btn" id="add-btn" title="Add URL">┼</button>
                    <button class="icon-btn" id="settings-btn" title="Settings">⚙</button>
                    <div class="theme-toggle" id="theme-toggle">◑</div>
                </div>
            </header>

            <section class="library-section">
                <div class="library-header">
                    <h2>Library</h2>
                    <div class="library-tools">
                        <div class="filter-toggle" id="filter-toggle">
                            <button class="filter-btn active" data-filter="active">Active</button>
                            <button class="filter-btn" data-filter="archived">Archived</button>
                        </div>
                        <div class="search-box">
                            <input type="text" id="search-input" placeholder="Search...">
                        </div>
                    </div>
                </div>
                
                <div id="articles-grid" class="articles-grid">
                    <!-- Loading skeleton -->
                    <div class="skeleton-card"></div>
                    <div class="skeleton-card"></div>
                    <div class="skeleton-card"></div>
                </div>
            </section>
        </main>

        <!-- Article Reader View -->
        <main id="view-article" class="view">
            <nav class="app-header reader-header">
                <button id="btn-back" class="icon-btn">←</button>
                <div class="reader-controls">
                <button class="icon-btn" id="btn-tts" title="Read Aloud">▶</button>
                <button class="icon-btn" id="btn-unsubscribe" title="Unsubscribe" hidden>⊖</button>
                <button class="icon-btn" id="btn-summarize" title="Summarize">∑</button>
                <button class="icon-btn" id="btn-archive" title="Archive">⊘</button>
                <button class="icon-btn btn-danger" id="btn-delete" title="Delete">✕</button>
                <button class="icon-btn font-btn" data-action="decrease">A-</button>
                <button class="icon-btn font-btn" data-action="increase">A+</button>
                <button class="icon-btn font-btn" data-action="serif">T</button>
            </div>
        </nav>
        
        <div id="reader-content" class="reader-content typography-sans">
            <div class="reader-loading">
                <div class="spinner large"></div>
            </div>
        </div>
    </main>
</div>

<!-- Add URL Bottom Sheet -->
<div id="add-sheet" class="bottom-sheet">
    <div class="sheet-backdrop"></div>
    <div class="sheet-content">
        <div class="sheet-header">
            <h3>New Article</h3>
            <button id="close-sheet" class="icon-btn">✕</button>
        </div>
        <form id="parse-form" class="parse-form">
            <div class="input-group">
                <input type="url" id="url-input" placeholder="https://..." required>
                <button type="submit" id="submit-btn">
                    <span class="btn-text">Parse</span>
                    <div class="spinner hidden"></div>
                </button>
            </div>
            <div id="error-message" class="error-msg"></div>
        </form>
    </div>
</div>

<script>
    document.addEventListener('DOMContentLoaded', () => {
        const addBtn = document.getElementById('add-btn');
        const addSheet = document.getElementById('add-sheet');
        const closeSheet = document.getElementById('close-sheet');
        const sheetBackdrop = document.querySelector('.sheet-backdrop');
        const parseFormEl = document.getElementById('parse-form');
        const urlInput = document.getElementById('url-input');
        
        const openSheet = () => { 
            addSheet.classList.add('active'); 
            setTimeout(() => urlInput.focus(), 100); 
        };
        const closeSheetFn = () => addSheet.classList.remove('active');
        
        addBtn.addEventListener('click', openSheet);
        closeSheet.addEventListener('click', closeSheetFn);
        sheetBackdrop.addEventListener('click', closeSheetFn);
        
        // When app.js submits the form, it shows the spinner.
        // We'll let app.js handle the submit. If successful, library reloads. We can just hide the modal after a short delay on submit.
        parseFormEl.addEventListener('submit', () => {
            setTimeout(closeSheetFn, 300);
        });
    });
</script>"""

html = re.sub(r'<div id="app-container">.*?</div>\s*<!-- Sleek Glassmorphic', views_replacement + '\n\n<!-- Sleek Glassmorphic', html, flags=re.DOTALL)

with open('public/index.html', 'w') as f:
    f.write(html)


with open('public/style.css', 'r') as f:
    css = f.read()

# Replace root variables up to body
css_top_replacement = """:root {
    /* Brutal Minimal Theme */
    --bg-primary: #000000;
    --bg-secondary: #0a0a0a;
    --bg-glass: rgba(0, 0, 0, 0.9);
    --border-glass: #222222;
    --text-primary: #ffffff;
    --text-secondary: #888888;
    --accent: #ffffff;
    --accent-glow: rgba(255, 255, 255, 0.2);
    --accent-hover: #dddddd;
    --error: #ff3333;
    
    /* Typography */
    --font-ui: 'Satoshi', sans-serif;
    --font-display: 'Clash Display', sans-serif;
    --font-serif: 'Lora', serif;
    --transition: all 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
}

[data-theme="light"] {
    --bg-primary: #ffffff;
    --bg-secondary: #f4f4f4;
    --bg-glass: rgba(255, 255, 255, 0.9);
    --border-glass: #dddddd;
    --text-primary: #000000;
    --text-secondary: #666666;
    --accent: #000000;
    --accent-glow: rgba(0, 0, 0, 0.1);
    --accent-hover: #333333;
}

* {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
}

body {
    font-family: var(--font-ui);
    background-color: var(--bg-primary);
    color: var(--text-primary);
    line-height: 1.6;
    overflow: hidden; /* Native mobile feel */
    width: 100vw;
    height: 100vh;
    position: fixed;
    transition: background-color 0.4s ease, color 0.4s ease;
}

h1, h2, h3, h4, h5, h6 {
    font-family: var(--font-display);
    font-weight: 600;
    letter-spacing: -0.02em;
}

#app-container {
    width: 100%;
    height: 100%;
    position: relative;
    background: var(--bg-primary);
}

/* SPA View Logic - Native Push/Pop */
.view {
    display: block !important;
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    background: var(--bg-primary);
    transition: transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
    -webkit-overflow-scrolling: touch;
}

#view-dashboard {
    z-index: 1;
    transform: translateX(0);
}

#view-article {
    z-index: 2;
    transform: translateX(100%);
    box-shadow: -20px 0 40px rgba(0,0,0,0.5);
}

[data-theme="light"] #view-article {
    box-shadow: -20px 0 40px rgba(0,0,0,0.1);
}

/* When article is active */
#view-article.active {
    transform: translateX(0);
}

/* When article is active, push dashboard back */
body:has(#view-article.active) #view-dashboard {
    transform: translateX(-25%);
    opacity: 0.5;
}

/* App Header */
.app-header {
    position: sticky;
    top: 0;
    z-index: 100;
    background: var(--bg-glass);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--border-glass);
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 5%;
    height: 64px;
}

.logo {
    font-family: var(--font-display);
    font-size: 1.25rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
}

.header-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.icon-btn {
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-primary);
    cursor: pointer;
    font-family: var(--font-ui);
    font-weight: 500;
    font-size: 1.1rem;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px; /* Brutalist sharp edge */
    transition: var(--transition);
}

.icon-btn:hover {
    border-color: var(--border-glass);
    background: var(--bg-secondary);
}

.theme-toggle {
    cursor: pointer;
    font-size: 1.2rem;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: var(--transition);
}

/* Bottom Sheet for Add URL */
.bottom-sheet {
    position: fixed;
    inset: 0;
    z-index: 2000;
    display: flex;
    align-items: flex-end;
    pointer-events: none;
}

.bottom-sheet.active {
    pointer-events: auto;
}

.sheet-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    opacity: 0;
    transition: opacity 0.3s ease;
}

.bottom-sheet.active .sheet-backdrop {
    opacity: 1;
}

.sheet-content {
    position: relative;
    width: 100%;
    background: var(--bg-primary);
    border-top: 1px solid var(--border-glass);
    padding: 1.5rem 5% 3rem;
    transform: translateY(100%);
    transition: transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.bottom-sheet.active .sheet-content {
    transform: translateY(0);
}

.sheet-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
}

.sheet-header h3 {
    font-size: 1.5rem;
}

/* Form inside sheet */
.parse-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
}

.input-group {
    display: flex;
    width: 100%;
    gap: 0.5rem;
}

#url-input {
    flex: 1;
    background: var(--bg-secondary);
    border: 1px solid var(--border-glass);
    border-radius: 0; /* Pure brutalist */
    padding: 1rem;
    font-size: 1rem;
    color: var(--text-primary);
    outline: none;
    font-family: var(--font-ui);
    transition: var(--transition);
}

#url-input:focus {
    border-color: var(--accent);
}

#submit-btn {
    background: var(--accent);
    color: var(--bg-primary);
    border: none;
    padding: 0 1.5rem;
    border-radius: 0; /* Brutalist */
    font-weight: 700;
    font-family: var(--font-display);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    cursor: pointer;
    transition: var(--transition);
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 120px;
}

#submit-btn:hover {
    background: var(--accent-hover);
}

#submit-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.error-msg {
    color: var(--error);
    font-size: 0.9rem;
    min-height: 1.2rem;
}

/* Spinner */
.spinner {
    width: 20px;
    height: 20px;
    border: 2px solid rgba(128,128,128,0.3);
    border-radius: 50%;
    border-top-color: inherit;
    animation: spin 0.8s linear infinite;
}

.spinner.large {
    width: 40px;
    height: 40px;
    border-color: var(--border-glass);
    border-top-color: var(--accent);
}

.hidden { display: none !important; }

@keyframes spin {
    to { transform: rotate(360deg); }
}

/* Library Section */
.library-section {
    padding: 2rem 5% 6rem;
    max-width: 1200px;
    margin: 0 auto;
}

.library-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    margin-bottom: 2rem;
    flex-wrap: wrap;
    gap: 1.5rem;
}

.library-header h2 {
    font-size: 2rem;
    line-height: 1;
}

.search-box {
    position: relative;
    width: 100%;
    max-width: 300px;
}

#search-input {
    width: 100%;
    background: transparent;
    border: none;
    border-bottom: 2px solid var(--border-glass);
    padding: 0.5rem 0;
    color: var(--text-primary);
    outline: none;
    border-radius: 0;
    font-family: var(--font-ui);
    transition: var(--transition);
}

#search-input:focus {
    border-color: var(--accent);
}

.articles-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 1rem; /* tighter gap for brutalism */
}

/* Article Cards */
.article-card {
    background: var(--bg-primary);
    border: 1px solid var(--border-glass);
    padding: 1.5rem;
    cursor: pointer;
    transition: var(--transition);
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    min-height: 180px;
    border-radius: 0; /* Brutalist geometry */
}

.article-card:hover {
    border-color: var(--accent);
    background: var(--bg-secondary);
}

.card-title {
    font-family: var(--font-display);
    font-size: 1.25rem;
    font-weight: 500;
    line-height: 1.3;
    margin-bottom: 0.5rem;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.card-meta {
    font-family: var(--font-ui);
    font-size: 0.8rem;
    color: var(--text-secondary);
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 1rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

.card-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 1rem;
}

.card-btn {
    background: transparent;
    border: 1px solid var(--border-glass);
    color: var(--text-secondary);
    font-family: var(--font-ui);
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.35rem 0.75rem;
    border-radius: 0;
    cursor: pointer;
    transition: var(--transition);
}

.card-btn:hover {
    color: var(--text-primary);
    border-color: var(--accent);
    background: var(--bg-secondary);
}

.card-btn:disabled {
    opacity: 0.5;
    cursor: default;
}

/* Library filter toggle */
.library-tools {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    flex-wrap: wrap;
}

.filter-toggle {
    display: inline-flex;
    gap: 0.5rem;
}

.filter-btn {
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-secondary);
    font-family: var(--font-ui);
    font-size: 0.85rem;
    font-weight: 600;
    padding: 0.2rem 0;
    border-radius: 0;
    cursor: pointer;
    transition: var(--transition);
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

.filter-btn.active {
    color: var(--text-primary);
    border-color: var(--accent);
}

.btn-danger:hover {
    color: var(--error);
    border-color: var(--error);
}

/* Skeletons */
.skeleton-card {
    background: var(--bg-secondary);
    height: 180px;
    animation: pulse 1.5s infinite;
}

@keyframes pulse {
    0% { opacity: 0.8; }
    50% { opacity: 0.4; }
    100% { opacity: 0.8; }
}

/* Reader View */
.reader-header {
    justify-content: space-between;
}

.reader-controls {
    display: flex;
    gap: 0.2rem;
}

.font-btn {
    font-family: var(--font-display);
}

.reader-content {
    max-width: 680px; /* Optimal reading width */
    margin: 0 auto 6rem;
    padding: 2rem 5%;
    font-size: 1.15rem;
    transition: font-size 0.3s ease;
}

.reader-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 50vh;
}

/* Reader Content Styling */
.reader-content h1 {
    font-size: 2.5em;
    line-height: 1.1;
    margin-bottom: 0.5em;
}

.reader-content h2 { font-size: 1.8em; margin-top: 1.5em; margin-bottom: 0.5em; }
.reader-content h3 { font-size: 1.4em; margin-top: 1.2em; margin-bottom: 0.5em; }

.reader-content p {
    margin-bottom: 1.5em;
    color: var(--text-primary);
    line-height: 1.7;
}

.reader-content img, 
.reader-content figure {
    max-width: 100%;
    height: auto;
    margin: 2rem 0;
    display: block;
    filter: grayscale(100%); /* Brutalist photography */
    transition: filter 0.3s;
}

.reader-content img:hover {
    filter: grayscale(0%);
}

.reader-content blockquote {
    border-left: 2px solid var(--accent);
    padding-left: 1.5rem;
    margin: 2rem 0;
    font-style: normal; /* Less traditional */
    font-weight: 500;
}

.reader-content a {
    color: var(--text-primary);
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 4px;
    transition: var(--transition);
}

.reader-content a:hover {
    background: var(--text-primary);
    color: var(--bg-primary);
    text-decoration: none;
}

.reader-content pre {
    background: var(--bg-secondary);
    padding: 1.5rem;
    overflow-x: auto;
    border: 1px solid var(--border-glass);
    margin: 1.5rem 0;
    font-size: 0.9em;
}

/* Action links recovered */
.reader-content .details-collapsible {
    margin: 1.5rem 0;
    padding: 1rem;
    border: 1px solid var(--border-glass);
    background: var(--bg-secondary);
}

.reader-content .details-collapsible > summary {
    cursor: pointer;
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 0.9em;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    outline: none;
}

.reader-content .summary-content {
    margin-top: 1rem;
    font-size: 0.95em;
}

.reader-content .parsed-action-links a {
    display: inline-block;
    padding: 0.6rem 1.2rem;
    background: var(--text-primary);
    color: var(--bg-primary);
    text-decoration: none;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-size: 0.85rem;
}

.reader-content .parsed-action-links a:hover {
    background: var(--bg-primary);
    color: var(--text-primary);
    border: 1px solid var(--text-primary);
}

/* Font Modifiers */
.typography-serif { font-family: var(--font-serif); }
.typography-sans { font-family: var(--font-ui); }

@media (max-width: 768px) {
    .input-group { flex-direction: column; }
    #submit-btn { padding: 1rem; }
    .reader-content h1 { font-size: 2em; }
}

/* Settings Modal tweaks for brutalism */
.modal-box {
    border-radius: 0 !important;
}
.modal-box input[type="password"],
.settings-select {
    border-radius: 0 !important;
}
.token-save-btn, .token-cancel-btn {
    border-radius: 0 !important;
}
"""

css = re.sub(r':root \{.*?/\* Header Actions \*/', css_top_replacement + '\n/* Header Actions */', css, flags=re.DOTALL)

with open('public/style.css', 'w') as f:
    f.write(css)

