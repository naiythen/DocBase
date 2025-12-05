const DB_NAME = "DocxSearchDB";
const STORE_NAME = "documents";
const DB_VERSION = 3; 

const params = new URLSearchParams(window.location.search);
const docId = parseInt(params.get('id'));
const searchQuery = params.get('q'); 

const titleEl = document.getElementById('doc-title');
const container = document.getElementById('doc-container');
const statusEl = document.getElementById('status');
const printBtn = document.getElementById('print-btn');
const sidebar = document.getElementById('outline-sidebar');
const sidebarContent = document.getElementById('outline-content');
const resizer = document.getElementById('resizer');

// --- Init Sidebar Logic Immediately ---
initResizer();

if (printBtn) {
    printBtn.addEventListener('click', () => window.print());
}

if (!docId) {
    statusEl.textContent = "Error: No document ID provided.";
} else {
    initDBAndRender();
}

function initDBAndRender() {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = (event) => {
        statusEl.innerHTML = "Database Error. Please clear DB in Manager.";
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
                } else {
                    statusEl.textContent = "Error: Document not found.";
                }
            };
        } catch(e) {
            statusEl.textContent = "Error: Database version mismatch.";
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
        
        // Render Doc
        await docx.renderAsync(buffer, container, null, {
            inWrapper: false, ignoreWidth: false, experimental: true
        });

        generateOutline(container);

        // Run search immediately (Instant, no animation)
        if (searchQuery) scrollToMatch(container, searchQuery);

    } catch (e) {
        console.error(e);
        container.innerHTML = `<div style="color:red; padding:20px;">Error: ${e.message}</div>`;
    }
}

// --- RESIZER LOGIC ---
function initResizer() {
    let isResizing = false;

    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none'; // Prevent selection while dragging
    });

    window.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        // Constrain width
        const newWidth = Math.min(Math.max(e.clientX, 150), window.innerWidth * 0.6);
        sidebar.style.width = `${newWidth}px`;
    });

    window.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = ''; // Re-enable selection
        }
    });
}

// --- OUTLINE GENERATOR ---
function generateOutline(container) {
    const allElements = container.querySelectorAll('*');
    const outlineItems = [];
    const headingRegex = /Heading\s*([1-6])/i; 
    const titleRegex = /Title|Subtitle/i;

    allElements.forEach((el, index) => {
        const text = el.textContent.trim();
        if (!text || text.length > 120) return;

        let level = null;

        // 1. Tag Check
        if (/^H[1-6]$/.test(el.tagName)) {
            level = parseInt(el.tagName.substring(1));
        } 
        // 2. Style Check
        else if (el.className && typeof el.className === 'string') {
            const match = el.className.match(headingRegex);
            if (match) level = parseInt(match[1]);
            else if (titleRegex.test(el.className)) level = 1;
        }
        // 3. Manual Check (Bold P tags)
        if (level === null && el.tagName === 'P') {
            const style = window.getComputedStyle(el);
            const isBold = style.fontWeight === '700' || style.fontWeight === 'bold' || el.querySelector('b, strong');
            const isLarge = parseFloat(style.fontSize) > 14; 
            
            if (isBold || isLarge) level = isLarge ? 2 : 3;
        }

        if (level !== null) {
            const anchorId = `doc-outline-${index}`;
            el.id = anchorId;
            outlineItems.push({ el, level, text, id: anchorId });
        }
    });

    sidebarContent.innerHTML = "";

    if (outlineItems.length === 0) {
        // Even if empty, ensure sidebar is draggable and visible
        sidebar.style.display = "block";
        resizer.style.display = "block";
        sidebarContent.innerHTML = "<div style='padding:10px 15px; color:#999; font-size:12px;'>No outline.</div>";
        return;
    }

    sidebar.style.display = "block";
    resizer.style.display = "block";

    const sidebarDivs = []; 

    outlineItems.forEach((item, i) => {
        const row = document.createElement('div');
        row.className = `outline-item outline-level-${item.level}`;
        row.dataset.level = item.level; 
        row.dataset.targetId = item.id; 

        // Indent based on level
        const indentVal = (item.level - 1) * 15 + 5; 
        row.style.paddingLeft = `${indentVal}px`;

        const arrow = document.createElement('div');
        arrow.className = "toggle-btn";
        arrow.innerHTML = "▼"; 

        // Parent/Child Detection
        let hasChildren = false;
        for (let j = i + 1; j < outlineItems.length; j++) {
            if (outlineItems[j].level > item.level) {
                hasChildren = true;
                break;
            } else if (outlineItems[j].level <= item.level) {
                break;
            }
        }

        if (hasChildren) {
            arrow.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleChildren(row, item.level);
                arrow.classList.toggle('collapsed');
            });
        } else {
            arrow.classList.add('invisible');
        }

        const label = document.createElement('span');
        label.textContent = item.text;
        label.style.overflow = "hidden";
        label.style.textOverflow = "ellipsis";

        row.addEventListener('click', () => {
            const target = document.getElementById(item.id);
            if (target) target.scrollIntoView({ behavior: 'auto', block: 'start' });
        });

        row.appendChild(arrow);
        row.appendChild(label);
        sidebarContent.appendChild(row);
        
        sidebarDivs.push({ row, targetId: item.id });
    });

    initScrollSpy(sidebarDivs);
}

function toggleChildren(parentRow, parentLevel) {
    let nextSibling = parentRow.nextElementSibling;
    while (nextSibling) {
        const siblingLevel = parseInt(nextSibling.dataset.level);
        if (siblingLevel <= parentLevel) break;
        if (nextSibling.classList.contains('hidden-node')) {
            nextSibling.classList.remove('hidden-node');
        } else {
            nextSibling.classList.add('hidden-node');
        }
        nextSibling = nextSibling.nextElementSibling;
    }
}

// --- SCROLL SPY ---
function initScrollSpy(sidebarDivs) {
    let isTicking = false;
    container.addEventListener('scroll', () => {
        if (!isTicking) {
            window.requestAnimationFrame(() => {
                updateActiveHeader(sidebarDivs);
                isTicking = false;
            });
            isTicking = true;
        }
    });
}

function updateActiveHeader(sidebarDivs) {
    const containerRect = container.getBoundingClientRect();
    const offsetBuffer = 150; 
    let activeIndex = -1;

    for (let i = 0; i < sidebarDivs.length; i++) {
        const targetEl = document.getElementById(sidebarDivs[i].targetId);
        if (!targetEl) continue;
        const rect = targetEl.getBoundingClientRect();
        if (rect.top <= containerRect.top + offsetBuffer) {
            activeIndex = i;
        } else {
            break; 
        }
    }

    sidebarDivs.forEach((item, index) => {
        if (index === activeIndex) {
            if (!item.row.classList.contains('active')) {
                item.row.classList.add('active');
                ensureSidebarVisible(item.row);
            }
        } else {
            item.row.classList.remove('active');
        }
    });
}

function ensureSidebarVisible(el) {
    const sidebarRect = sidebar.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    if (elRect.bottom > sidebarRect.bottom) {
        el.scrollIntoView({ block: 'nearest' });
    } else if (elRect.top < sidebarRect.top) {
        el.scrollIntoView({ block: 'nearest' });
    }
}

// --- SEARCH SCROLL (STANDARD MATCH) ---
// Reverted to standard 'indexOf' to match your logic.js
function scrollToMatch(container, query) {
    if (!query) return;

    // Wait 1 frame to ensure render
    requestAnimationFrame(() => {
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
        let node;
        
        // Basic Case Insensitive Match (Standard)
        const lowerQuery = query.toLowerCase();

        while (node = walker.nextNode()) {
            const text = node.textContent;
            const index = text.toLowerCase().indexOf(lowerQuery);

            if (index >= 0) {
                const matchIndex = index;
                const matchLength = query.length; // Use the query length as proxy

                const matchAndAfter = node.splitText(matchIndex);
                matchAndAfter.splitText(matchLength);

                const span = document.createElement('span');
                span.className = "scrolled-highlight";
                span.style.backgroundColor = "#ffff00";
                span.style.outline = "3px solid #ffff00";
                
                matchAndAfter.parentNode.insertBefore(span, matchAndAfter);
                span.appendChild(matchAndAfter);
                
                // INSTANT SCROLL
                span.scrollIntoView({ behavior: 'auto', block: 'center' });
                break; 
            }
        }
    });
}