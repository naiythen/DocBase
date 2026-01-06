let documentCache = [];

self.onmessage = function(e) {
    const { type, data } = e.data;

    if (type === 'setCache') {
        documentCache = data.documents;
        self.postMessage({ type: 'cacheReady' });
    } else if (type === 'search') {
        const results = performSearch(data.query, data.filters);
        self.postMessage({ type: 'results', results, query: data.query });
    }
};

function getSmartRegex(query, flags = 'i') {
    const safeQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (query.length >= 5) return new RegExp(`(${safeQuery})`, flags);
    else return new RegExp(`(\\b${safeQuery}\\b)`, flags);
}

function performSearch(query, filters) {
    const results = [];
    const queryLower = query.toLowerCase();
    const queryWords = query.trim().split(/\s+/).filter(w => w.length > 0);
    const isShortQuery = query.length < 5;

    let regex = null;
    if (isShortQuery) {
        regex = getSmartRegex(query);
    }

    for (const doc of documentCache) {

        if (filters.length > 0 && !filters.includes(doc.collectionId)) {
            continue;
        }

        let titleHit = false;
        let headerHits = [];
        let bodyHits = [];

        if (isShortQuery) {
            titleHit = regex.test(doc.title);
        } else {
            titleHit = doc.titleLower.includes(queryLower);
        }

        for (let hi = 0; hi < doc.headers.length; hi++) {
            const headerLower = doc.headersLower[hi];
            let matches = false;

            if (isShortQuery) {
                matches = regex.test(doc.headers[hi]);
            } else {
                matches = headerLower.includes(queryLower);
            }

            if (!matches && queryWords.length > 1) {
                matches = queryWords.every(w => {
                    if (w.length < 5) {

                        const wordRegex = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
                        return wordRegex.test(doc.headers[hi]);
                    } else {
                        return headerLower.includes(w.toLowerCase());
                    }
                });
            }

            if (matches) {
                headerHits.push({ type: 'header', text: doc.headers[hi], index: -1 });
            }
        }

        const textLower = doc.textLower;
        const fullText = doc.text;
        let bodyHitCount = 0;

        if (isShortQuery) {

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

        if (titleHit) {
            results.push({ doc: serializeDoc(doc), groupType: 'title', score: 100, hits: [{ type: 'title', text: null, index: -1 }] });
        }
        if (headerHits.length > 0) {
            results.push({ doc: serializeDoc(doc), groupType: 'header', score: 50, hits: headerHits });
        }
        if (bodyHits.length > 0) {
            results.push({ doc: serializeDoc(doc), groupType: 'body', score: 10, hits: bodyHits });
        }

        if (queryWords.length >= 2) {
            const crossMatch = findCrossMatches(doc, queryWords);
            if (crossMatch) {

                const hasWordsOnlyInContent = crossMatch.contentOnlyWords.length > 0;

                if (hasWordsOnlyInContent) {
                    const wordsToSearch = crossMatch.contentOnlyWords;
                    let crossSnippets = getCrossMatchSnippets(doc, wordsToSearch);
                    crossSnippets.sort((a, b) => {
                        if (a.type === 'cross-header' && b.type === 'cross') return -1;
                        if (a.type === 'cross' && b.type === 'cross-header') return 1;
                        return 0;
                    });
                    if (crossSnippets.length > 0) {
                        const hasHeaderMatch = crossSnippets.some(s => s.type === 'cross-header');

                        results.push({ 
                            doc: serializeDoc(doc), 
                            groupType: 'cross', 
                            score: hasHeaderMatch ? 90 : 55,
                            hits: crossSnippets,
                            crossMatch: crossMatch
                        });
                    }
                }
            }
        }
    }

    results.sort((a, b) => b.score - a.score);
    return results;
}

function serializeDoc(doc) {
    return {
        id: doc.id,
        title: doc.title,
        text: doc.text,
        headers: doc.headers,
        date: doc.date,
        collectionId: doc.collectionId
    };
}

function wordMatchesInText(word, text, textLower) {
    const wordLower = word.toLowerCase();
    if (word.length < 5) {

        const safeWord = wordLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(?:^|[\\s,.:;!?()\\[\\]{}"\\/\\-])${safeWord}(?:$|[\\s,.:;!?()\\[\\]{}"\\/\\-])`, 'i');
        return regex.test(text);
    } else {
        return textLower.includes(wordLower);
    }
}

function findWordMatchIndex(word, text, textLower) {
    const wordLower = word.toLowerCase();
    if (word.length < 5) {
        const safeWord = wordLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(?:^|[\\s,.:;!?()\\[\\]{}"\\/\\-])${safeWord}(?:$|[\\s,.:;!?()\\[\\]{}"\\/\\-])`, 'i');
        const match = regex.exec(text);
        if (match) {

            const matchText = match[0];
            const wordStart = matchText.toLowerCase().indexOf(wordLower);
            return match.index + wordStart;
        }
        return -1;
    } else {
        return textLower.indexOf(wordLower);
    }
}

function findCrossMatches(doc, words) {
    const titleMatchedWords = [];
    const contentMatchedWords = [];
    const allContent = doc.text + ' ' + doc.headers.join(' ');
    const allContentLower = doc.textLower + ' ' + doc.headersLower.join(' ');

    for (const word of words) {

        if (wordMatchesInText(word, doc.title, doc.titleLower)) {
            titleMatchedWords.push(word);
        }

        if (wordMatchesInText(word, allContent, allContentLower)) {
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

function getCrossMatchSnippets(doc, contentWords) {
    const snippets = [];
    const usedWords = new Set();

    if (contentWords.length > 1) {
        for (let hi = 0; hi < doc.headers.length; hi++) {
            const header = doc.headers[hi];
            const headerLower = doc.headersLower[hi];

            const matchedPhrase = contentWords.filter(w => wordMatchesInText(w, header, headerLower));
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

    for (const word of contentWords) {
        if (usedWords.has(word.toLowerCase())) continue;

        const idx = findWordMatchIndex(word, doc.text, doc.textLower);

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

            for (let hi = 0; hi < doc.headers.length; hi++) {
                if (wordMatchesInText(word, doc.headers[hi], doc.headersLower[hi])) {
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
