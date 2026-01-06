const DB_NAME = "DocxSearchDB";
const STORE_NAME = "documents";
const DB_VERSION = 8; 

const params = new URLSearchParams(window.location.search);
const docId = parseInt(params.get('id'));
const searchQuery = params.get('q'); 
const targetHeader = params.get('target'); 
const matchIndex = params.has('idx') ? parseInt(params.get('idx')) : -1;

const titleEl = document.getElementById('doc-title');
const container = document.getElementById('doc-container');
const statusEl = document.getElementById('status');
const downloadBtn = document.getElementById('download-btn');
const sidebar = document.getElementById('outline-sidebar');
const sidebarContent = document.getElementById('outline-content');
const resizer = document.getElementById('resizer');

const viewerSearchInput = document.getElementById('viewer-search-input');
const viewerSearchCount = document.getElementById('viewer-search-count');
const viewerSearchPrev = document.getElementById('viewer-search-prev');
const viewerSearchNext = document.getElementById('viewer-search-next');
const searchResultsPanel = document.getElementById('search-results-panel');
const searchResultsList = document.getElementById('search-results-list');
const closeSearchPanel = document.getElementById('close-search-panel');

let internalSearchResults = [];
let internalSearchIndex = 0;

initResizer();
initSearch();

if (!docId) {
    statusEl.textContent = "Error: No document ID provided.";
} else {
    initDBAndRender();
}

function initDBAndRender() {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = (event) => {
        statusEl.innerHTML = `Database Error: ${event.target.error?.message}.<br>Please clear DB in Manager.`;
    };
    request.onsuccess = (event) => {
        const db = event.target.result;
        try {
            const transaction = db.transaction([STORE_NAME], "readonly");
            const objectStore = transaction.objectStore(STORE_NAME);
            const getRequest = objectStore.get(docId);

            getRequest.onsuccess = () => {
                const doc = getRequest.result;
                if (doc) {
                    renderDoc(doc);
                    setupDownload(doc); 

                } else {
                    statusEl.textContent = "Error: Document not found.";
                }
            };
        } catch(e) {
            statusEl.textContent = "Error: DB Version Mismatch.";
        }
    };
}

function setupDownload(doc) {
    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
            const url = URL.createObjectURL(doc.blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = doc.title; 

            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        });
    }
}

async function renderDoc(doc) {
    titleEl.textContent = doc.title;
    document.title = doc.title + " - DocViewer";
    statusEl.textContent = "Rendering...";

    try {
        const buffer = await doc.blob.arrayBuffer();
        container.innerHTML = ""; 
        await docx.renderAsync(buffer, container, null, { inWrapper: false, ignoreWidth: false, experimental: true });

        collapseBlankPages(container);

        generateOutline(container);

        if (targetHeader) {
             scrollToHeader(container, searchQuery, targetHeader);
        } else if (matchIndex >= 0 && searchQuery) {
             scrollToIndex(container, searchQuery, matchIndex);
        } else if (searchQuery) {
             scrollToIndex(container, searchQuery, 0);
        }
    } catch (e) {
        container.innerHTML = `<div style="color:red; padding:20px;">Error: ${e.message}</div>`;
    }
}

function collapseBlankPages(container) {
    const pages = container.querySelectorAll('section.docx');

    pages.forEach(page => {

        const allText = page.textContent.trim();

        const headers = page.querySelectorAll('h1, h2, h3, h4, h5, h6');
        let headerText = '';
        headers.forEach(h => headerText += h.textContent.trim() + ' ');

        const bodyText = allText.replace(headerText.trim(), '').trim();

        const paragraphs = page.querySelectorAll('p');
        let hasSubstantialContent = false;
        paragraphs.forEach(p => {
            const pText = p.textContent.trim();

            if (pText.length > 50) {

                const style = window.getComputedStyle(p);
                const isBold = style.fontWeight === '700' || style.fontWeight === 'bold';
                const isLargeFont = parseFloat(style.fontSize) > 16;
                if (!(isBold && isLargeFont)) {
                    hasSubstantialContent = true;
                }
            }
        });

        if (headers.length > 0 && !hasSubstantialContent && bodyText.length < 100) {
            page.classList.add('blank-page');
        }
    });
}

function getSmartRegex(query, flags = 'i') {
    const safeQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (query.length >= 5) {
        return new RegExp(`(${safeQuery})`, flags); 
    } else {
        return new RegExp(`(\\b${safeQuery}\\b)`, flags);
    }
}

function scrollToHeader(container, query, fullHeaderText) {
    if (!fullHeaderText) return;
    const cleanHeader = fullHeaderText.replace(/[^\w\s]/g, '').toLowerCase().trim();
    requestAnimationFrame(() => {
        setTimeout(() => {
            const allElements = container.querySelectorAll('h1, h2, h3, h4, h5, h6, p');
            let best = null;
            let maxScore = -1;
            for (let el of allElements) {
                const text = el.textContent.trim();
                const cleanText = text.replace(/[^\w\s]/g, '').toLowerCase();
                if (cleanText.includes(cleanHeader)) {
                    let score = 0;
                    if (/^H[1-6]$/.test(el.tagName)) score += 100;
                    if (el.className && el.className.includes('heading')) score += 80;
                    if (text.length < fullHeaderText.length + 20) score += 50;
                    if (score > maxScore) { maxScore = score; best = el; }
                }
            }
            if (best) {
                best.scrollIntoView({ behavior: 'auto', block: 'center' });
                best.style.backgroundColor = "#ffff00";
                best.style.transition = "background 2s";
            } else if (query) {
                scrollToIndex(container, query, 0);
            }
        }, 100); 
    });
}

function scrollToIndex(container, query, targetIndex) {
    if (!query) return;

    const regex = getSmartRegex(query, 'gi');

    requestAnimationFrame(() => {
        setTimeout(() => {
            const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
            let node;
            let currentIndex = 0;

            while (node = walker.nextNode()) {
                const text = node.textContent;
                let match;
                while ((match = regex.exec(text)) !== null) {
                    if (currentIndex === targetIndex) {
                        try {
                            const range = document.createRange();
                            range.setStart(node, match.index);
                            range.setEnd(node, match.index + match[0].length);
                            const span = document.createElement('span');
                            span.style.backgroundColor = "#ffff00";
                            span.style.color = "black";
                            range.surroundContents(span);
                            span.scrollIntoView({ behavior: 'auto', block: 'center' });
                        } catch (e) {
                            node.parentElement.scrollIntoView({ behavior: 'auto', block: 'center' });
                            node.parentElement.style.backgroundColor = "#ffff00";
                        }
                        return;
                    }
                    currentIndex++;
                }
            }
        }, 100); 
    });
}

function initResizer() {
    let isResizing = false;
    resizer.addEventListener('mousedown', (e) => { isResizing = true; resizer.classList.add('active'); document.body.style.cursor = 'col-resize'; e.preventDefault(); });
    window.addEventListener('mousemove', (e) => { if (!isResizing) return; const newWidth = Math.min(Math.max(e.clientX, 150), window.innerWidth * 0.6); sidebar.style.width = `${newWidth}px`; });
    window.addEventListener('mouseup', () => { isResizing = false; resizer.classList.remove('active'); document.body.style.cursor = ''; });
}

function generateOutline(container) {
    const allElements = container.querySelectorAll('*');
    const outlineItems = [];
    const headingRegex = /Heading\s*([1-6])/i; 
    const titleRegex = /Title|Subtitle/i;
    allElements.forEach((el, index) => {
        const text = el.textContent.trim();
        if (!text || text.length > 120) return;
        let level = null;
        if (/^H[1-6]$/.test(el.tagName)) level = parseInt(el.tagName.substring(1));
        else if (el.className && typeof el.className === 'string') {
            const match = el.className.match(headingRegex);
            if (match) level = parseInt(match[1]);
            else if (titleRegex.test(el.className)) level = 1; 
        }
        if (level === null && el.tagName === 'P') {
            const style = window.getComputedStyle(el);
            const isBold = style.fontWeight === '700' || style.fontWeight === 'bold' || el.querySelector('b, strong');
            if (isBold && parseFloat(style.fontSize) > 14) level = 2;
        }
        if (level !== null) {
            const anchorId = `doc-outline-${index}`;
            el.id = anchorId;
            outlineItems.push({ el, level, text, id: anchorId });
        }
    });
    sidebarContent.innerHTML = "";
    if (outlineItems.length === 0) {
        sidebar.style.display = "block"; resizer.style.display = "block"; sidebarContent.innerHTML = "<div style='padding:10px 15px; color:#999; font-size:12px; font-style:italic;'>No outline found.</div>"; return;
    }
    sidebar.style.display = "block"; resizer.style.display = "block";
    outlineItems.forEach((item, i) => {
        const row = document.createElement('div');
        row.className = `outline-item outline-level-${item.level}`;
        row.style.paddingLeft = `${(item.level - 1) * 15 + 5}px`;
        const label = document.createElement('span');
        label.textContent = item.text;
        row.addEventListener('click', () => { const target = document.getElementById(item.id); if (target) target.scrollIntoView({ behavior: 'auto', block: 'start' }); });
        row.appendChild(label);
        sidebarContent.appendChild(row);
    });
}

function initSearch() {
    let searchDebounce;

    viewerSearchInput.addEventListener('input', () => {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => {
            performInternalSearch(viewerSearchInput.value);
        }, 300);
    });

    viewerSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) {
                navigateResult(-1);
            } else {
                navigateResult(1);
            }
        }
    });

    viewerSearchPrev.addEventListener('click', () => navigateResult(-1));
    viewerSearchNext.addEventListener('click', () => navigateResult(1));
    closeSearchPanel.addEventListener('click', () => {
        searchResultsPanel.classList.remove('active');
    });
}

function performInternalSearch(query) {
    internalSearchResults = [];
    internalSearchIndex = 0;
    searchResultsList.innerHTML = '';

    container.querySelectorAll('.internal-search-highlight').forEach(el => {
        const parent = el.parentNode;
        if (parent) {
            parent.replaceChild(document.createTextNode(el.textContent), el);
            parent.normalize();
        }
    });

    if (!query || !query.trim()) {
        viewerSearchCount.textContent = '';
        searchResultsPanel.classList.remove('active');
        return;
    }

    const searchTerm = query.trim().toLowerCase();
    const allResults = [];

    const headingRegex = /Heading\s*([1-6])/i;
    const titleRegex = /Title|Subtitle/i;
    const processedHeaders = new Set();

    const regex = getSmartRegex(searchTerm, 'gi');
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
    let node;

    while ((node = walker.nextNode())) {
        const text = node.textContent;
        const parentEl = node.parentElement;
        if (!parentEl) continue;

        let isInHeader = false;
        let headerEl = null;
        let checkEl = parentEl;

        while (checkEl && checkEl !== container) {
            if (/^H[1-6]$/.test(checkEl.tagName)) {
                isInHeader = true;
                headerEl = checkEl;
                break;
            } else if (checkEl.className && typeof checkEl.className === 'string') {
                if (headingRegex.test(checkEl.className) || titleRegex.test(checkEl.className)) {
                    isInHeader = true;
                    headerEl = checkEl;
                    break;
                }
            }

            if (checkEl.tagName === 'P') {
                const style = window.getComputedStyle(checkEl);
                const isBold = style.fontWeight === '700' || style.fontWeight === 'bold' || checkEl.querySelector('b, strong');
                if (isBold && parseFloat(style.fontSize) > 14) {
                    isInHeader = true;
                    headerEl = checkEl;
                    break;
                }
            }
            checkEl = checkEl.parentElement;
        }

        let match;
        regex.lastIndex = 0;

        while ((match = regex.exec(text)) !== null) {
            if (isInHeader && headerEl) {

                const headerText = headerEl.textContent.trim();
                if (!processedHeaders.has(headerText) && headerText.length <= 120) {
                    processedHeaders.add(headerText);
                    allResults.push({
                        type: 'header',
                        element: headerEl,
                        text: headerText,
                        matchText: headerText
                    });
                }
            } else {

                const start = Math.max(0, match.index - 40);
                const end = Math.min(text.length, match.index + match[0].length + 40);
                let snippet = text.substring(start, end).trim();
                if (start > 0) snippet = '...' + snippet;
                if (end < text.length) snippet = snippet + '...';

                allResults.push({
                    type: 'body',
                    node: node,
                    index: match.index,
                    length: match[0].length,
                    text: snippet,
                    matchText: match[0]
                });
            }
        }
    }

    internalSearchResults = allResults;

    const totalCount = internalSearchResults.length;
    viewerSearchCount.textContent = totalCount > 0 ? `1 / ${totalCount}` : 'No results';

    if (totalCount > 0) {
        searchResultsPanel.classList.add('active');
        renderSearchResults(searchTerm);
        highlightAndScrollToResult(0);
    } else {
        searchResultsPanel.classList.remove('active');
    }
}

function renderSearchResults(searchTerm) {
    searchResultsList.innerHTML = '';
    const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');

    internalSearchResults.forEach((result, index) => {
        const item = document.createElement('div');
        item.className = 'search-result-item' + (index === 0 ? ' active' : '');
        item.dataset.index = index;

        const typeLabel = document.createElement('div');
        typeLabel.className = `search-result-type ${result.type}`;
        typeLabel.textContent = result.type === 'header' ? 'Header' : 'Body';

        const textDiv = document.createElement('div');
        textDiv.className = 'search-result-text';
        textDiv.innerHTML = result.text.replace(regex, '<mark>$1</mark>');

        item.appendChild(typeLabel);
        item.appendChild(textDiv);

        item.addEventListener('click', () => {
            internalSearchIndex = index;
            highlightAndScrollToResult(index);
            updateActiveResultItem();
        });

        searchResultsList.appendChild(item);
    });
}

function highlightAndScrollToResult(index) {
    if (internalSearchResults.length === 0) return;

    container.querySelectorAll('.internal-search-active').forEach(el => {
        el.classList.remove('internal-search-active');
        el.style.backgroundColor = '#ffff99';
    });

    const result = internalSearchResults[index];
    if (!result) return;

    viewerSearchCount.textContent = `${index + 1} / ${internalSearchResults.length}`;

    if (result.type === 'header') {

        result.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        result.element.style.backgroundColor = '#ffcc00';
        result.element.style.transition = 'background 0.3s';
        result.element.classList.add('internal-search-active');
    } else {

        try {
            if (result.node && result.node.parentNode) {
                const range = document.createRange();
                range.setStart(result.node, result.index);
                range.setEnd(result.node, result.index + result.length);
                const span = document.createElement('span');
                span.className = 'internal-search-highlight internal-search-active';
                span.style.backgroundColor = '#ffcc00';
                span.style.color = 'black';
                range.surroundContents(span);
                span.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        } catch (e) {
            if (result.node && result.node.parentElement) {
                result.node.parentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                result.node.parentElement.style.backgroundColor = '#ffcc00';
            }
        }
    }

    updateActiveResultItem();
}

function updateActiveResultItem() {
    searchResultsList.querySelectorAll('.search-result-item').forEach((item, i) => {
        item.classList.toggle('active', i === internalSearchIndex);
    });

    const activeItem = searchResultsList.querySelector('.search-result-item.active');
    if (activeItem) {
        activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function navigateResult(direction) {
    if (internalSearchResults.length === 0) return;
    internalSearchIndex = (internalSearchIndex + direction + internalSearchResults.length) % internalSearchResults.length;
    highlightAndScrollToResult(internalSearchIndex);
}
