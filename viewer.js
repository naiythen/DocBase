const DB_NAME = "DocxSearchDB";
const STORE_NAME = "documents";
const DB_VERSION = 7; 

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

// Search elements
const viewerSearchInput = document.getElementById('viewer-search-input');
const viewerSearchCount = document.getElementById('viewer-search-count');
const viewerSearchPrev = document.getElementById('viewer-search-prev');
const viewerSearchNext = document.getElementById('viewer-search-next');
const searchResultsPanel = document.getElementById('search-results-panel');
const searchResultsList = document.getElementById('search-results-list');
const closeSearchPanel = document.getElementById('close-search-panel');

// Speech builder elements
const speechBuilderBtn = document.getElementById('speech-builder-btn');
const speechPanel = document.getElementById('speech-panel');
const closeSpeechPanel = document.getElementById('close-speech-panel');
const addCardBtn = document.getElementById('add-card-btn');
const clearCardsBtn = document.getElementById('clear-cards-btn');
const cardLabelInput = document.getElementById('card-label-input');
const speechMessage = document.getElementById('speech-message');
const speechCardList = document.getElementById('speech-card-list');
const speechCardCount = document.getElementById('speech-card-count');
const speechWordCount = document.getElementById('speech-word-count');
const speechTime = document.getElementById('speech-time');
const speechWpmInput = document.getElementById('speech-wpm');
const speechPreviewFrame = document.getElementById('speech-preview-frame');
const openPreviewTabBtn = document.getElementById('open-preview-tab');

let internalSearchResults = [];
let internalSearchIndex = 0;

const SPEECH_CARDS_KEY = 'docbaseSpeechCards';
const SPEECH_SETTINGS_KEY = 'docbaseSpeechSettings';
const hasChromeStorage = () => typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
const hasChromeTabs = () => typeof chrome !== 'undefined' && chrome.tabs;

initResizer();
initSearch();
initSpeechBuilder();

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
                    setupDownload(doc); // Setup the download button
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
            a.download = doc.title; // Uses original filename
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

// --- HELPER: SMART REGEX GENERATOR ---
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

// ==================== INTERNAL SEARCH FUNCTIONALITY ====================

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
    
    // Clear previous highlights
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
    
    // Walk through all text nodes in document order to maintain position
    // Use getSmartRegex for word boundary matching on short words (< 5 chars)
    const regex = getSmartRegex(searchTerm, 'gi');
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
    let node;
    
    while ((node = walker.nextNode())) {
        const text = node.textContent;
        const parentEl = node.parentElement;
        if (!parentEl) continue;
        
        // Check if this node is inside a header by walking up the tree
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
            // Check for bold paragraph headers
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
                // Header result - only add once per unique header
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
                // Body result
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
    
    // Results are already in document order since we walked through the DOM in order
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
    
    // Clear previous active highlights
    container.querySelectorAll('.internal-search-active').forEach(el => {
        el.classList.remove('internal-search-active');
        el.style.backgroundColor = '#ffff99';
    });
    
    const result = internalSearchResults[index];
    if (!result) return;
    
    viewerSearchCount.textContent = `${index + 1} / ${internalSearchResults.length}`;
    
    if (result.type === 'header') {
        // For headers, scroll to and highlight the entire header element
        result.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        result.element.style.backgroundColor = '#ffcc00';
        result.element.style.transition = 'background 0.3s';
        result.element.classList.add('internal-search-active');
    } else {
        // For body results, highlight the specific match
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
    
    // Scroll the active item into view in the results panel
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

// ==================== SPEECH BUILDER FUNCTIONALITY ====================

function initSpeechBuilder() {
    if (!speechPanel) return;

    speechBuilderBtn.addEventListener('click', () => {
        speechPanel.classList.add('active');
        searchResultsPanel.classList.remove('active');
        refreshSpeechData();
    });

    closeSpeechPanel.addEventListener('click', () => {
        speechPanel.classList.remove('active');
    });

    addCardBtn.addEventListener('click', () => addHighlightedCard());
    clearCardsBtn.addEventListener('click', () => clearAllCards());
    speechWpmInput.addEventListener('change', () => updateSpeechSettings());
    openPreviewTabBtn.addEventListener('click', () => openSpeechPreviewTab());

    refreshSpeechData();
}

function showSpeechMessage(message, isError = false) {
    speechMessage.textContent = message;
    speechMessage.style.color = isError ? '#d93025' : '#1a73e8';
}

function normalizeSelectionText(text) {
    return text
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function countWords(text) {
    return text ? text.trim().split(/\s+/).filter(Boolean).length : 0;
}

function formatTime(minutes) {
    const totalSeconds = Math.round(minutes * 60);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatTimeForWords(words, wpm) {
    if (!wpm) return formatTime(0);
    return formatTime(words / wpm);
}

function getSpeechStorage() {
    return new Promise((resolve) => {
        if (hasChromeStorage()) {
            chrome.storage.local.get([SPEECH_CARDS_KEY, SPEECH_SETTINGS_KEY], (result) => {
                resolve({
                    cards: result[SPEECH_CARDS_KEY] || [],
                    settings: result[SPEECH_SETTINGS_KEY] || { wpm: 160 }
                });
            });
            return;
        }

        const cards = JSON.parse(localStorage.getItem(SPEECH_CARDS_KEY) || '[]');
        const settings = JSON.parse(localStorage.getItem(SPEECH_SETTINGS_KEY) || '{"wpm":160}');
        resolve({ cards, settings });
    });
}

function setSpeechStorage(cards, settings) {
    return new Promise((resolve) => {
        if (hasChromeStorage()) {
            chrome.storage.local.set({
                [SPEECH_CARDS_KEY]: cards,
                [SPEECH_SETTINGS_KEY]: settings
            }, resolve);
            return;
        }

        localStorage.setItem(SPEECH_CARDS_KEY, JSON.stringify(cards));
        localStorage.setItem(SPEECH_SETTINGS_KEY, JSON.stringify(settings));
        resolve();
    });
}

async function refreshSpeechData() {
    const { cards, settings } = await getSpeechStorage();
    speechWpmInput.value = settings.wpm || 160;
    renderSpeechCards(cards, settings);
    refreshSpeechPreview();
}

async function updateSpeechSettings() {
    const { cards, settings } = await getSpeechStorage();
    const wpm = parseInt(speechWpmInput.value, 10);
    const sanitized = Number.isNaN(wpm) ? 160 : Math.min(Math.max(wpm, 80), 300);
    speechWpmInput.value = sanitized;
    settings.wpm = sanitized;
    await setSpeechStorage(cards, settings);
    renderSpeechCards(cards, settings);
    refreshSpeechPreview();
}

async function addHighlightedCard() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
        showSpeechMessage('Select text in the document first.', true);
        return;
    }

    const isInsideDoc = container.contains(selection.anchorNode) || container.contains(selection.focusNode);
    if (!isInsideDoc) {
        showSpeechMessage('Highlight text inside the document viewer.', true);
        return;
    }

    const rawText = selection.toString();
    const cleanedText = normalizeSelectionText(rawText);

    if (!cleanedText) {
        showSpeechMessage('Selection is empty after cleaning.', true);
        return;
    }

    const label = cardLabelInput.value.trim();
    const wordCount = countWords(cleanedText);
    const { cards, settings } = await getSpeechStorage();

    const newCard = {
        id: Date.now(),
        label,
        rawText,
        cleanedText,
        wordCount,
        createdAt: new Date().toISOString()
    };

    const updatedCards = [newCard, ...cards];
    await setSpeechStorage(updatedCards, settings);

    selection.removeAllRanges();
    cardLabelInput.value = '';
    const totalWords = updatedCards.reduce((sum, card) => sum + (card.wordCount || 0), 0);
    const wpm = settings?.wpm || 160;
    showSpeechMessage(`Card added: ${wordCount} words (~${formatTimeForWords(wordCount, wpm)}). Total: ${totalWords} words (~${formatTimeForWords(totalWords, wpm)}).`);
    renderSpeechCards(updatedCards, settings);
    refreshSpeechPreview();
}

async function removeSpeechCard(cardId) {
    const { cards, settings } = await getSpeechStorage();
    const updatedCards = cards.filter(card => card.id !== cardId);
    await setSpeechStorage(updatedCards, settings);
    renderSpeechCards(updatedCards, settings);
    refreshSpeechPreview();
}

async function clearAllCards() {
    const { settings } = await getSpeechStorage();
    await setSpeechStorage([], settings);
    renderSpeechCards([], settings);
    refreshSpeechPreview();
    showSpeechMessage('All cards cleared.');
}

function renderSpeechCards(cards, settings) {
    speechCardList.innerHTML = '';
    const totalWords = cards.reduce((sum, card) => sum + (card.wordCount || 0), 0);
    const wpm = settings?.wpm || 160;
    const minutes = totalWords / wpm;

    speechCardCount.textContent = cards.length;
    speechWordCount.textContent = totalWords;
    speechTime.textContent = formatTime(minutes);

    if (cards.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'font-size:12px; color:#777; padding:10px 4px;';
        empty.textContent = 'No cards yet. Highlight evidence and add it here.';
        speechCardList.appendChild(empty);
        return;
    }

    cards.forEach((card) => {
        const item = document.createElement('div');
        item.className = 'speech-card-item';

        if (card.label) {
            const label = document.createElement('h4');
            label.textContent = card.label;
            item.appendChild(label);
        }

        const text = document.createElement('p');
        text.textContent = card.cleanedText || card.rawText;
        item.appendChild(text);

        const meta = document.createElement('div');
        meta.className = 'speech-card-meta';
        const cardWords = card.wordCount || 0;
        meta.innerHTML = `<span>${cardWords} words · ${formatTimeForWords(cardWords, wpm)}</span>`;

        const removeBtn = document.createElement('button');
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', () => removeSpeechCard(card.id));

        meta.appendChild(removeBtn);
        item.appendChild(meta);
        speechCardList.appendChild(item);
    });
}

function refreshSpeechPreview() {
    if (!speechPreviewFrame) return;
    if (speechPreviewFrame.contentWindow) {
        speechPreviewFrame.contentWindow.postMessage({ type: 'docbase-refresh-speech' }, '*');
    }
}

function openSpeechPreviewTab() {
    if (hasChromeTabs()) {
        const url = chrome.runtime.getURL('debate.html');
        chrome.tabs.create({ url });
        return;
    }

    window.open('debate.html', '_blank', 'noopener');
}
