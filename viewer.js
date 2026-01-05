const DB_NAME = "DocxSearchDB";
const STORE_NAME = "documents";
const DB_VERSION = 7; 
const CARD_BUILDER_KEY = "docbaseCardBuilderState";

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

// Card Extractor Elements
const cardExtractorPanel = document.getElementById('card-extractor-panel');
const toggleCardExtractorBtn = document.getElementById('toggle-card-extractor');
const closeCardExtractorBtn = document.getElementById('close-card-extractor');
const addSelectionBtn = document.getElementById('add-selection-btn');
const extractFormattedBtn = document.getElementById('extract-formatted-btn');
const copyCardsBtn = document.getElementById('copy-cards-btn');
const clearCardsBtn = document.getElementById('clear-cards-btn');
const cardExtractorArea = document.getElementById('card-extractor-area');
const cardMessage = document.getElementById('card-message');
const filterUnderlined = document.getElementById('filter-underlined');
const filterBolded = document.getElementById('filter-bolded');
const filterHighlighted = document.getElementById('filter-highlighted');
const stripUnderline = document.getElementById('strip-underline');
const speechWordCount = document.getElementById('speech-word-count');
const speechTimings = document.getElementById('speech-timings');
const speakerList = document.getElementById('speaker-list');
const addSpeakerBtn = document.getElementById('add-speaker-btn');

// Search elements
const viewerSearchInput = document.getElementById('viewer-search-input');
const viewerSearchCount = document.getElementById('viewer-search-count');
const viewerSearchPrev = document.getElementById('viewer-search-prev');
const viewerSearchNext = document.getElementById('viewer-search-next');
const searchResultsPanel = document.getElementById('search-results-panel');
const searchResultsList = document.getElementById('search-results-list');
const closeSearchPanel = document.getElementById('close-search-panel');

let internalSearchResults = [];
let internalSearchIndex = 0;

let cardBuilderState = {
    html: "",
    settings: {
        underlined: true,
        bolded: true,
        highlighted: false,
        stripUnderline: false
    },
    speakers: [
        { id: 1, name: "Speaker 1", wpm: 150 }
    ]
};

initResizer();
initSearch();
initCardExtractor();

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

// ==================== CARD EXTRACTOR ====================

function initCardExtractor() {
    loadCardBuilderState();
    bindCardExtractorEvents();
    renderCardBuilderState();
    updateSpeechSummary();
}

function bindCardExtractorEvents() {
    if (toggleCardExtractorBtn) {
        toggleCardExtractorBtn.addEventListener('click', () => {
            cardExtractorPanel.classList.add('active');
        });
    }
    if (closeCardExtractorBtn) {
        closeCardExtractorBtn.addEventListener('click', () => {
            cardExtractorPanel.classList.remove('active');
        });
    }

    if (addSelectionBtn) addSelectionBtn.addEventListener('click', addSelectionToCards);
    if (extractFormattedBtn) extractFormattedBtn.addEventListener('click', extractOnlyFormattedText);
    if (copyCardsBtn) copyCardsBtn.addEventListener('click', copyExtractedCards);
    if (clearCardsBtn) clearCardsBtn.addEventListener('click', clearCardExtractor);

    if (cardExtractorArea) {
        cardExtractorArea.addEventListener('input', () => {
            cardBuilderState.html = cardExtractorArea.innerHTML;
            saveCardBuilderState();
            updateSpeechSummary();
        });
    }

    [filterUnderlined, filterBolded, filterHighlighted, stripUnderline].forEach((checkbox) => {
        if (!checkbox) return;
        checkbox.addEventListener('change', () => {
            cardBuilderState.settings = {
                underlined: filterUnderlined.checked,
                bolded: filterBolded.checked,
                highlighted: filterHighlighted.checked,
                stripUnderline: stripUnderline.checked
            };
            saveCardBuilderState();
        });
    });

    if (addSpeakerBtn) {
        addSpeakerBtn.addEventListener('click', addSpeaker);
    }
}

function loadCardBuilderState() {
    try {
        const stored = localStorage.getItem(CARD_BUILDER_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            cardBuilderState = {
                ...cardBuilderState,
                ...parsed,
                settings: { ...cardBuilderState.settings, ...parsed.settings },
                speakers: parsed.speakers && parsed.speakers.length > 0 ? parsed.speakers : cardBuilderState.speakers
            };
        }
    } catch (error) {
        console.error("Failed to load card builder state:", error);
    }
}

function saveCardBuilderState() {
    try {
        localStorage.setItem(CARD_BUILDER_KEY, JSON.stringify(cardBuilderState));
    } catch (error) {
        console.error("Failed to save card builder state:", error);
    }
}

function renderCardBuilderState() {
    if (!cardExtractorArea) return;
    cardExtractorArea.innerHTML = cardBuilderState.html || "";
    filterUnderlined.checked = cardBuilderState.settings.underlined;
    filterBolded.checked = cardBuilderState.settings.bolded;
    filterHighlighted.checked = cardBuilderState.settings.highlighted;
    stripUnderline.checked = cardBuilderState.settings.stripUnderline;
    renderSpeakers();
}

function showCardMessage(message, type) {
    if (!cardMessage) return;
    cardMessage.textContent = message;
    cardMessage.className = '';
    cardMessage.classList.add(type);
    cardMessage.style.display = 'block';
    clearTimeout(cardMessage._timeoutId);
    cardMessage._timeoutId = setTimeout(() => {
        cardMessage.className = '';
        cardMessage.style.display = 'none';
    }, 3000);
}

function getSelectionHtml() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return "";
    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
        return "";
    }
    const wrapper = document.createElement('div');
    wrapper.appendChild(range.cloneContents());
    return wrapper.innerHTML.trim();
}

function removeUnderlineFromHtml(html) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    tempDiv.querySelectorAll('u').forEach(u => {
        const span = document.createElement('span');
        span.innerHTML = u.innerHTML;
        u.replaceWith(span);
    });
    tempDiv.querySelectorAll('*').forEach(el => {
        if (el.style.textDecoration) {
            el.style.textDecoration = el.style.textDecoration.replace(/underline/gi, '').trim() || '';
        }
        if (el.style.textDecorationLine) {
            el.style.textDecorationLine = el.style.textDecorationLine.replace(/underline/gi, '').trim() || '';
        }
    });
    return tempDiv.innerHTML;
}

function addSelectionToCards() {
    if (!cardExtractorArea) return;
    let html = getSelectionHtml();
    if (!html) {
        showCardMessage("Select text in the document first.", "warn");
        return;
    }
    if (cardBuilderState.settings.stripUnderline) {
        html = removeUnderlineFromHtml(html);
    }
    const block = document.createElement('div');
    block.className = 'card-block';
    block.innerHTML = html;
    cardExtractorArea.appendChild(block);
    cardBuilderState.html = cardExtractorArea.innerHTML;
    saveCardBuilderState();
    updateSpeechSummary();
    showCardMessage("Selection added to card workspace.", "success");
}

function clearCardExtractor() {
    if (!cardExtractorArea) return;
    cardExtractorArea.innerHTML = "";
    cardBuilderState.html = "";
    saveCardBuilderState();
    updateSpeechSummary();
    showCardMessage("Card workspace cleared.", "info");
}

async function copyExtractedCards() {
    if (!cardExtractorArea || !cardExtractorArea.textContent.trim()) {
        showCardMessage("Nothing to copy yet.", "warn");
        return;
    }
    const html = cardExtractorArea.innerHTML;
    const text = cardExtractorArea.textContent;

    try {
        if (navigator.clipboard && window.ClipboardItem) {
            const htmlBlob = new Blob([html], { type: "text/html" });
            const textBlob = new Blob([text], { type: "text/plain" });
            await navigator.clipboard.write([new ClipboardItem({ "text/html": htmlBlob, "text/plain": textBlob })]);
        } else {
            const range = document.createRange();
            range.selectNodeContents(cardExtractorArea);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            document.execCommand('copy');
            selection.removeAllRanges();
        }
        showCardMessage("Cards copied to clipboard.", "success");
    } catch (error) {
        showCardMessage("Copy failed. Please copy manually.", "warn");
    }
}

function updateSpeechSummary() {
    if (!speechWordCount || !speechTimings || !cardExtractorArea) return;
    const text = cardExtractorArea.textContent.trim();
    const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
    speechWordCount.textContent = wordCount.toString();
    speechTimings.innerHTML = "";

    if (wordCount === 0) {
        speechTimings.innerHTML = "<div class=\"time-row\"><span class=\"time-label\">No content yet</span></div>";
        return;
    }

    cardBuilderState.speakers.forEach((speaker) => {
        const minutes = wordCount / (speaker.wpm || 150);
        const mins = Math.floor(minutes);
        const secs = Math.round((minutes - mins) * 60);
        const row = document.createElement('div');
        row.className = 'time-row';
        row.innerHTML = `
            <span class="time-label">${speaker.name}</span>
            <span>${mins}m ${secs}s</span>
        `;
        speechTimings.appendChild(row);
    });
}

function renderSpeakers() {
    if (!speakerList) return;
    speakerList.innerHTML = "";
    cardBuilderState.speakers.forEach((speaker) => {
        const row = document.createElement('div');
        row.className = 'speaker-row';
        row.innerHTML = `
            <input type="text" value="${speaker.name}" data-id="${speaker.id}" data-field="name" />
            <input type="number" value="${speaker.wpm}" min="50" max="500" data-id="${speaker.id}" data-field="wpm" />
            <button title="Remove speaker" data-id="${speaker.id}">✕</button>
        `;
        row.querySelectorAll('input').forEach((input) => {
            input.addEventListener('input', handleSpeakerChange);
        });
        row.querySelector('button').addEventListener('click', () => removeSpeaker(speaker.id));
        speakerList.appendChild(row);
    });
}

function handleSpeakerChange(event) {
    const input = event.target;
    const id = parseInt(input.dataset.id, 10);
    const field = input.dataset.field;
    const speaker = cardBuilderState.speakers.find(s => s.id === id);
    if (!speaker) return;
    if (field === "name") {
        speaker.name = input.value.trim() || `Speaker ${id}`;
    }
    if (field === "wpm") {
        speaker.wpm = parseInt(input.value, 10) || 150;
    }
    saveCardBuilderState();
    updateSpeechSummary();
}

function addSpeaker() {
    const newId = cardBuilderState.speakers.length > 0
        ? Math.max(...cardBuilderState.speakers.map(s => s.id)) + 1
        : 1;
    cardBuilderState.speakers.push({ id: newId, name: `Speaker ${newId}`, wpm: 150 });
    saveCardBuilderState();
    renderSpeakers();
    updateSpeechSummary();
}

function removeSpeaker(id) {
    if (cardBuilderState.speakers.length <= 1) {
        showCardMessage("At least one speaker is required.", "warn");
        return;
    }
    cardBuilderState.speakers = cardBuilderState.speakers.filter(s => s.id !== id);
    saveCardBuilderState();
    renderSpeakers();
    updateSpeechSummary();
}

function isHighlightColor(color) {
    if (!color || color === 'transparent' || color === '' || color === 'initial') {
        return false;
    }
    if (color === 'rgba(0, 0, 0, 0)') return false;
    if (color === 'rgb(255, 255, 255)' || color === 'rgba(255, 255, 255, 1)') return false;
    const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (rgbMatch) {
        const r = parseInt(rgbMatch[1], 10);
        const g = parseInt(rgbMatch[2], 10);
        const b = parseInt(rgbMatch[3], 10);
        if (r > 240 && g > 240 && b > 240) return false;
    }
    return true;
}

function getElementFormatting(element) {
    if (!element || element.nodeType !== 1) return { bold: false, underlined: false, highlighted: false };
    const style = element.style;
    const computedStyle = window.getComputedStyle(element);
    const className = (element.className || '').toString().toLowerCase();

    let isBold = false;
    let isUnderlined = false;
    let isHighlighted = false;

    if (['B', 'STRONG'].includes(element.tagName)) isBold = true;
    const fontWeight = style.fontWeight || '';
    const computedFontWeight = computedStyle.fontWeight || '';
    if (fontWeight === 'bold' || parseInt(fontWeight, 10) >= 700) isBold = true;
    if (computedFontWeight === 'bold' || parseInt(computedFontWeight, 10) >= 700) isBold = true;
    if (className.includes('bold')) isBold = true;

    if (element.tagName === 'U') isUnderlined = true;
    const textDecoration = style.textDecoration || style.textDecorationLine || '';
    const computedTextDecoration = computedStyle.textDecoration || computedStyle.textDecorationLine || '';
    if (textDecoration.includes('underline') || computedTextDecoration.includes('underline')) isUnderlined = true;
    if (className.includes('underline') || className.includes('emphasis')) isUnderlined = true;

    if (element.tagName === 'MARK') isHighlighted = true;
    const bgColor = style.backgroundColor || '';
    const computedBgColor = computedStyle.backgroundColor || '';
    if (isHighlightColor(bgColor) || isHighlightColor(computedBgColor)) isHighlighted = true;
    if (className.includes('highlight')) isHighlighted = true;

    return { bold: isBold, underlined: isUnderlined, highlighted: isHighlighted };
}

function isFormattingElement(element) {
    if (!element || element.nodeType !== 1) return false;
    const blockTags = ['P', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'NAV',
        'ASIDE', 'MAIN', 'TABLE', 'TR', 'TD', 'TH', 'TBODY', 'THEAD',
        'UL', 'OL', 'LI', 'DL', 'DT', 'DD', 'BLOCKQUOTE', 'PRE',
        'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'BR', 'FIGURE', 'FIGCAPTION'];
    if (blockTags.includes(element.tagName)) {
        return false;
    }

    if (!cardBuilderState.settings.underlined && !cardBuilderState.settings.bolded && !cardBuilderState.settings.highlighted) {
        return false;
    }

    const formatting = getElementFormatting(element);

    if (cardBuilderState.settings.highlighted && formatting.highlighted) {
        return true;
    }

    if (cardBuilderState.settings.underlined && formatting.underlined) {
        return true;
    }

    if (cardBuilderState.settings.bolded && !cardBuilderState.settings.underlined) {
        if (formatting.bold) {
            return true;
        }
    }

    if (cardBuilderState.settings.bolded && cardBuilderState.settings.underlined) {
        if (formatting.bold) {
            return true;
        }
    }

    return false;
}

function collectFormattedContent(node, extractedHtmlChunks) {
    if (node.nodeType === 1) {
        if (isFormattingElement(node)) {
            const trimmedText = node.textContent.trim();
            if (trimmedText.length > 0) {
                extractedHtmlChunks.push(`<div class="card-block">${node.outerHTML}</div>`);
                return;
            }
        }
    }
    if (node.hasChildNodes()) {
        node.childNodes.forEach(child => collectFormattedContent(child, extractedHtmlChunks));
    }
}

function extractOnlyFormattedText() {
    if (!cardExtractorArea || !cardExtractorArea.textContent.trim()) {
        showCardMessage("Add a selection before extracting.", "warn");
        return;
    }

    if (!cardBuilderState.settings.underlined && !cardBuilderState.settings.bolded && !cardBuilderState.settings.highlighted) {
        showCardMessage("Enable at least one format filter.", "warn");
        return;
    }

    const extractedHtmlChunks = [];
    cardExtractorArea.childNodes.forEach(child => collectFormattedContent(child, extractedHtmlChunks));
    cardExtractorArea.innerHTML = extractedHtmlChunks.join(' ');
    cardBuilderState.html = cardExtractorArea.innerHTML;
    saveCardBuilderState();
    updateSpeechSummary();

    if (!cardExtractorArea.textContent.trim()) {
        showCardMessage("All content was unformatted and removed.", "warn");
    } else {
        showCardMessage("Extraction complete.", "success");
    }
}
