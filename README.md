# DocBase - Offline Search Engine for Debate Evidence

**DocBase** is a browser extension designed for Policy, LD, and PF debaters. It creates a private, offline search engine for your local `.docx` backfiles. 

Stop relying on slow Drive searches or spotty tournament Wi-Fi. Download entire camp files from [Open Evidence](https://opencaselist.com/openev), index them in your browser, and find the perfect card in milliseconds.

![Extension Screenshot Placeholder](https://raw.githubusercontent.com/naiythen/DocBase/refs/heads/main/Screenshot%202025-12-05%20173557.png)

## 🏆 Tournament Ready Features

* **🚫 100% Offline & Private**: Works entirely without internet. Your prep stays on your machine in the browser's `IndexedDB`. No cloud uploads.
* **⚡ Instant Card Search**:
    * **Smart Ranking**: Prioritizes **File Names** and **Taglines/Cites** (Headers) over card text.
    * **Snippet Preview**: See the context around the match before opening the file.
* **📑 Native Docx Viewer**: View files with full formatting (highlighting, underlining, bolding) preserved.
* **navigable Outline**: The viewer automatically generates a sidebar based on Headers (Taglines), allowing you to jump between blocks instantly.
* **📂 Bulk Management**: Drag and drop 50+ Open Ev files at once. Manage your database easily.

## 📖 How to Use for Debate

### 1. Download Backfiles
Go to [Open Evidence](https://opencaselist.com/openev) and download the `.docx` files you need (e.g., "K Affs", "Politics DA", "T - Substantial").

### 2. Index Your Prep
1.  Click the **DocBase** extension icon.
2.  Click **Manage Database**.
3.  Drag and drop your downloaded files into the upload zone. The extension will parse the taglines and text instantly.

### 3. Search During Rounds
1.  Type a query (e.g., *"hegemony collapse war"* or *"cap k link"*).
2.  **Inline Preview**: Click a title to verify it's the right file.
3.  **Popout View**: Click the **Popout Icon** (↗) to open the file in a new tab for reading speeches.
4.  **Scroll Spy**: Use the left sidebar to jump specifically to the 1NC Shell or 2AC blocks.

## ⚙️ Search Logic (The "Card" Algorithm)

The search engine is optimized for how debate evidence is formatted. It ranks results based on where the keyword appears:

| Match Location | Debate Equivalent | Priority Score |
| :--- | :--- | :--- |
| **Document Title** | File Name (e.g., "Camp_Politics_DA.docx") | **100 (Highest)** |
| **HTML Headers (H1-H6)** | **Taglines & Cites** | **50 (High)** |
| **Body Text** | Card Text / Warrants | **10 (Standard)** |

## 📦 Installation

Since this is a specialized local tool, install it via Developer Mode:

1.  **Clone/Download** this repository.
2.  Open **Chrome/Edge** and go to `chrome://extensions`.
3.  Toggle **Developer mode** (top right).
4.  Click **Load unpacked**.
5.  Select the folder containing `manifest.json`.

## 🛠️ Tech Stack

* **Mammoth.js**: Extracts raw text for the search index.
* **docx-preview**: Renders the evidence with full formatting (crucial for reading cards).
* **IndexedDB**: Stores your backfiles locally in the browser (via `unlimitedStorage`).

## ⚠️ Important Note on Data

Your files are stored in your browser's local storage. **If you clear your "Cookies and Site Data" or "Hosted App Data," your database will be wiped.** Always keep your original `.docx` files on your hard drive as a backup.

## 📄 License

MIT License. Free for the debate community to use and modify.
