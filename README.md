# DocBase - Local Docx Search Engine

**DocBase** is a browser extension that creates a private, local search engine for your `.docx` files. It allows you to bulk upload Word documents into your browser's local storage, index their content, and perform instant full-text searches with weighted relevancy—all without a single byte of data leaving your machine.


## 🚀 Key Features

* **🔒 100% Private & Offline**: Files are stored locally in your browser's `IndexedDB` via the `unlimitedStorage` permission. No cloud uploads, no tracking, and no external servers.
* **⚡ Smart Full-Text Search**:
    * **Weighted Ranking**: Prioritizes matches in Titles (Score: 100), Headers (Score: 50), and Body text (Score: 10).
    * **Context Snippets**: Search results display snippets of text surrounding your keywords with highlights.
    * **Keyword Highlighting**: Matches are highlighted in yellow within the document viewer.
* **📄 High-Fidelity Viewer**: Renders `.docx` files natively in the browser using `docx-preview`, preserving formatting and layout.
* **📑 Auto-Generated Outlines**: The viewer automatically generates a navigable Table of Contents sidebar based on document headers (H1-H6).
* **🖨️ Print & PDF**: Includes a built-in print function to save rendered documents as PDFs.
* **📂 File Management**: Rename or delete files directly from the database manager.

## 🛠️ Tech Stack

* **Platform**: Chrome Extension (Manifest V3)
* **Storage**: IndexedDB (Native Browser Database)
* **Core Libraries**:
    * **Mammoth.js**: Used for extracting raw text and structure for indexing.
    * **docx-preview**: Used for rendering the visual document in the viewer.
    * **JSZip**: Required dependency for unzipping `.docx` packages.

## 📦 Installation

Since this runs locally, you must install it in Developer Mode:

1.  **Clone** this repository to your local machine.
2.  Open your browser (Chrome, Edge, Brave, etc.) and navigate to `chrome://extensions`.
3.  Enable **Developer mode** in the top right corner.
4.  Click **Load unpacked**.
5.  Select the folder containing the `manifest.json` file.

## 📖 How to Use

### 1. Uploading Files
1.  Click the extension icon to open the **Manager** (or the search interface).
2.  Click **Manage Database**.
3.  Drag and drop (or select) `.docx` files into the upload area. The status text will update as files are processed and indexed.

### 2. Searching
1.  Type a query into the main search box.
2.  Results appear instantly. Matches found in headers or titles are ranked higher than body text.
3.  **Inline Preview**: Click a result title to expand the document directly in the list.
4.  **Full View**: Click the **Popout Icon** (↗) to open the document in a dedicated tab.

### 3. Viewing
1.  In the full viewer, use the **Sidebar** to jump between sections.
2.  The sidebar can be resized by dragging the handle.
3.  Use `Ctrl+P` or the **Print** button to save the view as a PDF.

## ⚙️ Search Logic

The search engine (`logic.js`) parses files upon upload using `Mammoth.js` to extract raw text and HTML headers. It assigns scores to matches as follows:

| Match Location | Priority Score |
| :--- | :--- |
| **Title** | 100 |
| **Header (H1-H6)** | 50 |
| **Body Text** | 10 |

## ⚠️ Data Persistence

Please note: Because this extension uses `IndexedDB` inside your browser, **clearing your browser's "Site Data" or "Cookies" may wipe your document database**. Always keep backups of your original `.docx` files.

## 📄 License

This project is licensed under the MIT License.
