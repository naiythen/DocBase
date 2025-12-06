// --- Database Setup ---
const DB_NAME = "DocxSearchDB";
const STORE_NAME = "documents";
const DB_VERSION = 6; 
let db;

// --- Global State ---
let allGroupedResults = [];
let renderLimit = 50; 

const initDB = () => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
            }
        };
        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };
        request.onerror = (event) => {
            console.error("IndexedDB error:", event.target.error);
            reject("DB Error");
        };
    });
};

// --- UI Elements ---
const searchBox = document.getElementById('search-box');
const resultsArea = document.getElementById('results-area');
const fileInput = document.getElementById('file-input');
const uploadStatus = document.getElementById('upload-status');
const fileListBody = document.getElementById('file-list-body');

const managerModal = document.getElementById('manager-modal');
const openManagerBtn = document.getElementById('open-manager-btn');
const closeManagerBtn = document.getElementById('close-manager-btn');
const resetDbBtn = document.getElementById('reset-db-btn');

// --- Modal Logic ---
openManagerBtn.addEventListener('click', () => {
    managerModal.style.display = "flex";
    loadFileTable(); 
});
closeManagerBtn.addEventListener('click', () => {
    managerModal.style.display = "none";
});
window.addEventListener('click', (e) => {
    if (e.target == managerModal) managerModal.style.display = "none";
});

// --- Upload Logic ---
fileInput.addEventListener('change', async (e) => {
    const files = e.target.files;
    if (!files.length) return;
    uploadStatus.textContent = `Processing ${files.length} files...`;
    for (let i = 0; i < files.length; i++) {
        await processFile(files[i]);
    }
    uploadStatus.textContent = `Success! Added ${files.length} files.`;
    fileInput.value = ""; 
    loadFileTable(); 
});

async function processFile(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = async function(loadEvent) {
            const arrayBuffer = loadEvent.target.result;
            try {
                const textResult = await mammoth.extractRawText({arrayBuffer: arrayBuffer});
                const rawText = textResult.value.replace(/\s+/g, ' ');

                const htmlResult = await mammoth.convertToHtml({arrayBuffer: arrayBuffer});
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = htmlResult.value;

                let headers = [];
                const standardHeaders = tempDiv.querySelectorAll('h1, h2, h3, h4, h5, h6');
                standardHeaders.forEach(h => {
                    const txt = h.textContent.replace(/\s+/g, ' ').trim();
                    if(txt) headers.push(txt);
                });
                const paragraphs = tempDiv.querySelectorAll('p');
                paragraphs.forEach(p => {
                    const text = p.textContent.replace(/\s+/g, ' ').trim();
                    if (text.length > 2 && text.length < 150) {
                        const bold = p.querySelector('strong, b');
                        if (bold) {
                            if (!headers.includes(text)) headers.push(text);
                        }
                    }
                });

                addToDB(file.name, file, rawText, headers);
                resolve();
            } catch(e) {
                console.error("Error parsing docx", e);
                resolve();
            }
        };
        reader.readAsArrayBuffer(file);
    });
}

function addToDB(filename, fileBlob, rawContent, headers) {
    if (!db) return;
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const objectStore = transaction.objectStore(STORE_NAME);
    const doc = {
        title: filename,
        blob: fileBlob,
        text: rawContent, 
        searchableText: rawContent.toLowerCase(),
        headers: headers || [], 
        date: new Date().toLocaleDateString()
    };
    objectStore.add(doc);
}

function loadFileTable() {
    if (!db) return;
    fileListBody.innerHTML = "";
    const transaction = db.transaction([STORE_NAME], "readonly");
    const objectStore = transaction.objectStore(STORE_NAME);
    const request = objectStore.openCursor();

    request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
            const doc = cursor.value;
            const tr = document.createElement('tr');
            const tdName = document.createElement('td'); tdName.textContent = doc.title;
            const tdDate = document.createElement('td'); tdDate.textContent = doc.date;
            const tdActions = document.createElement('td');
            const btnRename = document.createElement('button'); btnRename.textContent = "✎"; btnRename.className = "action-btn";
            btnRename.addEventListener('click', () => renameFile(doc.id, doc.title));
            const btnDelete = document.createElement('button'); btnDelete.textContent = "🗑"; btnDelete.className = "action-btn btn-delete";
            btnDelete.addEventListener('click', () => deleteFile(doc.id));
            
            tdActions.appendChild(btnRename); tdActions.appendChild(btnDelete);
            tr.appendChild(tdName); tr.appendChild(tdDate); tr.appendChild(tdActions);
            fileListBody.appendChild(tr);
            cursor.continue();
        }
    };
}

function deleteFile(id) {
    if(!confirm("Delete this file?")) return;
    if (!db) return;
    const transaction = db.transaction([STORE_NAME], "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => loadFileTable();
}

function renameFile(id, oldTitle) {
    const newTitle = prompt("Enter new name:", oldTitle);
    if(newTitle && newTitle !== oldTitle) {
        if (!db) return;
        const transaction = db.transaction([STORE_NAME], "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const req = store.get(id);
        req.onsuccess = () => {
            const data = req.result;
            data.title = newTitle;
            store.put(data);
            store.transaction.oncomplete = () => loadFileTable();
        };
    }
}

resetDbBtn.addEventListener('click', () => {
    if(confirm("⚠ ARE YOU SURE? This will delete ALL files.")) {
        fileListBody.innerHTML = "";
        uploadStatus.textContent = "Database cleared.";
        if(db) db.close();
        const req = indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = () => {
            initDB().then(() => {
                loadFileTable();
                searchBox.value = "";
                document.body.classList.remove('has-results');
                resultsArea.innerHTML = "";
            });
        };
    }
});

let debounceTimeout;
searchBox.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    if (query.length > 0) {
        document.body.classList.add('has-results');
    } else {
        document.body.classList.remove('has-results');
        resultsArea.innerHTML = "";
        return;
    }
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => { performSearch(query); }, 300);
});

// --- HELPER: SMART REGEX GENERATOR (Fixed with capturing groups) ---
function getSmartRegex(query, flags = 'i') {
    const safeQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Rule: If 5 or more chars, partial match. If less, whole word.
    // FIX: Added parentheses (...) to create a capturing group for $1
    if (query.length >= 5) {
        return new RegExp(`(${safeQuery})`, flags); 
    } else {
        return new RegExp(`(\\b${safeQuery}\\b)`, flags);
    }
}

// --- SEARCH LOGIC ---
function performSearch(query) {
    if (!db) return;

    const transaction = db.transaction([STORE_NAME], "readonly");
    const objectStore = transaction.objectStore(STORE_NAME);
    const request = objectStore.openCursor();
    
    allGroupedResults = []; 
    
    // Use Smart Regex
    const regex = getSmartRegex(query);

    request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
            const doc = cursor.value;
            let titleHit = false;
            let headerHits = [];
            let bodyHits = [];

            if (regex.test(doc.title)) {
                titleHit = true;
            }

            if (doc.headers) {
                doc.headers.forEach(h => {
                    if (regex.test(h)) {
                        headerHits.push({ type: 'header', text: h, index: -1 });
                    }
                });
            }

            const fullText = doc.text;
            let match;
            // Use global flag for loop
            const globalRegex = getSmartRegex(query, 'gi');
            let occurrenceIndex = 0; 

            while ((match = globalRegex.exec(fullText)) !== null) {
                const start = Math.max(0, match.index - 40);
                const end = Math.min(fullText.length, match.index + query.length + 40);
                let snippet = fullText.substring(start, end);
                
                const isHeader = headerHits.some(h => h.text.includes(snippet.trim()));
                
                if (!isHeader) {
                    bodyHits.push({ type: 'body', text: snippet, index: occurrenceIndex });
                }
                occurrenceIndex++;
            }

            if (titleHit) {
                allGroupedResults.push({
                    doc: doc,
                    groupType: 'title',
                    score: 100,
                    hits: [{ type: 'title', text: null, index: -1 }]
                });
            }
            if (headerHits.length > 0) {
                allGroupedResults.push({
                    doc: doc,
                    groupType: 'header',
                    score: 50,
                    hits: headerHits
                });
            }
            if (bodyHits.length > 0) {
                allGroupedResults.push({
                    doc: doc,
                    groupType: 'body',
                    score: 10,
                    hits: bodyHits
                });
            }
            
            cursor.continue();
        } else {
            allGroupedResults.sort((a, b) => b.score - a.score);
            renderLimit = 50; 
            renderResultsList(query);
        }
    };
}

function renderResultsList(query) {
    resultsArea.innerHTML = "";
    
    if (allGroupedResults.length === 0) {
        resultsArea.innerHTML = `<div class="no-results"><p>No documents found matching "<b>${query}</b>"</p></div>`;
        return;
    }

    const visibleItems = allGroupedResults.slice(0, renderLimit);

    visibleItems.forEach(group => {
        renderDocumentGroup(group, query);
    });

    if (allGroupedResults.length > renderLimit) {
        const loadBtn = document.createElement('button');
        loadBtn.textContent = "Load More Results";
        loadBtn.style.cssText = "display:block; margin: 20px auto; padding: 10px 20px; background: #f1f3f4; border: 1px solid #dadce0; cursor:pointer; border-radius:4px; font-weight:bold; color: #5f6368;";
        loadBtn.addEventListener('click', () => {
            renderLimit += 50;
            renderResultsList(query);
        });
        resultsArea.appendChild(loadBtn);
    }
}

function renderDocumentGroup(group, query) {
    const doc = group.doc;
    const div = document.createElement('div');
    div.className = 'result-item';
    div.style.marginBottom = "30px"; 

    let badgeHTML = "";
    if (group.groupType === 'header') {
        badgeHTML = `<span style="background:#e6f4ea; color:#137333; font-size:11px; padding:2px 6px; border-radius:4px; margin-left:10px;">Header Matches</span>`;
    } else if (group.groupType === 'body') {
        badgeHTML = `<span style="background:#f1f3f4; color:#5f6368; font-size:11px; padding:2px 6px; border-radius:4px; margin-left:10px;">General Results</span>`;
    }

    div.innerHTML = `
        <div class="result-url">Local • ${doc.date}</div>
        <div class="title-row">
            <a class="result-title">${doc.title}</a>
            ${badgeHTML}
        </div>
        <div class="snippet-list" style="margin-top:8px;"></div>
        
        <div class="viewer-wrapper">
            <button class="popout-btn-overlay" title="Open in new tab">
                <svg viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
            </button>
            <div class="doc-viewer-container"></div>
        </div>
    `;

    const popoutBtn = div.querySelector('.popout-btn-overlay');
    popoutBtn.addEventListener('mouseenter', () => { popoutBtn.style.backgroundColor = "#f1f3f4"; popoutBtn.style.transform = "scale(1.05)"; });
    popoutBtn.addEventListener('mouseleave', () => { popoutBtn.style.backgroundColor = "white"; popoutBtn.style.transform = "scale(1)"; });

    const snippetList = div.querySelector('.snippet-list');
    
    // Use Smart Regex for highlighting
    const replaceRegex = getSmartRegex(query, 'gi');

    const allHits = group.hits;
    const visibleHits = allHits.slice(0, 5);
    const hiddenHits = allHits.slice(5);

    visibleHits.forEach(hit => createSnippetRow(hit, snippetList, replaceRegex, query, div, doc));

    if (hiddenHits.length > 0) {
        const hiddenContainer = document.createElement('div');
        hiddenContainer.style.display = "none";
        hiddenHits.forEach(hit => createSnippetRow(hit, hiddenContainer, replaceRegex, query, div, doc));
        
        const showMoreBtn = document.createElement('div');
        showMoreBtn.textContent = `Show ${hiddenHits.length} more...`;
        showMoreBtn.style.cssText = "color: #1a73e8; font-size:13px; font-weight:600; cursor:pointer; margin-top:5px; padding: 4px;";
        showMoreBtn.addEventListener('click', () => {
            hiddenContainer.style.display = "block";
            showMoreBtn.style.display = "none";
        });

        snippetList.appendChild(hiddenContainer);
        snippetList.appendChild(showMoreBtn);
    }

    const titleLink = div.querySelector('.result-title');

    titleLink.addEventListener('click', async () => {
        const wrapper = div.querySelector('.viewer-wrapper');
        const container = div.querySelector('.doc-viewer-container');

        if (wrapper.style.display === 'block') {
            wrapper.style.display = 'none';
        } else {
            wrapper.style.display = 'block';
            if (container.innerHTML === "") {
                container.textContent = "Rendering...";
                try {
                    const buffer = await doc.blob.arrayBuffer();
                    container.innerHTML = ""; 
                    await docx.renderAsync(buffer, container, null, { inWrapper: false, ignoreWidth: false });
                    const first = group.hits[0];
                    if (first.type === 'header') scrollToHeader(container, query, first.text);
                    else if (first.type === 'body') scrollToIndex(container, query, first.index);
                } catch(e) { container.textContent = "Error."; }
            }
        }
    });

    popoutBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        let viewerUrl = `viewer.html?id=${doc.id}&q=${encodeURIComponent(query)}`;
        const first = group.hits[0];
        if (first.type === 'header') viewerUrl += `&target=${encodeURIComponent(first.text)}`;
        else if (first.type === 'body') viewerUrl += `&idx=${first.index}`;
        chrome.tabs.create({ url: viewerUrl });
    });

    resultsArea.appendChild(div);
}

function createSnippetRow(hit, parent, replaceRegex, query, resultDiv, doc) {
    const hitDiv = document.createElement('div');
    hitDiv.style.cssText = "font-size:13px; color:#4d5156; margin-bottom:4px; cursor:pointer; line-height:1.5; padding:4px; border-radius:4px;";
    hitDiv.addEventListener('mouseenter', () => hitDiv.style.backgroundColor = "#f1f3f4");
    hitDiv.addEventListener('mouseleave', () => hitDiv.style.backgroundColor = "transparent");

    let contentHtml = "";
    if (hit.type === 'header') {
        const hl = hit.text.replace(replaceRegex, '<span class="search-match" style="color:#e91e63">$1</span>');
        contentHtml = `<strong>Section:</strong> ${hl}`;
    } else if (hit.type === 'body') {
        const hl = hit.text.replace(replaceRegex, '<span class="search-match" style="color:#e91e63">$1</span>');
        contentHtml = `...${hl}...`;
    } else {
        contentHtml = `<em>Match in document title</em>`;
    }

    hitDiv.innerHTML = contentHtml;

    hitDiv.addEventListener('click', async (e) => {
        e.stopPropagation();
        const wrapper = resultDiv.querySelector('.viewer-wrapper');
        const container = resultDiv.querySelector('.doc-viewer-container');
        
        wrapper.style.display = 'block';
        if (container.innerHTML === "") {
            container.textContent = "Rendering...";
            try {
                const buffer = await doc.blob.arrayBuffer();
                container.innerHTML = ""; 
                await docx.renderAsync(buffer, container, null, { inWrapper: false, ignoreWidth: false });
            } catch(err) { container.textContent = "Error rendering."; return; }
        }
        if (hit.type === 'header') scrollToHeader(container, query, hit.text);
        else if (hit.type === 'body') scrollToIndex(container, query, hit.index);
    });

    parent.appendChild(hitDiv);
}

// --- SCROLL HELPERS ---
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
            }
        }, 100); 
    });
}

function scrollToIndex(container, query, targetIndex) {
    if (!query) return;
    
    // FIX: Use getSmartRegex for scrolling too
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

initDB();