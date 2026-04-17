/**
 * Novel Translator Pro - Text Chunker
 * Chia văn bản thành các chunk thông minh
 */

// ============================================
// SMART CHUNKING - Chia văn bản thông minh
// ============================================
function splitTextIntoChunks(text, maxSize) {
    const chunks = [];

    // Normalize line breaks
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Split by double newlines (paragraphs) or single newlines
    const paragraphs = text.split(/\n\s*\n/);
    let currentChunk = '';
    let lastContext = ''; // Lưu câu cuối để context carryover

    for (const paragraph of paragraphs) {
        const trimmed = paragraph.trim();
        if (!trimmed) continue;

        // Check if adding this paragraph exceeds max size
        if (currentChunk.length + trimmed.length + 2 > maxSize) {
            if (currentChunk.trim()) {
                chunks.push(currentChunk.trim());

                // Extract last sentence for context (max 200 chars)
                lastContext = extractLastSentence(currentChunk, 200);
            }

            if (trimmed.length > maxSize) {
                // Split long paragraphs by sentences intelligently
                const sentenceChunks = splitBySentences(trimmed, maxSize, lastContext);

                for (let i = 0; i < sentenceChunks.length - 1; i++) {
                    chunks.push(sentenceChunks[i]);
                    lastContext = extractLastSentence(sentenceChunks[i], 200);
                }

                currentChunk = sentenceChunks[sentenceChunks.length - 1] || '';
            } else {
                currentChunk = trimmed;
            }
        } else {
            currentChunk += (currentChunk ? '\n\n' : '') + trimmed;
        }
    }

    if (currentChunk.trim()) chunks.push(currentChunk.trim());

    console.log(`[Smart Chunking] Split into ${chunks.length} chunks, avg size: ${Math.round(text.length / chunks.length)} chars`);
    return chunks;
}

// Extract last sentence from text (for context carryover)
function extractLastSentence(text, maxLength = 200) {
    // Find last sentence ending
    const sentences = text.match(/[^.!?。！？]*[.!?。！？]+/g);
    if (!sentences || sentences.length === 0) {
        return text.slice(-maxLength);
    }

    let lastSentence = sentences[sentences.length - 1].trim();
    if (lastSentence.length > maxLength) {
        lastSentence = lastSentence.slice(-maxLength);
    }
    return lastSentence;
}

// Smart split by sentences - avoid cutting in middle of dialogue
function splitBySentences(text, maxSize, contextPrefix = '') {
    const chunks = [];

    // Split by sentences (keep delimiter)
    // Handle both Western and Asian punctuation
    const sentencePattern = /([^.!?。！？]*[.!?。！？]+\s*)/g;
    const sentences = text.match(sentencePattern) || [text];

    let currentChunk = '';
    let inDialogue = false;

    for (const sentence of sentences) {
        // Check if we're in a dialogue (has opening quote but no closing)
        const openQuotes = (sentence.match(/[""「『【《]/g) || []).length;
        const closeQuotes = (sentence.match(/[""」』】》]/g) || []).length;

        if (openQuotes > closeQuotes) {
            inDialogue = true;
        } else if (closeQuotes > openQuotes || (closeQuotes > 0 && openQuotes === closeQuotes)) {
            inDialogue = false;
        }

        // Don't break in the middle of dialogue if possible
        const wouldExceed = currentChunk.length + sentence.length > maxSize;
        const shouldBreak = wouldExceed && !inDialogue && currentChunk.length > 0;

        if (shouldBreak) {
            if (currentChunk.trim()) {
                chunks.push(currentChunk.trim());
            }
            currentChunk = sentence;
        } else if (wouldExceed && currentChunk.length > maxSize * 0.8) {
            // Force break even in dialogue if chunk is too big
            if (currentChunk.trim()) {
                chunks.push(currentChunk.trim());
            }
            currentChunk = sentence;
        } else {
            currentChunk += sentence;
        }
    }

    if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
    }

    return chunks;
}
