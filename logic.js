// --- Database Setup ---
const DB_NAME = "DocxSearchDB";
const STORE_NAME = "documents";
const DB_VERSION = 3; 
let db;

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
        request.onerror = () => reject("DB Error");
    });
};

// --- UI Elements ---
const searchBox = document.getElementById('search-box');
const resultsArea = document.getElementById('results-area');
const fileInput = document.getElementById('file-input');
const uploadStatus = document.getElementById('upload-status');
const fileListBody = document.getElementById('file-list-body');

// Modal Elements
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
                // 1. Extract Raw Text (For Body Search)
                const textResult = await mammoth.extractRawText({arrayBuffer: arrayBuffer});
                const rawText = textResult.value.replace(/\s+/g, ' ');

                // 2. Convert to HTML (To scrape Headers)
                const htmlResult = await mammoth.convertToHtml({arrayBuffer: arrayBuffer});
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = htmlResult.value;
                
                // Extract all H1-H6 text content for prioritization
                const headers = Array.from(tempDiv.querySelectorAll('h1, h2, h3, h4, h5, h6'))
                                     .map(h => h.textContent.toLowerCase());

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

// --- File Manager Logic ---
function loadFileTable() {
    fileListBody.innerHTML = "";
    const transaction = db.transaction([STORE_NAME], "readonly");
    const objectStore = transaction.objectStore(STORE_NAME);
    const request = objectStore.openCursor();

    request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
            const doc = cursor.value;
            const tr = document.createElement('tr');
            
            const tdName = document.createElement('td');
            tdName.textContent = doc.title;
            const tdDate = document.createElement('td');
            tdDate.textContent = doc.date;
            const tdActions = document.createElement('td');
            
            const btnRename = document.createElement('button');
            btnRename.textContent = "✎";
            btnRename.className = "action-btn";
            btnRename.addEventListener('click', () => renameFile(doc.id, doc.title));
            
            const btnDelete = document.createElement('button');
            btnDelete.textContent = "🗑";
            btnDelete.className = "action-btn btn-delete";
            btnDelete.addEventListener('click', () => deleteFile(doc.id));
            
            tdActions.appendChild(btnRename);
            tdActions.appendChild(btnDelete);
            
            tr.appendChild(tdName);
            tr.appendChild(tdDate);
            tr.appendChild(tdActions);
            fileListBody.appendChild(tr);
            cursor.continue();
        }
    };
}

function deleteFile(id) {
    if(!confirm("Delete this file?")) return;
    const transaction = db.transaction([STORE_NAME], "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => loadFileTable();
}

function renameFile(id, oldTitle) {
    const newTitle = prompt("Enter new name:", oldTitle);
    if(newTitle && newTitle !== oldTitle) {
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

// --- Search Logic ---
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

function performSearch(query) {
    const transaction = db.transaction([STORE_NAME], "readonly");
    const objectStore = transaction.objectStore(STORE_NAME);
    const request = objectStore.openCursor();
    
    let matches = [];

    request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
            const doc = cursor.value;
            let score = 0;
            let matchType = 'body'; 

            // 1. Is it in a Header? (Highest Priority for content)
            if (doc.headers && doc.headers.some(h => h.includes(query))) {
                score = 50; 
                matchType = 'header';
            }
            // 2. Is it in the Body? (Lowest Priority)
            else if (doc.searchableText.includes(query)) {
                score = 10;
                matchType = 'body';
            }
            
            // 3. Is it in the Title? (Overrides all)
            if (doc.title.toLowerCase().includes(query)) {
                score = 100;
                matchType = 'title';
            }

            if (score > 0) {
                matches.push({ doc, score, matchType });
            }
            
            cursor.continue();
        } else {
            // RENDER RESULTS
            resultsArea.innerHTML = "";
            
            if (matches.length === 0) {
                resultsArea.innerHTML = `
                    <div class="no-results">
                        <p>No documents found matching "<b>${query}</b>"</p>
                        <p style="font-size: 14px;">Try checking for typos or uploading more files.</p>
                    </div>
                `;
            } else {
                // Sort: High score first
                matches.sort((a, b) => b.score - a.score);

                let lastType = null;

                matches.forEach(match => {
                    // Inject Divider if the type changes (e.g. going from Header to Body matches)
                    if (match.matchType !== lastType) {
                        const sep = document.createElement('div');
                        // Pretty divider style
                        sep.style.cssText = "padding: 15px 0 5px 0; font-weight: 700; color: #1a73e8; font-size: 13px; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 2px solid #e8f0fe; margin-bottom: 15px; margin-top: 10px;";
                        
                        if (match.matchType === 'title') sep.textContent = "Title Matches";
                        else if (match.matchType === 'header') sep.textContent = "Header Matches";
                        else sep.textContent = "Document Matches";
                        
                        if(lastType === null) sep.style.marginTop = "0px";
                        resultsArea.appendChild(sep);
                        lastType = match.matchType;
                    }

                    renderResult(match.doc, query, match.matchType);
                });
            }
        }
    };
}

function getSnippet(text, query) {
    if (!text) return "";
    const index = text.toLowerCase().indexOf(query);
    if (index === -1) return "Match found in document structure.";

    const start = Math.max(0, index - 80);
    const end = Math.min(text.length, index + query.length + 80);
    let snippet = text.substring(start, end);

    const safeQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${safeQuery})`, 'gi');
    return "..." + snippet.replace(regex, '<span class="search-match">$1</span>') + "...";
}

function renderResult(doc, query, matchType) {
    const div = document.createElement('div');
    div.className = 'result-item';
    
    let snippetHTML = getSnippet(doc.text, query);
    
    // Optional: Badges to make it even clearer
    let badgeHTML = "";
    if (matchType === 'header') {
        badgeHTML = `<span style="background:#e6f4ea; color:#137333; font-size:11px; padding:2px 6px; border-radius:4px; margin-left:10px;">Header Match</span>`;
    }

    div.innerHTML = `
        <div class="result-url">Local • ${doc.date}</div>
        <div class="title-row">
            <a class="result-title">${doc.title}</a>
            ${badgeHTML}
            <button class="popout-btn" title="Open in new tab">
                <svg viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
            </button>
        </div>
        <div class="snippet">${snippetHTML}</div>
        <div class="doc-viewer-container"></div>
    `;

    // References & Listeners
    const titleLink = div.querySelector('.result-title');
    const popoutBtn = div.querySelector('.popout-btn');
    const container = div.querySelector('.doc-viewer-container');
    
    titleLink.addEventListener('click', async () => {
        if (container.style.display === 'block') {
            container.style.display = 'none';
        } else {
            container.style.display = 'block';
            if (container.innerHTML === "") {
                container.textContent = "Rendering document...";
                try {
                    const buffer = await doc.blob.arrayBuffer();
                    container.innerHTML = ""; 
                    await docx.renderAsync(buffer, container, null, {
                        inWrapper: false, ignoreWidth: false
                    });
                    if (query) scrollToMatch(container, query);
                } catch(e) {
                    container.textContent = "Error rendering document.";
                }
            }
        }
    });

    popoutBtn.addEventListener('click', (e) => {
        e.stopPropagation(); 
        const safeQuery = encodeURIComponent(query || '');
        chrome.tabs.create({ url: `viewer.html?id=${doc.id}&q=${safeQuery}` });
    });

    resultsArea.appendChild(div);
}

// Inline Preview Scroll Logic
function scrollToMatch(container, query) {
    if (!query) return;
    requestAnimationFrame(() => {
        setTimeout(() => {
            const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
            let node;
            const safeQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(safeQuery, 'i'); 

            while (node = walker.nextNode()) {
                const text = node.textContent;
                const match = regex.exec(text);
                if (match) {
                    const matchIndex = match.index;
                    const matchLength = match[0].length;
                    const matchAndAfter = node.splitText(matchIndex);
                    matchAndAfter.splitText(matchLength);
                    const span = document.createElement('span');
                    span.className = "scrolled-highlight";
                    // Fallback style in case CSS isn't loaded in manager
                    span.style.backgroundColor = "#ffff00";
                    span.style.outline = "3px solid #ffff00";
                    
                    matchAndAfter.parentNode.insertBefore(span, matchAndAfter);
                    span.appendChild(matchAndAfter);
                    span.scrollIntoView({ behavior: 'auto', block: 'center' });
                    break; 
                }
            }
        }, 100); 
    });
}

initDB();