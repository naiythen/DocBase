const DB_NAME = "DocxSearchDB";
const STORE_NAME = "documents";
const DB_VERSION = 6; 

const params = new URLSearchParams(window.location.search);
const docId = parseInt(params.get('id'));
const searchQuery = params.get('q'); 
const targetHeader = params.get('target'); 
const matchIndex = params.has('idx') ? parseInt(params.get('idx')) : -1;

const titleEl = document.getElementById('doc-title');
const container = document.getElementById('doc-container');
const statusEl = document.getElementById('status');
const printBtn = document.getElementById('print-btn');
const sidebar = document.getElementById('outline-sidebar');
const sidebarContent = document.getElementById('outline-content');
const resizer = document.getElementById('resizer');

initResizer();

if (printBtn) printBtn.addEventListener('click', () => window.print());

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
                if (doc) renderDoc(doc);
                else statusEl.textContent = "Error: Document not found.";
            };
        } catch(e) {
            statusEl.textContent = "Error: DB Version Mismatch.";
        }
    };
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

// --- HELPER: SMART REGEX GENERATOR (Fixed with Capturing Groups) ---
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