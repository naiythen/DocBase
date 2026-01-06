// --- Database Setup ---
const DB_NAME = "DocxSearchDB";
const STORE_NAME = "documents";
const COLLECTION_STORE = "collections";
const SEARCH_CACHE_STORE = "searchCache"; // Persistent search index
const DB_VERSION = 8; // Bumped for new store
let db;

// --- Global State ---
let allGroupedResults = [];
let renderLimit = 50; 
let currentActiveCollectionId = null; 
let activeSearchFilters = [];

// --- Search Cache & Worker for Performance ---
let documentCache = null;
let documentCacheFull = null; // Full docs with blobs for rendering
let cacheInvalidated = true;
let searchWorker = null;
let currentSearchId = 0;

// --- DOM Elements ---
const searchBox = document.getElementById('search-box');
const resultsArea = document.getElementById('results-area');
const dbFilterContainer = document.getElementById('db-filter-container');
const multiSearchSidebar = document.getElementById('multi-search-sidebar');
const multiSearchList = document.getElementById('multi-search-list');
const sidebarResizer = document.getElementById('sidebar-resizer');
const toggleMultiSidebar = document.getElementById('toggle-multi-sidebar');
let multiSidebarVisible = false; // User preference for sidebar visibility

// Manager Elements
const managerModal = document.getElementById('manager-modal');
const dbListContainer = document.getElementById('db-list-container');
const createDbBtn = document.getElementById('create-db-btn');
const currentDbNameEl = document.getElementById('current-db-name');
const dbActionsRow = document.getElementById('db-actions-row');
const renameDbBtn = document.getElementById('rename-db-btn');
const deleteDbBtn = document.getElementById('delete-db-btn');
const activeDbView = document.getElementById('active-db-view');
const noDbSelectedMsg = document.getElementById('no-db-selected-msg');
const uploadDbNameLabel = document.getElementById('upload-db-name-label');
const fileListBody = document.getElementById('file-list-body');
const fileInput = document.getElementById('file-input');
const uploadStatus = document.getElementById('upload-status');

// Toast & Dialog Elements
const toastContainer = document.getElementById('toast-container');
const dialogOverlay = document.getElementById('dialog-overlay');
const dialogTitle = document.getElementById('dialog-title');
const dialogMsg = document.getElementById('dialog-msg');
const dialogInput = document.getElementById('dialog-input');

function showToast(message) {
    toastContainer.textContent = message;
    toastContainer.classList.add('show');
    setTimeout(() => { toastContainer.classList.remove('show'); }, 3000);
}

// --- FIXED DIALOG FUNCTIONS ---

function customConfirm(message, callback) {
    // 1. Re-select buttons fresh from DOM to avoid "null parent" error
    const currentOkBtn = document.getElementById('dialog-ok-btn');
    const currentCancelBtn = document.getElementById('dialog-cancel-btn');

    dialogOverlay.style.display = "flex";
    dialogTitle.textContent = "Confirm Action";
    dialogMsg.textContent = message;
    dialogInput.style.display = "none";
    
    // 2. Clone to strip old listeners
    const newOk = currentOkBtn.cloneNode(true);
    const newCancel = currentCancelBtn.cloneNode(true);
    
    // 3. Update Text & Classes
    newOk.className = "dialog-btn btn-danger";
    newOk.textContent = "Yes, Delete"; // Force text update
    newCancel.textContent = "Cancel";

    currentOkBtn.parentNode.replaceChild(newOk, currentOkBtn);
    currentCancelBtn.parentNode.replaceChild(newCancel, currentCancelBtn);

    newOk.addEventListener('click', () => {
        dialogOverlay.style.display = "none";
        callback(true);
    });
    newCancel.addEventListener('click', () => {
        dialogOverlay.style.display = "none";
        callback(false);
    });
}

function customPrompt(title, message, callback) {
    // 1. Re-select buttons fresh
    const currentOkBtn = document.getElementById('dialog-ok-btn');
    const currentCancelBtn = document.getElementById('dialog-cancel-btn');

    dialogOverlay.style.display = "flex";
    dialogTitle.textContent = title;
    dialogMsg.textContent = message;
    dialogInput.style.display = "block";
    dialogInput.value = "";
    dialogInput.focus();
    
    // 2. Clone
    const newOk = currentOkBtn.cloneNode(true);
    const newCancel = currentCancelBtn.cloneNode(true);

    // 3. Update Text & Classes
    newOk.className = "dialog-btn btn-confirm";
    newOk.textContent = "Save"; // Force text update
    newCancel.textContent = "Cancel";

    currentOkBtn.parentNode.replaceChild(newOk, currentOkBtn);
    currentCancelBtn.parentNode.replaceChild(newCancel, currentCancelBtn);

    newOk.addEventListener('click', () => {
        const val = dialogInput.value.trim();
        dialogOverlay.style.display = "none";
        if(val) callback(val);
    });
    
    newCancel.addEventListener('click', () => { 
        dialogOverlay.style.display = "none"; 
    });
    
    dialogInput.onkeydown = (e) => { 
        if(e.key === 'Enter') newOk.click(); 
    };
}

// --- INIT ---
const initDB = () => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            db = event.target.result;
            const transaction = event.target.transaction;
            if (!db.objectStoreNames.contains(COLLECTION_STORE)) {
                const colStore = db.createObjectStore(COLLECTION_STORE, { keyPath: "id", autoIncrement: true });
                colStore.add({ name: "Default Library", id: 1 });
            }
            let docStore;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                docStore = db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
            } else {
                docStore = transaction.objectStore(STORE_NAME);
            }
            // Add search cache store for persistent index
            if (!db.objectStoreNames.contains(SEARCH_CACHE_STORE)) {
                db.createObjectStore(SEARCH_CACHE_STORE, { keyPath: "key" });
            }
            // Migration
            docStore.openCursor().onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    const doc = cursor.value;
                    if (!doc.collectionId) {
                        doc.collectionId = 1;
                        cursor.update(doc);
                    }
                    cursor.continue();
                }
            };
        };
        request.onsuccess = (event) => {
            db = event.target.result;
            loadFilterChips();
            initSearchWorker(); // Initialize worker for fast search
            // Preload cache after a small delay to ensure DB is fully ready
            setTimeout(() => loadDocumentCache(), 100);
            resolve(db);
        };
        request.onerror = (event) => { console.error("DB Error:", event.target.error); reject("DB Error"); };
    });
};

// --- MANAGER LOGIC ---
document.getElementById('open-manager-btn').addEventListener('click', () => {
    managerModal.style.display = "flex";
    loadCollectionsSidebar();
});
document.getElementById('close-manager-btn').addEventListener('click', () => {
    managerModal.style.display = "none";
    loadFilterChips(); 
});

createDbBtn.addEventListener('click', () => {
    customPrompt("Create Database", "Enter a name for your new database:", (name) => {
        const transaction = db.transaction([COLLECTION_STORE], "readwrite");
        transaction.objectStore(COLLECTION_STORE).add({ name: name });
        transaction.oncomplete = () => {
            loadCollectionsSidebar();
            showToast(`Created database "${name}"`);
        };
    });
});

function loadCollectionsSidebar() {
    dbListContainer.innerHTML = "";
    const transaction = db.transaction([COLLECTION_STORE], "readonly");
    transaction.objectStore(COLLECTION_STORE).openCursor().onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
            const col = cursor.value;
            const div = document.createElement('div');
            div.className = `db-item ${currentActiveCollectionId === col.id ? 'active' : ''}`;
            div.textContent = col.name;
            div.addEventListener('click', () => selectCollection(col));
            dbListContainer.appendChild(div);
            cursor.continue();
        }
    };
}

function selectCollection(col) {
    currentActiveCollectionId = col.id;
    currentDbNameEl.textContent = col.name;
    uploadDbNameLabel.textContent = col.name;
    noDbSelectedMsg.style.display = "none";
    activeDbView.style.display = "block";
    dbActionsRow.style.display = "flex";
    loadCollectionsSidebar(); 
    loadFileTable(col.id);
}

renameDbBtn.addEventListener('click', () => {
    if (!currentActiveCollectionId) return;
    customPrompt("Rename Database", "Enter new name:", (newName) => {
        const tx = db.transaction([COLLECTION_STORE], "readwrite");
        const store = tx.objectStore(COLLECTION_STORE);
        store.get(currentActiveCollectionId).onsuccess = (e) => {
            const data = e.target.result;
            data.name = newName;
            store.put(data);
            tx.oncomplete = () => {
                currentDbNameEl.textContent = newName;
                loadCollectionsSidebar();
                showToast("Database renamed.");
            };
        };
    });
});

deleteDbBtn.addEventListener('click', () => {
    if (!currentActiveCollectionId) return;
    customConfirm("⚠ Are you sure? This will delete this database and ALL files inside it permanently.", (confirmed) => {
        if(confirmed) {
            const tx = db.transaction([COLLECTION_STORE, STORE_NAME], "readwrite");
            tx.objectStore(COLLECTION_STORE).delete(currentActiveCollectionId);
            const docStore = tx.objectStore(STORE_NAME);
            docStore.openCursor().onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    if (cursor.value.collectionId === currentActiveCollectionId) cursor.delete();
                    cursor.continue();
                }
            };
            tx.oncomplete = () => {
                cacheInvalidated = true; // Invalidate cache on collection delete
                currentActiveCollectionId = null;
                activeDbView.style.display = "none";
                noDbSelectedMsg.style.display = "block";
                dbActionsRow.style.display = "none";
                currentDbNameEl.textContent = "Select a Database";
                loadCollectionsSidebar();
                showToast("Database deleted.");
            };
        }
    });
});

// --- FILE LOGIC ---
function loadFileTable(collectionId) {
    fileListBody.innerHTML = "";
    const transaction = db.transaction([STORE_NAME], "readonly");
    const objectStore = transaction.objectStore(STORE_NAME);
    
    objectStore.openCursor().onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
            const doc = cursor.value;
            if (doc.collectionId === collectionId) {
                const tr = document.createElement('tr');
                
                const tdName = document.createElement('td'); tdName.textContent = doc.title;
                const tdDate = document.createElement('td'); tdDate.textContent = doc.date;
                const tdActions = document.createElement('td');
                tdActions.style.whiteSpace = "nowrap";

                const btnRename = document.createElement('button');
                btnRename.textContent = "✎";
                btnRename.className = "btn-rename-file";
                btnRename.title = "Rename File";
                btnRename.addEventListener('click', () => renameFileInManager(doc.id, doc.title));

                const btnDelete = document.createElement('button');
                btnDelete.textContent = "🗑";
                btnDelete.className = "btn-delete-file";
                btnDelete.title = "Delete File";
                btnDelete.addEventListener('click', () => deleteFileInManager(doc.id));

                tdActions.appendChild(btnRename);
                tdActions.appendChild(btnDelete);
                
                tr.appendChild(tdName);
                tr.appendChild(tdDate);
                tr.appendChild(tdActions);
                fileListBody.appendChild(tr);
            }
            cursor.continue();
        }
    };
}

function renameFileInManager(id, oldTitle) {
    customPrompt("Rename File", "Enter new filename:", (newName) => {
        const tx = db.transaction([STORE_NAME], "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.get(id).onsuccess = (e) => {
            const data = e.target.result;
            data.title = newName;
            store.put(data);
            tx.oncomplete = () => {
                cacheInvalidated = true; // Invalidate cache on rename
                loadFileTable(currentActiveCollectionId);
            };
        };
    });
}

function deleteFileInManager(id) {
    customConfirm("Delete this file?", (confirmed) => {
        if(confirmed) {
            const tx = db.transaction([STORE_NAME], "readwrite");
            tx.objectStore(STORE_NAME).delete(id);
            tx.oncomplete = () => {
                cacheInvalidated = true; // Invalidate cache on delete
                loadFileTable(currentActiveCollectionId);
                showToast("File deleted.");
            };
        }
    });
}

fileInput.addEventListener('change', async (e) => {
    if (!currentActiveCollectionId) return;
    const files = e.target.files;
    uploadStatus.textContent = `Processing...`;
    for (let i = 0; i < files.length; i++) {
        await processFile(files[i], currentActiveCollectionId);
    }
    cacheInvalidated = true; // Invalidate cache on upload
    uploadStatus.textContent = `Added ${files.length} files.`;
    showToast(`Added ${files.length} files.`);
    fileInput.value = "";
    loadFileTable(currentActiveCollectionId);
});

async function processFile(file, collectionId) {
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
                tempDiv.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h => {
                    const txt = h.textContent.replace(/\s+/g, ' ').trim();
                    if(txt) headers.push(txt);
                });
                tempDiv.querySelectorAll('p').forEach(p => {
                    const text = p.textContent.replace(/\s+/g, ' ').trim();
                    if (text.length > 2 && text.length < 150) {
                        if (p.querySelector('strong, b') && !headers.includes(text)) headers.push(text);
                    }
                });

                const tx = db.transaction([STORE_NAME], "readwrite");
                tx.objectStore(STORE_NAME).add({
                    title: file.name,
                    blob: file,
                    text: rawText,
                    searchableText: rawText.toLowerCase(),
                    headers: headers || [],
                    date: new Date().toLocaleDateString(),
                    collectionId: collectionId 
                });
                resolve();
            } catch(e) { resolve(); }
        };
        reader.readAsArrayBuffer(file);
    });
}

// --- SEARCH & FILTER LOGIC ---
function loadFilterChips() {
    dbFilterContainer.innerHTML = "";
    if (!db) return;
    
    // 1. "All Databases" Chip
    const allChip = document.createElement('div');
    allChip.className = "filter-chip";
    allChip.textContent = "All Databases";
    if (activeSearchFilters.length === 0) allChip.classList.add('active');

    allChip.addEventListener('click', () => {
        activeSearchFilters = []; 
        loadFilterChips(); 
        if(searchBox.value.length > 0) performSearch(searchBox.value.toLowerCase());
    });
    dbFilterContainer.appendChild(allChip);

    // 2. Specific DB Chips
    const tx = db.transaction([COLLECTION_STORE], "readonly");
    tx.objectStore(COLLECTION_STORE).openCursor().onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
            const col = cursor.value;
            const chip = document.createElement('div');
            const isActive = activeSearchFilters.includes(col.id);
            chip.className = `filter-chip ${isActive ? 'active' : ''}`;
            chip.textContent = col.name;
            chip.addEventListener('click', () => {
                if (isActive) activeSearchFilters = activeSearchFilters.filter(id => id !== col.id);
                else activeSearchFilters.push(col.id);
                loadFilterChips();
                if(searchBox.value.length > 0) performSearch(searchBox.value.toLowerCase());
            });
            dbFilterContainer.appendChild(chip);
            cursor.continue();
        }
    };
}

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
    // Reduced debounce for faster response - 50ms instead of 300ms
    debounceTimeout = setTimeout(() => { performSearch(query); }, 50);
});

function getSmartRegex(query, flags = 'i') {
    const safeQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (query.length >= 5) return new RegExp(`(${safeQuery})`, flags);
    else return new RegExp(`(\\b${safeQuery}\\b)`, flags);
}

// Multi-word header search: checks if ALL words in query appear anywhere in the header
function matchesHeaderMultiWord(header, query) {
    const words = query.trim().split(/\s+/).filter(w => w.length > 0);
    if (words.length <= 1) return false; // Only use for multi-word queries
    const headerLower = header.toLowerCase();
    return words.every(word => headerLower.includes(word.toLowerCase()));
}

// Get regex for highlighting multiple words in headers - applies word boundary for short words
function getMultiWordHighlightRegex(query, flags = 'gi') {
    const words = query.trim().split(/\s+/).filter(w => w.length > 0);
    if (words.length <= 1) return null;
    // Build regex patterns with word boundaries for short words
    const patterns = words.map(w => {
        const safeWord = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Use word boundary for short words to avoid matching inside other words
        if (w.length < 5) {
            return `\\b${safeWord}\\b`;
        }
        return safeWord;
    });
    return new RegExp(`(${patterns.join('|')})`, flags);
}

// Multi-search: Find documents where filename matches some query words AND content matches other words
function findCrossMatches(doc, query) {
    const words = query.trim().split(/\s+/).filter(w => w.length > 1); // Filter out single chars
    if (words.length < 2) return null; // Need at least 2 words for cross-matching
    
    const titleLower = doc.title.toLowerCase();
    
    // Combine text and headers for content search
    const allContent = doc.text + ' ' + (doc.headers ? doc.headers.join(' ') : '');
    
    const titleMatchedWords = [];
    const contentMatchedWords = [];
    
    words.forEach(word => {
        const wordLower = word.toLowerCase();
        // Check title - exact word match
        if (titleLower.includes(wordLower)) {
            titleMatchedWords.push(word);
        }
        // Check content (text + headers) - use word boundary for flexibility
        const wordRegex = new RegExp(`\\b${wordLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
        if (wordRegex.test(allContent)) {
            contentMatchedWords.push(word);
        }
    });
    
    // Cross-match: filename has some words AND content has at least some words (can overlap)
    const titleOnlyWords = titleMatchedWords.filter(w => !contentMatchedWords.map(c => c.toLowerCase()).includes(w.toLowerCase()));
    const contentOnlyWords = contentMatchedWords.filter(w => !titleMatchedWords.map(t => t.toLowerCase()).includes(w.toLowerCase()));
    
    // Show cross-match if: title matches some words AND content matches some words
    if (titleMatchedWords.length > 0 && contentMatchedWords.length > 0) {
        return {
            titleWords: titleMatchedWords,
            contentWords: contentMatchedWords,
            contentOnlyWords: contentOnlyWords,
            allWords: [...new Set([...titleMatchedWords, ...contentMatchedWords])]
        };
    }
    return null;
}

// Get snippets for cross-match content words - searches both text and headers
// Prioritizes finding phrase matches in headers first
function getCrossMatchSnippets(doc, contentWords, originalQuery) {
    const snippets = [];
    const usedWords = new Set();
    
    // First, try to find multi-word phrase matches in headers
    if (doc.headers && contentWords.length > 1) {
        for (const header of doc.headers) {
            const headerLower = header.toLowerCase();
            // Check how many consecutive content words appear together in this header
            let matchedPhrase = [];
            for (const word of contentWords) {
                if (headerLower.includes(word.toLowerCase())) {
                    matchedPhrase.push(word);
                }
            }
            // If we found 2+ words from content in this header, treat it as a phrase match
            if (matchedPhrase.length >= 2) {
                const phraseText = matchedPhrase.join(' ');
                snippets.push({ 
                    type: 'cross-header', 
                    text: header, 
                    word: phraseText, 
                    matchedText: phraseText, 
                    index: -1,
                    isPhrase: true
                });
                matchedPhrase.forEach(w => usedWords.add(w.toLowerCase()));
            }
        }
    }
    
    // Then, find individual words not already matched in phrase headers
    contentWords.forEach(word => {
        if (usedWords.has(word.toLowerCase())) return; // Skip if already matched in a phrase
        
        const wordLower = word.toLowerCase();
        const wordRegex = new RegExp(`\\b${wordLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\w*`, 'gi');
        
        // First try to find in main text
        let match = wordRegex.exec(doc.text);
        if (match) {
            const index = match.index;
            const start = Math.max(0, index - 40);
            const end = Math.min(doc.text.length, index + match[0].length + 40);
            let snippet = doc.text.substring(start, end);
            snippets.push({ type: 'cross', text: snippet, word: word, matchedText: match[0], index: index });
        } else if (doc.headers) {
            // If not in text, search headers
            for (const header of doc.headers) {
                wordRegex.lastIndex = 0; // Reset regex
                if (wordRegex.test(header)) {
                    snippets.push({ type: 'cross-header', text: header, word: word, matchedText: word, index: -1 });
                    break;
                }
            }
        }
    });
    
    return snippets;
}

// Initialize Web Worker for search
function initSearchWorker() {
    if (searchWorker) return;
    try {
        searchWorker = new Worker('search-worker.js');
        searchWorker.onmessage = (e) => {
            const { type, results, query } = e.data;
            if (type === 'results') {
                allGroupedResults = results;
                renderLimit = 50;
                renderResultsList(query);
            }
        };
        searchWorker.onerror = (err) => {
            console.warn('Worker error, falling back to main thread:', err);
            searchWorker = null;
        };
    } catch (err) {
        console.warn('Worker not supported, using main thread search');
        searchWorker = null;
    }
}

// Compute a lightweight hash using just IDs and titles (no full doc load needed)
function computeQuickHash(countAndIds) {
    return String(countAndIds.count) + '_' + countAndIds.ids.join(',');
}

// Get just doc count and IDs - much faster than loading full docs
function getDocCountAndIds() {
    return new Promise((resolve) => {
        const tx = db.transaction([STORE_NAME], "readonly");
        const store = tx.objectStore(STORE_NAME);
        const ids = [];
        store.openCursor().onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                ids.push(cursor.value.id);
                cursor.continue();
            } else {
                resolve({ count: ids.length, ids: ids.sort((a,b) => a-b) });
            }
        };
    });
}

// Save search index to IndexedDB for persistence across worker restarts
function saveSearchIndexToDb(cache, hash) {
    if (!db.objectStoreNames.contains(SEARCH_CACHE_STORE)) return;
    const tx = db.transaction([SEARCH_CACHE_STORE], "readwrite");
    tx.objectStore(SEARCH_CACHE_STORE).put({ key: "searchIndex", hash, cache });
}

// Load search index from IndexedDB
function loadSearchIndexFromDb() {
    return new Promise((resolve) => {
        if (!db.objectStoreNames.contains(SEARCH_CACHE_STORE)) {
            resolve(null);
            return;
        }
        const tx = db.transaction([SEARCH_CACHE_STORE], "readonly");
        const req = tx.objectStore(SEARCH_CACHE_STORE).get("searchIndex");
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
    });
}

// Cache loader - uses persisted index when docs haven't changed
function loadDocumentCache() {
    return new Promise(async (resolve) => {
        // Fast path: already in memory
        if (documentCache && !cacheInvalidated) {
            resolve(documentCache);
            return;
        }
        
        // Get quick hash (just count + IDs, no full doc load)
        const countAndIds = await getDocCountAndIds();
        const currentHash = computeQuickHash(countAndIds);
        
        // Check if persisted cache is valid BEFORE loading full docs
        const savedIndex = await loadSearchIndexFromDb();
        if (savedIndex && savedIndex.hash === currentHash) {
            // Cache is valid! Use it without loading full docs for search
            documentCache = savedIndex.cache;
            cacheInvalidated = false;
            
            // Update worker cache
            if (searchWorker) {
                searchWorker.postMessage({ type: 'setCache', data: { documents: documentCache } });
            }
            
            // Also load full docs with blobs for rendering (async, don't block)
            loadFullDocsAsync();
            
            resolve(documentCache);
            return;
        }
        
        // Cache invalid - need to load full docs and rebuild
        const transaction = db.transaction([STORE_NAME], "readonly");
        const objectStore = transaction.objectStore(STORE_NAME);
        const request = objectStore.getAll();
        
        request.onsuccess = () => {
            const docs = request.result;
            
            // Store full docs with blobs for rendering
            documentCacheFull = {};
            docs.forEach(doc => {
                documentCacheFull[doc.id] = doc;
            });
            
            // Build new search cache
            documentCache = docs.map(doc => ({
                id: doc.id,
                title: doc.title,
                titleLower: doc.title.toLowerCase(),
                text: doc.text,
                textLower: doc.text.toLowerCase(),
                headers: doc.headers || [],
                headersLower: (doc.headers || []).map(h => h.toLowerCase()),
                date: doc.date,
                collectionId: doc.collectionId
            }));
            cacheInvalidated = false;
            
            // Persist for future fast loads
            saveSearchIndexToDb(documentCache, currentHash);
            
            // Update worker cache
            if (searchWorker) {
                searchWorker.postMessage({ type: 'setCache', data: { documents: documentCache } });
            }
            
            resolve(documentCache);
        };
        
        request.onerror = () => resolve([]);
    });
}

// Load full docs with blobs asynchronously for rendering
function loadFullDocsAsync() {
    if (documentCacheFull && Object.keys(documentCacheFull).length > 0) return;
    
    const transaction = db.transaction([STORE_NAME], "readonly");
    const objectStore = transaction.objectStore(STORE_NAME);
    const request = objectStore.getAll();
    
    request.onsuccess = () => {
        const docs = request.result;
        documentCacheFull = {};
        docs.forEach(doc => {
            documentCacheFull[doc.id] = doc;
        });
    };
}

// Get full doc with blob for rendering
function getFullDoc(docId) {
    if (documentCacheFull && documentCacheFull[docId]) {
        return documentCacheFull[docId];
    }
    return null;
}

// Main search function - uses Worker if available, fallback to main thread
async function performSearch(query) {
    if (!db) return;
    
    const docs = await loadDocumentCache();
    
    // Try to use worker for non-blocking search
    if (searchWorker) {
        currentSearchId++;
        searchWorker.postMessage({ 
            type: 'search', 
            data: { query, filters: activeSearchFilters }
        });
        return;
    }
    
    // Fallback: main thread search (optimized)
    performSearchMainThread(query, docs);
}

// Optimized main-thread search (fallback if Worker unavailable)
function performSearchMainThread(query, docs) {
    allGroupedResults = [];
    
    const queryLower = query.toLowerCase();
    const queryWords = query.trim().split(/\s+/).filter(w => w.length > 1);
    const isShortQuery = query.length < 5;
    
    // Pre-compile regex once
    let regex = null;
    if (isShortQuery) {
        regex = getSmartRegex(query);
    }
    
    for (const doc of docs) {
        // Skip if filtered
        if (activeSearchFilters.length > 0 && !activeSearchFilters.includes(doc.collectionId)) {
            continue;
        }
        
        let titleHit = false;
        let headerHits = [];
        let bodyHits = [];
        
        // Title check
        if (isShortQuery) {
            titleHit = regex.test(doc.title);
        } else {
            titleHit = doc.titleLower.includes(queryLower);
        }
        
        // Header check
        for (let hi = 0; hi < doc.headers.length; hi++) {
            const headerLower = doc.headersLower[hi];
            let matches = false;
            
            if (isShortQuery) {
                matches = regex.test(doc.headers[hi]);
            } else {
                matches = headerLower.includes(queryLower);
            }
            
            // Multi-word match - apply word boundary for short words
            if (!matches && queryWords.length > 1) {
                matches = queryWords.every(w => {
                    if (w.length < 5) {
                        const safeWord = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const wordRegex = new RegExp(`\\b${safeWord}\\b`, 'i');
                        return wordRegex.test(doc.headers[hi]);
                    }
                    return headerLower.includes(w.toLowerCase());
                });
            }
            
            if (matches) {
                headerHits.push({ type: 'header', text: doc.headers[hi], index: -1 });
            }
        }
        
        // Body search - for multi-word queries, check each word individually with proper boundary matching
        const textLower = doc.textLower;
        const fullText = doc.text;
        let bodyHitCount = 0;
        
        if (isShortQuery) {
            // Single short word - use word boundary regex
            const globalRegex = getSmartRegex(query, 'gi');
            let match;
            while ((match = globalRegex.exec(fullText)) !== null && bodyHitCount < 10) {
                const start = Math.max(0, match.index - 40);
                const end = Math.min(fullText.length, match.index + query.length + 40);
                const snippet = fullText.substring(start, end);
                const isHeader = headerHits.some(h => h.text.includes(snippet.trim()));
                if (!isHeader) {
                    bodyHits.push({ type: 'body', text: snippet, index: bodyHitCount });
                    bodyHitCount++;
                }
            }
        } else if (queryWords.length > 1) {
            // Multi-word query - need to find snippets containing all words with proper boundary matching
            // Build a regex that finds any of the words (with boundaries for short ones)
            const patterns = queryWords.map(w => {
                const safe = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                return w.length < 5 ? `\\b${safe}\\b` : safe;
            });
            const anyWordRegex = new RegExp(`(${patterns.join('|')})`, 'gi');
            let match;
            while ((match = anyWordRegex.exec(fullText)) !== null && bodyHitCount < 10) {
                const start = Math.max(0, match.index - 40);
                const end = Math.min(fullText.length, match.index + match[0].length + 40);
                const snippet = fullText.substring(start, end);
                const isHeader = headerHits.some(h => h.text.includes(snippet.trim()));
                if (!isHeader) {
                    bodyHits.push({ type: 'body', text: snippet, index: bodyHitCount });
                    bodyHitCount++;
                }
            }
        } else {
            // Single long word - simple indexOf
            let searchIndex = 0;
            while ((searchIndex = textLower.indexOf(queryLower, searchIndex)) !== -1 && bodyHitCount < 10) {
                const start = Math.max(0, searchIndex - 40);
                const end = Math.min(fullText.length, searchIndex + query.length + 40);
                const snippet = fullText.substring(start, end);
                const isHeader = headerHits.some(h => h.text.includes(snippet.trim()));
                if (!isHeader) {
                    bodyHits.push({ type: 'body', text: snippet, index: bodyHitCount });
                    bodyHitCount++;
                }
                searchIndex += queryLower.length;
            }
        }
        
        // Add results
        if (titleHit) {
            allGroupedResults.push({ doc, groupType: 'title', score: 100, hits: [{ type: 'title', text: null, index: -1 }] });
        }
        if (headerHits.length > 0) {
            allGroupedResults.push({ doc, groupType: 'header', score: 50, hits: headerHits });
        }
        if (bodyHits.length > 0) {
            allGroupedResults.push({ doc, groupType: 'body', score: 10, hits: bodyHits });
        }
        
        // Cross-match (only for multi-word)
        if (queryWords.length >= 2) {
            const crossMatch = findCrossMatchesFast(doc, queryWords);
            if (crossMatch) {
                const wordsToSearch = crossMatch.contentOnlyWords.length > 0 
                    ? crossMatch.contentOnlyWords 
                    : crossMatch.contentWords;
                let crossSnippets = getCrossMatchSnippetsFast(doc, wordsToSearch);
                crossSnippets.sort((a, b) => {
                    if (a.type === 'cross-header' && b.type === 'cross') return -1;
                    if (a.type === 'cross' && b.type === 'cross-header') return 1;
                    return 0;
                });
                if (crossSnippets.length > 0) {
                    const hasHeaderMatch = crossSnippets.some(s => s.type === 'cross-header');
                    allGroupedResults.push({ 
                        doc, groupType: 'cross', score: hasHeaderMatch ? 35 : 25, 
                        hits: crossSnippets, crossMatch: crossMatch
                    });
                }
            }
        }
    }
    
    allGroupedResults.sort((a, b) => b.score - a.score);
    renderLimit = 50;
    renderResultsList(query);
}

// Fast cross-match using pre-computed lowercase values
function findCrossMatchesFast(doc, words) {
    const titleMatchedWords = [];
    const contentMatchedWords = [];
    const allContent = doc.textLower + ' ' + doc.headersLower.join(' ');
    
    for (const word of words) {
        const wordLower = word.toLowerCase();
        if (doc.titleLower.includes(wordLower)) {
            titleMatchedWords.push(word);
        }
        if (allContent.includes(wordLower)) {
            contentMatchedWords.push(word);
        }
    }
    
    if (titleMatchedWords.length > 0 && contentMatchedWords.length > 0) {
        const titleSet = new Set(titleMatchedWords.map(w => w.toLowerCase()));
        const contentOnlyWords = contentMatchedWords.filter(w => !titleSet.has(w.toLowerCase()));
        return {
            titleWords: titleMatchedWords,
            contentWords: contentMatchedWords,
            contentOnlyWords: contentOnlyWords,
            allWords: [...new Set([...titleMatchedWords, ...contentMatchedWords])]
        };
    }
    return null;
}

// Fast snippet extraction for cross-matches
function getCrossMatchSnippetsFast(doc, contentWords) {
    const snippets = [];
    const usedWords = new Set();
    
    // Check headers for multi-word matches
    if (contentWords.length > 1) {
        for (let hi = 0; hi < doc.headers.length; hi++) {
            const headerLower = doc.headersLower[hi];
            const matchedPhrase = contentWords.filter(w => headerLower.includes(w.toLowerCase()));
            if (matchedPhrase.length >= 2) {
                snippets.push({ 
                    type: 'cross-header', 
                    text: doc.headers[hi], 
                    word: matchedPhrase.join(' '),
                    matchedText: matchedPhrase.join(' '),
                    index: -1,
                    isPhrase: true
                });
                matchedPhrase.forEach(w => usedWords.add(w.toLowerCase()));
            }
        }
    }
    
    // Find individual words not matched in phrases
    for (const word of contentWords) {
        if (usedWords.has(word.toLowerCase())) continue;
        
        const wordLower = word.toLowerCase();
        const idx = doc.textLower.indexOf(wordLower);
        
        if (idx !== -1) {
            const start = Math.max(0, idx - 40);
            const end = Math.min(doc.text.length, idx + word.length + 40);
            snippets.push({ 
                type: 'cross', 
                text: doc.text.substring(start, end), 
                word: word, 
                matchedText: doc.text.substr(idx, word.length),
                index: idx 
            });
        } else {
            // Check headers
            for (let hi = 0; hi < doc.headers.length; hi++) {
                if (doc.headersLower[hi].includes(wordLower)) {
                    snippets.push({ 
                        type: 'cross-header', 
                        text: doc.headers[hi], 
                        word: word, 
                        matchedText: word, 
                        index: -1 
                    });
                    break;
                }
            }
        }
    }
    
    return snippets;
}

function renderResultsList(query) {
    resultsArea.innerHTML = "";
    multiSearchList.innerHTML = "";
    
    if (allGroupedResults.length === 0) {
        resultsArea.innerHTML = `<div class="no-results"><p>No documents found matching "<b>${query}</b>"</p></div>`;
        multiSearchSidebar.classList.remove('active');
        sidebarResizer.classList.remove('active');
        return;
    }
    
    // Separate multi-search results from regular results
    const multiSearchResults = allGroupedResults.filter(g => g.groupType === 'cross');
    const regularResults = allGroupedResults.filter(g => g.groupType !== 'cross');
    
    // Show/hide toggle button based on multi-search results
    const resultsWrapper = document.getElementById('results-wrapper');
    if (multiSearchResults.length > 0) {
        toggleMultiSidebar.classList.add('has-results');
        // Render multi-search results in sidebar using same renderDocumentGroup function
        multiSearchResults.slice(0, renderLimit).forEach(group => renderDocumentGroup(group, query, multiSearchList));
        
        // Show sidebar based on user preference
        if (multiSidebarVisible) {
            multiSearchSidebar.classList.add('active');
            sidebarResizer.classList.add('active');
            toggleMultiSidebar.classList.add('active');
            resultsWrapper.classList.add('full-width');
        } else {
            multiSearchSidebar.classList.remove('active');
            sidebarResizer.classList.remove('active');
            toggleMultiSidebar.classList.remove('active');
            resultsWrapper.classList.remove('full-width');
        }
    } else {
        toggleMultiSidebar.classList.remove('has-results');
        multiSearchSidebar.classList.remove('active');
        sidebarResizer.classList.remove('active');
        toggleMultiSidebar.classList.remove('active');
        resultsWrapper.classList.remove('full-width');
    }
    
    // Render regular results in main area
    const visibleItems = regularResults.slice(0, renderLimit);
    visibleItems.forEach(group => renderDocumentGroup(group, query, resultsArea));

    if (regularResults.length > renderLimit) {
        const loadBtn = document.createElement('button');
        loadBtn.textContent = "Load More Results";
        loadBtn.style.cssText = "display:block; margin: 20px auto; padding: 10px 20px; background: #f1f3f4; border: 1px solid #dadce0; cursor:pointer; border-radius:4px; font-weight:bold; color: #5f6368;";
        loadBtn.addEventListener('click', () => { renderLimit += 50; renderResultsList(query); });
        resultsArea.appendChild(loadBtn);
    }
    
    if (regularResults.length === 0 && multiSearchResults.length > 0) {
        resultsArea.innerHTML = `<div class="no-results" style="margin-top:20px;"><p>Only multi-search results found. See sidebar.</p></div>`;
    }
}

function renderDocumentGroup(group, query, targetContainer = resultsArea) {
    // Get full doc with blob - worker returns lightweight doc without blob
    const docId = group.doc.id;
    const doc = getFullDoc(docId) || group.doc;
    const div = document.createElement('div');
    div.className = 'result-item';
    div.style.marginBottom = "30px"; 

    let badgeHTML = "";
    if (group.groupType === 'header') badgeHTML = `<span style="background:#e6f4ea; color:#137333; font-size:11px; padding:2px 6px; border-radius:4px; margin-left:10px;">Header Matches</span>`;
    else if (group.groupType === 'body') badgeHTML = `<span style="background:#f1f3f4; color:#5f6368; font-size:11px; padding:2px 6px; border-radius:4px; margin-left:10px;">General Results</span>`;
    else if (group.groupType === 'cross') {
        const titleWords = group.crossMatch.titleWords.join(', ');
        const contentWords = group.crossMatch.contentWords.join(', ');
        badgeHTML = `<span style="background:#fef7e0; color:#b45309; font-size:11px; padding:2px 6px; border-radius:4px; margin-left:10px;">Multi-Search: "${titleWords}" in filename + "${contentWords}" in content</span>`;
    }

    // Highlight title words for cross-match
    let displayTitle = doc.title;
    if (group.groupType === 'cross' && group.crossMatch) {
        const titleRegex = new RegExp(`(${group.crossMatch.titleWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
        displayTitle = doc.title.replace(titleRegex, '<mark>$1</mark>');
    }

    div.innerHTML = `
        <div class="result-url">Local • ${doc.date}</div>
        <div class="title-row">
            <a class="result-title">${displayTitle}</a>
            <button class="popout-btn-inline" title="Open in new tab">
                <svg viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
            </button>
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

    const popoutBtn = div.querySelector('.popout-btn-inline');
    const popoutBtnOverlay = div.querySelector('.popout-btn-overlay');

    const snippetList = div.querySelector('.snippet-list');
    // For multi-word queries, use word-boundary-aware highlighting regex
    const multiWordRegex = getMultiWordHighlightRegex(query, 'gi');
    const replaceRegex = multiWordRegex || getSmartRegex(query, 'gi');

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
        showMoreBtn.addEventListener('click', () => { hiddenContainer.style.display = "block"; showMoreBtn.style.display = "none"; });
        snippetList.appendChild(hiddenContainer);
        snippetList.appendChild(showMoreBtn);
    }

    const titleLink = div.querySelector('.result-title');
    titleLink.addEventListener('click', async () => {
        const wrapper = div.querySelector('.viewer-wrapper');
        const container = div.querySelector('.doc-viewer-container');
        if (wrapper.style.display === 'block') { wrapper.style.display = 'none'; } 
        else {
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
                    else if (first.type === 'cross') scrollToWord(container, first.word);
                    else if (first.type === 'cross-header') scrollToHeader(container, first.word, first.text);
                } catch(e) { container.textContent = "Error."; }
            }
        }
    });

    const openPopout = (e) => {
        e.stopPropagation();
        let viewerUrl = `viewer.html?id=${doc.id}&q=${encodeURIComponent(query)}`;
        const first = group.hits[0];
        if (first.type === 'header') viewerUrl += `&target=${encodeURIComponent(first.text)}`;
        else if (first.type === 'body') viewerUrl += `&idx=${first.index}`;
        else if (first.type === 'cross') viewerUrl += `&word=${encodeURIComponent(first.word)}`;
        else if (first.type === 'cross-header') viewerUrl += `&target=${encodeURIComponent(first.text)}`;
        chrome.tabs.create({ url: viewerUrl });
    };

    popoutBtn.addEventListener('click', openPopout);
    popoutBtnOverlay.addEventListener('click', openPopout);

    targetContainer.appendChild(div);
}

function createSnippetRow(hit, parent, replaceRegex, query, resultDiv, doc) {
    const hitDiv = document.createElement('div');
    hitDiv.className = 'snippet-row';
    hitDiv.style.cssText = "display:flex; align-items:center; gap:6px; font-size:13px; color:#4d5156; margin-bottom:4px; cursor:pointer; line-height:1.5; padding:4px; border-radius:4px;";
    hitDiv.addEventListener('mouseenter', () => hitDiv.style.backgroundColor = "#f1f3f4");
    hitDiv.addEventListener('mouseleave', () => hitDiv.style.backgroundColor = "transparent");

    let contentHtml = "";
    if (hit.type === 'header') {
        // For headers, highlight all words if multi-word search
        const multiWordRegex = getMultiWordHighlightRegex(query);
        const highlightRegex = multiWordRegex || replaceRegex;
        const hl = hit.text.replace(highlightRegex, '<span class="search-match" style="color:#e91e63">$1</span>');
        contentHtml = `<strong>Section:</strong> ${hl}`;
    } else if (hit.type === 'body') {
        const hl = hit.text.replace(replaceRegex, '<span class="search-match" style="color:#e91e63">$1</span>');
        contentHtml = `...${hl}...`;
    } else if (hit.type === 'cross') {
        // Cross-match: highlight the specific word found in body content
        // Use word boundary for short words to avoid highlighting within other words
        const safeWord = hit.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const wordRegex = hit.word.length < 5
            ? new RegExp(`(?:^|[\\s,.:;!?()\\[\\]{}"\\/\\-])(${safeWord})(?:$|[\\s,.:;!?()\\[\\]{}"\\/\\-])`, 'gi')
            : new RegExp(`(${safeWord})`, 'gi');
        const hl = hit.text.replace(wordRegex, (match, p1) => match.replace(p1, `<span class="search-match" style="color:#e91e63">${p1}</span>`));
        contentHtml = `<span style="background:#f1f3f4; color:#5f6368; font-size:10px; padding:1px 4px; border-radius:3px; margin-right:6px;">Body</span><strong style="color:#b45309">"${hit.word}":</strong> ...${hl}...`;
    } else if (hit.type === 'cross-header') {
        // Cross-match found in header - use word boundary for short words
        const safeWord = hit.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const wordRegex = hit.word.length < 5
            ? new RegExp(`(?:^|[\\s,.:;!?()\\[\\]{}"\\/\\-])(${safeWord})(?:$|[\\s,.:;!?()\\[\\]{}"\\/\\-])`, 'gi')
            : new RegExp(`(${safeWord})`, 'gi');
        const hl = hit.text.replace(wordRegex, (match, p1) => match.replace(p1, `<span class="search-match" style="color:#e91e63">${p1}</span>`));
        contentHtml = `<span style="background:#e6f4ea; color:#137333; font-size:10px; padding:1px 4px; border-radius:3px; margin-right:6px;">Header</span><strong style="color:#b45309">"${hit.word}":</strong> ${hl}`;
    } else { contentHtml = `<em>Match in document title</em>`; }

    // Create content span
    const contentSpan = document.createElement('span');
    contentSpan.style.cssText = "flex:1; overflow:hidden; text-overflow:ellipsis;";
    contentSpan.innerHTML = contentHtml;

    // Create small popout button for this specific result
    const snippetPopout = document.createElement('button');
    snippetPopout.className = 'snippet-popout-btn';
    snippetPopout.title = 'Open to this result in new tab';
    snippetPopout.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>';
    
    snippetPopout.addEventListener('click', (e) => {
        e.stopPropagation();
        let viewerUrl = `viewer.html?id=${doc.id}&q=${encodeURIComponent(query)}`;
        if (hit.type === 'header') viewerUrl += `&target=${encodeURIComponent(hit.text)}`;
        else if (hit.type === 'body') viewerUrl += `&idx=${hit.index}`;
        else if (hit.type === 'cross') viewerUrl += `&word=${encodeURIComponent(hit.word)}`;
        else if (hit.type === 'cross-header') viewerUrl += `&target=${encodeURIComponent(hit.text)}`;
        chrome.tabs.create({ url: viewerUrl });
    });

    hitDiv.appendChild(contentSpan);
    hitDiv.appendChild(snippetPopout);

    hitDiv.addEventListener('click', async (e) => {
        e.stopPropagation();
        const wrapper = resultDiv.querySelector('.viewer-wrapper');
        const container = resultDiv.querySelector('.doc-viewer-container');
        // If no viewer wrapper (sidebar items), open in popout instead
        if (!wrapper || !container) {
            let viewerUrl = `viewer.html?id=${doc.id}&q=${encodeURIComponent(query)}`;
            if (hit.type === 'header') viewerUrl += `&target=${encodeURIComponent(hit.text)}`;
            else if (hit.type === 'body') viewerUrl += `&idx=${hit.index}`;
            else if (hit.type === 'cross') viewerUrl += `&word=${encodeURIComponent(hit.word)}`;
            else if (hit.type === 'cross-header') viewerUrl += `&target=${encodeURIComponent(hit.text)}`;
            chrome.tabs.create({ url: viewerUrl });
            return;
        }
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
        else if (hit.type === 'cross') scrollToWord(container, hit.word);
        else if (hit.type === 'cross-header') scrollToHeader(container, hit.word, hit.text);
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

// Scroll to first occurrence of a specific word (for cross-match)
function scrollToWord(container, word) {
    requestAnimationFrame(() => {
        setTimeout(() => {
            const regex = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
            const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
            
            let node;
            while ((node = walker.nextNode())) {
                const match = regex.exec(node.textContent);
                if (match) {
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
            }
        }, 100);
    });
}

// --- Sidebar Resizer ---
if (sidebarResizer && multiSearchSidebar) {
    let isResizing = false;
    
    sidebarResizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const windowWidth = window.innerWidth;
        // Calculate percentage from left edge of window
        let percentage = (e.clientX / windowWidth) * 100;
        // Clamp between 20% and 80%
        percentage = Math.max(20, Math.min(80, percentage));
        multiSearchSidebar.style.width = percentage + '%';
    });
    
    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });
}

// --- Toggle Multi-Search Sidebar ---
if (toggleMultiSidebar) {
    toggleMultiSidebar.addEventListener('click', () => {
        multiSidebarVisible = !multiSidebarVisible;
        const resultsWrapper = document.getElementById('results-wrapper');
        
        if (multiSidebarVisible) {
            multiSearchSidebar.classList.add('active');
            sidebarResizer.classList.add('active');
            toggleMultiSidebar.classList.add('active');
            resultsWrapper.classList.add('full-width');
        } else {
            multiSearchSidebar.classList.remove('active');
            sidebarResizer.classList.remove('active');
            toggleMultiSidebar.classList.remove('active');
            resultsWrapper.classList.remove('full-width');
        }
    });
}

initDB();