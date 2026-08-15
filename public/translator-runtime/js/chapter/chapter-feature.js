/**
 * On-demand chapter reader UI and worker lifecycle.
 * Heavy scanning and EPUB packaging never run on the main thread.
 */
(function attachTranslatorChapterFeature(global) {
    'use strict';

    const TOC_ROW_HEIGHT = 48;
    const TOC_MAX_ROWS = 60;
    const PAGE_BYTES = 256 * 1024;

    function computeVirtualWindow(totalRows, scrollTop, viewportHeight, options = {}) {
        const total = Math.max(0, Math.trunc(Number(totalRows) || 0));
        const rowHeight = Math.max(1, Number(options.rowHeight) || TOC_ROW_HEIGHT);
        const maxRows = Math.max(1, Math.min(TOC_MAX_ROWS, Number(options.maxRows) || TOC_MAX_ROWS));
        const overscan = Math.max(0, Math.trunc(Number(options.overscan) || 8));
        const firstVisible = Math.max(0, Math.floor((Number(scrollTop) || 0) / rowHeight));
        const visibleCount = Math.max(1, Math.ceil((Number(viewportHeight) || rowHeight) / rowHeight));
        const desiredCount = Math.min(maxRows, visibleCount + (overscan * 2));
        let start = Math.max(0, firstVisible - overscan);
        let end = Math.min(total, start + desiredCount);
        start = Math.max(0, end - desiredCount);
        return { start, end, rowHeight, totalHeight: total * rowHeight };
    }

    function createBytePages(startByte, endByte, maxPageBytes = PAGE_BYTES) {
        const start = Math.max(0, Math.trunc(Number(startByte) || 0));
        const end = Math.max(start, Math.trunc(Number(endByte) || 0));
        const limit = Math.max(1, Math.trunc(Number(maxPageBytes) || PAGE_BYTES));
        if (start === end) return [{ start, end }];
        const pages = [];
        for (let cursor = start; cursor < end; cursor += limit) {
            pages.push({ start: cursor, end: Math.min(end, cursor + limit) });
        }
        return pages;
    }

    function findSafeUtf8End(bytes, desiredEnd) {
        const limit = Math.max(0, Math.min(bytes?.length || 0, Math.trunc(Number(desiredEnd) || 0)));
        if (limit <= 0 || limit >= (bytes?.length || 0)) return limit;
        let leadIndex = limit;
        while (leadIndex > 0 && (bytes[leadIndex] & 0xC0) === 0x80) leadIndex -= 1;
        if (leadIndex === limit) return limit;
        const lead = bytes[leadIndex];
        const width = lead < 0x80 ? 1 : lead < 0xE0 ? 2 : lead < 0xF0 ? 3 : 4;
        return leadIndex + width <= limit ? limit : leadIndex;
    }

    function isSyntheticFallbackChapter(chapter, chapterCount) {
        return Number(chapterCount) === 1
            && String(chapter?.title || '').trim() === 'Nội dung'
            && chapter?.family === 'special'
            && Number(chapter?.headingByteStart) === 0
            && Number(chapter?.contentByteStart) === 0;
    }

    async function createSafeBlobPages(blob, startByte, endByte) {
        const roughPages = createBytePages(startByte, endByte);
        if (roughPages.length <= 1) return roughPages;
        const pages = [];
        let cursor = roughPages[0].start;
        const absoluteEnd = roughPages[roughPages.length - 1].end;
        while (cursor < absoluteEnd) {
            const desiredEnd = Math.min(absoluteEnd, cursor + PAGE_BYTES);
            if (desiredEnd === absoluteEnd) {
                pages.push({ start: cursor, end: absoluteEnd });
                break;
            }
            const probeStart = Math.max(cursor, desiredEnd - 4);
            const probeEnd = Math.min(absoluteEnd, desiredEnd + 4);
            const probe = new Uint8Array(await blob.slice(probeStart, probeEnd).arrayBuffer());
            const safeRelativeEnd = findSafeUtf8End(probe, desiredEnd - probeStart);
            const safeEnd = Math.max(cursor + 1, probeStart + safeRelativeEnd);
            pages.push({ start: cursor, end: safeEnd });
            cursor = safeEnd;
        }
        return pages.length > 0 ? pages : [{ start: startByte, end: endByte }];
    }

    global.TranslatorChapterFeatureUtils = Object.freeze({
        PAGE_BYTES,
        TOC_MAX_ROWS,
        computeVirtualWindow,
        createBytePages,
        createSafeBlobPages,
        findSafeUtf8End,
        isSyntheticFallbackChapter,
    });

    if (!global.document) return;

    const state = {
        activeWorker: null,
        activeReject: null,
        activeRequestId: '',
        loadToken: 0,
        kind: 'source',
        snapshot: null,
        chapters: [],
        suggestions: [],
        displayRows: [],
        searchMatches: [],
        activeChapterIndex: 0,
        activePageIndex: 0,
        activePages: [],
        renderToken: 0,
        editMode: false,
        showSuggestions: false,
        previousFocus: null,
        staleTimer: null,
        openedGeneration: null,
        sourceCache: null,
        outputCache: null,
        tocRenderFrame: 0,
    };

    const byId = id => global.document.getElementById(id);

    function readOutputGeneration() {
        try {
            return typeof translatorOutputGeneration !== 'undefined'
                ? translatorOutputGeneration
                : null;
        } catch (_error) {
            return null;
        }
    }

    function isReaderOpen() {
        const reader = byId('chapterReader');
        return Boolean(reader && !reader.hidden);
    }

    function setReaderStatus(message, options = {}) {
        const status = byId('chapterReaderStatus');
        const progress = byId('chapterReaderProgressFill');
        if (status) {
            status.textContent = String(message || '');
            status.dataset.tone = options.tone || '';
        }
        if (progress) {
            const value = Math.max(0, Math.min(1, Number(options.progress) || 0));
            progress.style.transform = `scaleX(${value})`;
            progress.parentElement.hidden = !options.busy;
        }
        const cancel = byId('cancelChapterTaskBtn');
        if (cancel) cancel.hidden = !options.busy;
    }

    function setReaderActionsEnabled(enabled) {
        const exportButton = byId('exportChapterEpubBtn');
        const editButton = byId('toggleChapterEditBtn');
        if (exportButton) exportButton.disabled = !enabled;
        if (editButton) editButton.disabled = !enabled;
    }

    function newRequestId(type) {
        return `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    }

    function terminateActiveWorker(reason = 'Đã hủy tác vụ.') {
        const worker = state.activeWorker;
        const reject = state.activeReject;
        state.activeWorker = null;
        state.activeReject = null;
        state.activeRequestId = '';
        if (worker) worker.terminate();
        if (reject) {
            const error = new Error(reason);
            error.name = 'AbortError';
            reject(error);
        }
    }

    function runChapterWorker(type, payload = {}, onProgress) {
        terminateActiveWorker('Tác vụ trước đã được thay thế.');
        if (typeof global.Worker !== 'function') {
            return Promise.reject(new Error('Trình duyệt này không hỗ trợ xử lý chương ngoài luồng.'));
        }
        const requestId = newRequestId(type);
        const worker = new global.Worker('js/chapter/chapter-worker.js?v=1');
        state.activeWorker = worker;
        state.activeRequestId = requestId;

        return new Promise((resolve, reject) => {
            state.activeReject = reject;
            const cleanup = () => {
                worker.terminate();
                if (state.activeWorker === worker) state.activeWorker = null;
                if (state.activeReject === reject) state.activeReject = null;
                if (state.activeRequestId === requestId) state.activeRequestId = '';
            };
            worker.addEventListener('message', event => {
                const message = event.data || {};
                if (message.requestId !== requestId) return;
                if (message.type === 'progress') {
                    onProgress?.(message);
                    return;
                }
                cleanup();
                if (message.type === 'complete') resolve(message.result || message);
                else reject(new Error(message.message || 'Không thể xử lý mục lục chương.'));
            });
            worker.addEventListener('error', event => {
                cleanup();
                reject(new Error(event.message || 'Worker chia chương đã dừng ngoài dự kiến.'));
            });
            worker.postMessage({ type, requestId, ...payload });
        });
    }

    function defaultBookTitle(fileName) {
        return String(fileName || 'Truyện')
            .replace(/\.txt$/i, '')
            .replace(/_translated$/i, '')
            .replace(/[_-]+/g, ' ')
            .trim() || 'Truyện';
    }

    function cloneIndexResult(result) {
        return {
            chapters: Array.isArray(result?.chapters) ? result.chapters.map(item => ({ ...item })) : [],
            suggestions: Array.isArray(result?.suggestions) ? result.suggestions.map(item => ({ ...item })) : [],
            diagnostics: Array.isArray(result?.diagnostics) ? result.diagnostics.slice(0, 200) : [],
            warning: String(result?.warning || ''),
        };
    }

    function getCache(snapshot) {
        if (!snapshot || snapshot.partial) return null;
        const cache = snapshot.kind === 'source' ? state.sourceCache : state.outputCache;
        return cache?.revision === snapshot.revision ? cloneIndexResult(cache.result) : null;
    }

    function setCache(snapshot, result) {
        if (!snapshot || snapshot.partial) return;
        const cache = { revision: snapshot.revision, result: cloneIndexResult(result) };
        if (snapshot.kind === 'source') state.sourceCache = cache;
        else state.outputCache = cache;
    }

    function updateReaderMetadata(snapshot, preserved = {}) {
        const title = byId('chapterBookTitle');
        const author = byId('chapterBookAuthor');
        if (title) title.value = preserved.title || defaultBookTitle(snapshot.fileName);
        if (author) author.value = preserved.author || '';
        const scope = byId('chapterReaderScope');
        if (scope) {
            scope.textContent = snapshot.partial
                ? `Bản tạm · ${snapshot.completedChunks}/${snapshot.totalChunks} chunk liên tục`
                : snapshot.kind === 'source' ? 'File TXT nguồn' : 'Bản dịch hoàn tất';
        }
    }

    function showReaderShell() {
        const reader = byId('chapterReader');
        if (!reader) throw new Error('Thiếu giao diện đọc theo chương.');
        if (!isReaderOpen()) state.previousFocus = global.document.activeElement;
        reader.hidden = false;
        global.document.body.classList.add('chapter-reader-open');
        const closeButton = byId('closeChapterReaderBtn');
        global.setTimeout?.(() => closeButton?.focus(), 0);
    }

    function updateStaleNotice() {
        if (!state.snapshot?.partial || state.snapshot.kind !== 'translated') return;
        const current = readOutputGeneration();
        const stale = current !== null && state.openedGeneration !== null && current !== state.openedGeneration;
        const notice = byId('chapterReaderStale');
        if (notice) notice.hidden = !stale;
    }

    function startStaleWatcher() {
        if (state.staleTimer) global.clearInterval(state.staleTimer);
        state.staleTimer = null;
        state.openedGeneration = readOutputGeneration();
        if (state.snapshot?.partial && state.snapshot.kind === 'translated') {
            state.staleTimer = global.setInterval(updateStaleNotice, 1000);
        }
    }

    function rebuildDisplayRows() {
        const rows = state.chapters.map((chapter, chapterIndex) => ({
            ...chapter,
            chapterIndex,
            suggested: false,
        }));
        if (state.editMode && state.showSuggestions) {
            state.suggestions.forEach((suggestion, suggestionIndex) => {
                rows.push({ ...suggestion, suggestionIndex, suggested: true });
            });
            rows.sort((left, right) => Number(left.headingByteStart) - Number(right.headingByteStart));
        }
        state.displayRows = rows;
        renderTocWindow();
    }

    function createTocRow(row, displayIndex, top) {
        const wrapper = global.document.createElement('div');
        wrapper.className = `chapter-toc-row${row.level === 'container' ? ' is-container' : ''}${row.suggested ? ' is-suggested' : ''}`;
        wrapper.style.transform = `translateY(${top}px)`;
        wrapper.dataset.displayIndex = String(displayIndex);

        const select = global.document.createElement('button');
        select.type = 'button';
        select.className = 'chapter-toc-select';
        select.textContent = row.title || 'Chương không tên';
        if (row.suggested) {
            select.dataset.clickAction = 'enableSuggestedChapterBoundary';
            select.dataset.suggestionIndex = String(row.suggestionIndex);
            select.title = 'Bật mốc gợi ý này';
        } else {
            select.dataset.clickAction = 'selectReaderChapter';
            select.dataset.chapterIndex = String(row.chapterIndex);
            select.setAttribute('aria-current', row.chapterIndex === state.activeChapterIndex ? 'true' : 'false');
        }
        wrapper.appendChild(select);

        if (state.editMode && !row.suggested && row.chapterIndex > 0) {
            const remove = global.document.createElement('button');
            remove.type = 'button';
            remove.className = 'chapter-boundary-remove';
            remove.dataset.clickAction = 'removeChapterBoundary';
            remove.dataset.chapterIndex = String(row.chapterIndex);
            remove.setAttribute('aria-label', `Bỏ mốc ${row.title || row.chapterIndex + 1}`);
            remove.textContent = '×';
            wrapper.appendChild(remove);
        }
        return wrapper;
    }

    function renderTocWindow() {
        const viewport = byId('chapterTocViewport');
        const canvas = byId('chapterTocCanvas');
        if (!viewport || !canvas) return;
        const windowState = computeVirtualWindow(
            state.displayRows.length,
            viewport.scrollTop,
            viewport.clientHeight || 480,
        );
        canvas.style.height = `${windowState.totalHeight}px`;
        canvas.replaceChildren();
        const fragment = global.document.createDocumentFragment();
        for (let index = windowState.start; index < windowState.end; index += 1) {
            fragment.appendChild(createTocRow(state.displayRows[index], index, index * windowState.rowHeight));
        }
        canvas.appendChild(fragment);
        const count = byId('chapterReaderCount');
        const countLabel = `${state.chapters.length.toLocaleString('vi-VN')} mục`;
        if (count && count.textContent !== countLabel) count.textContent = countLabel;
    }

    function scheduleTocRender() {
        if (state.tocRenderFrame) return;
        const schedule = global.requestAnimationFrame || (callback => global.setTimeout(callback, 16));
        state.tocRenderFrame = schedule(() => {
            state.tocRenderFrame = 0;
            renderTocWindow();
        });
    }

    function scrollActiveChapterIntoView() {
        const viewport = byId('chapterTocViewport');
        if (!viewport) return;
        const displayIndex = state.displayRows.findIndex(row => !row.suggested && row.chapterIndex === state.activeChapterIndex);
        if (displayIndex < 0) return;
        const top = displayIndex * TOC_ROW_HEIGHT;
        if (top < viewport.scrollTop) viewport.scrollTop = top;
        else if (top + TOC_ROW_HEIGHT > viewport.scrollTop + viewport.clientHeight) {
            viewport.scrollTop = Math.max(0, top - viewport.clientHeight + TOC_ROW_HEIGHT);
        }
    }

    function updateReaderNavigation() {
        const previous = byId('previousReaderChapterBtn');
        const next = byId('nextReaderChapterBtn');
        if (previous) previous.disabled = state.activeChapterIndex <= 0;
        if (next) next.disabled = state.activeChapterIndex >= state.chapters.length - 1;
        const previousPage = byId('previousReaderPageBtn');
        const nextPage = byId('nextReaderPageBtn');
        if (previousPage) previousPage.disabled = state.activePageIndex <= 0;
        if (nextPage) nextPage.disabled = state.activePageIndex >= state.activePages.length - 1;
        const pageInfo = byId('chapterReaderPageInfo');
        if (pageInfo) {
            pageInfo.textContent = state.activePages.length > 1
                ? `Trang ${state.activePageIndex + 1}/${state.activePages.length}`
                : '';
        }
        const pageActions = byId('chapterReaderPageActions');
        if (pageActions) pageActions.hidden = state.activePages.length <= 1;
    }

    async function renderActiveChapter(chapterIndex = state.activeChapterIndex, pageIndex = 0) {
        if (!state.snapshot || state.chapters.length === 0) return;
        const safeChapterIndex = Math.max(0, Math.min(state.chapters.length - 1, Math.trunc(Number(chapterIndex) || 0)));
        const chapter = state.chapters[safeChapterIndex];
        const token = ++state.renderToken;
        state.activeChapterIndex = safeChapterIndex;
        state.activePages = await createSafeBlobPages(
            state.snapshot.blob,
            Number(chapter.contentByteStart) || 0,
            Number(chapter.byteEnd) || 0,
        );
        if (token !== state.renderToken) return;
        state.activePageIndex = Math.max(0, Math.min(state.activePages.length - 1, Math.trunc(Number(pageIndex) || 0)));
        const page = state.activePages[state.activePageIndex];
        let text = await state.snapshot.blob.slice(page.start, page.end).text();
        if (page.start === 0) text = text.replace(/^\uFEFF/, '');
        if (token !== state.renderToken) return;

        const title = byId('chapterReaderChapterTitle');
        const body = byId('chapterReaderBody');
        if (title) title.textContent = chapter.title || `Chương ${safeChapterIndex + 1}`;
        if (body) body.textContent = text || (chapter.level === 'container' ? 'Mục này không có nội dung riêng. Chọn một chương con trong mục lục.' : 'Chương này không có nội dung.');
        const partialNote = byId('chapterReaderPartialNote');
        const isLastLeaf = state.snapshot.partial
            && chapter.level !== 'container'
            && !state.chapters.slice(safeChapterIndex + 1).some(item => item.level !== 'container');
        if (partialNote) partialNote.hidden = !isLastLeaf;
        updateReaderNavigation();
        renderTocWindow();
        scrollActiveChapterIntoView();
        byId('chapterReaderContent')?.scrollTo?.({ top: 0, behavior: 'auto' });
    }

    function applyIndexResult(result) {
        const cloned = cloneIndexResult(result);
        state.chapters = cloned.chapters;
        state.suggestions = cloned.suggestions;
        const warning = byId('chapterReaderWarning');
        if (warning) {
            warning.hidden = !cloned.warning;
            warning.textContent = cloned.warning;
        }
        rebuildDisplayRows();
    }

    async function openReader(kind, options = {}) {
        const token = ++state.loadToken;
        const hadReadableState = Boolean(state.snapshot && state.chapters.length > 0);
        state.kind = kind === 'source' ? 'source' : 'translated';
        showReaderShell();
        setReaderActionsEnabled(false);
        setReaderStatus('Đang tạo snapshot an toàn…', { busy: true, progress: 0.02 });
        byId('chapterReaderLoading').hidden = false;
        byId('chapterReaderLayout').hidden = true;
        byId('chapterReaderStale').hidden = true;

        try {
            const snapshotApi = global.TranslatorChapterSnapshot;
            if (!snapshotApi) throw new Error('Bộ tạo snapshot chương chưa sẵn sàng.');
            const snapshot = state.kind === 'source'
                ? await snapshotApi.createCurrentSourceSnapshot()
                : await snapshotApi.createCurrentTranslatedSnapshot();
            if (token !== state.loadToken) return;
            if (!snapshot?.blob || snapshot.blob.size === 0) {
                throw new Error(state.kind === 'source'
                    ? 'Chưa có nội dung TXT để chia chương.'
                    : 'Chưa có chunk đã dịch liên tục để đọc.');
            }
            let result = options.force ? null : getCache(snapshot);
            if (!result) {
                result = await runChapterWorker('scan', { blob: snapshot.blob }, message => {
                    setReaderStatus(message.detail || 'Đang nhận diện mục lục…', {
                        busy: true,
                        progress: message.progress,
                    });
                });
                setCache(snapshot, result);
            }
            if (token !== state.loadToken) return;
            state.snapshot = snapshot;
            updateReaderMetadata(snapshot, options.metadata);
            applyIndexResult(result);
            state.activeChapterIndex = 0;
            state.editMode = false;
            state.showSuggestions = false;
            state.searchMatches = [];
            byId('chapterReaderEditPanel').hidden = true;
            byId('toggleChapterSuggestionsWrap').hidden = true;
            byId('toggleChapterEditBtn').setAttribute('aria-pressed', 'false');
            const suggestionsToggle = byId('toggleChapterSuggestionsWrap').querySelector('input');
            if (suggestionsToggle) suggestionsToggle.checked = false;
            byId('chapterHeadingMatches').replaceChildren();
            byId('chapterReaderLoading').hidden = true;
            byId('chapterReaderLayout').hidden = false;
            await renderActiveChapter(0, 0);
            setReaderActionsEnabled(true);
            startStaleWatcher();
            setReaderStatus(
                snapshot.partial ? 'Đang đọc snapshot bản tạm bất biến.' : 'Mục lục đã sẵn sàng.',
                { tone: snapshot.partial ? 'warning' : 'success' },
            );
        } catch (error) {
            if (token !== state.loadToken) return;
            byId('chapterReaderLoading').hidden = true;
            if (hadReadableState) {
                byId('chapterReaderLayout').hidden = false;
                setReaderActionsEnabled(true);
            }
            if (error?.name === 'AbortError') return;
            console.error('[ChapterReader] Open failed:', error);
            setReaderStatus(error?.message || 'Không thể mở trình đọc theo chương.', { tone: 'error' });
            if (typeof global.showToast === 'function') global.showToast(error?.message || 'Không thể mở trình đọc theo chương.', 'error');
        }
    }

    function localRebuildChapterIndex(boundaries, blobSize) {
        const sorted = boundaries
            .map(item => ({ ...item }))
            .sort((left, right) => Number(left.headingByteStart) - Number(right.headingByteStart));
        sorted.forEach((item, index) => {
            item.byteEnd = index + 1 < sorted.length ? Number(sorted[index + 1].headingByteStart) : Number(blobSize);
            item.parentIndex = null;
        });
        for (let index = 0; index < sorted.length; index += 1) {
            if (sorted[index].level !== 'container') continue;
            let hasChild = false;
            for (let child = index + 1; child < sorted.length && sorted[child].level !== 'container'; child += 1) {
                sorted[child].parentIndex = index;
                hasChild = true;
            }
            if (!hasChild) sorted[index].level = 'leaf';
        }
        return sorted;
    }

    function rebuildEditedIndex() {
        const indexer = global.TranslatorChapterIndexer;
        const rebuilt = typeof indexer?.rebuildChapterIndex === 'function'
            ? indexer.rebuildChapterIndex(state.chapters, state.snapshot.blob.size)
            : localRebuildChapterIndex(state.chapters, state.snapshot.blob.size);
        state.chapters = Array.isArray(rebuilt?.chapters) ? rebuilt.chapters : rebuilt;
        state.activeChapterIndex = Math.max(0, Math.min(state.activeChapterIndex, state.chapters.length - 1));
        rebuildDisplayRows();
    }

    function closeChapterReader() {
        state.loadToken += 1;
        state.renderToken += 1;
        terminateActiveWorker();
        if (state.tocRenderFrame && global.cancelAnimationFrame) global.cancelAnimationFrame(state.tocRenderFrame);
        state.tocRenderFrame = 0;
        if (state.staleTimer) global.clearInterval(state.staleTimer);
        state.staleTimer = null;
        const reader = byId('chapterReader');
        if (reader) reader.hidden = true;
        global.document.body.classList.remove('chapter-reader-open');
        const body = byId('chapterReaderBody');
        if (body) body.textContent = '';
        state.snapshot = null;
        state.chapters = [];
        state.suggestions = [];
        state.searchMatches = [];
        const focusTarget = state.previousFocus;
        state.previousFocus = null;
        focusTarget?.focus?.();
    }

    function resetChapterFeature() {
        closeChapterReader();
        state.sourceCache = null;
        state.outputCache = null;
    }

    function cancelChapterTask() {
        if (!state.activeWorker) return;
        terminateActiveWorker('Đã hủy tác vụ chương.');
        setReaderStatus('Đã hủy tác vụ. Nội dung hiện tại vẫn được giữ nguyên.', { tone: 'warning' });
    }

    function selectReaderChapter(chapterIndex) {
        renderActiveChapter(chapterIndex, 0).catch(error => {
            setReaderStatus(error.message || 'Không thể đọc chương này.', { tone: 'error' });
        });
        const shell = byId('chapterReader');
        shell?.classList.remove('toc-open');
    }

    function changeReaderChapter(delta) {
        selectReaderChapter(state.activeChapterIndex + (Number(delta) || 0));
    }

    function changeReaderPage(delta) {
        renderActiveChapter(state.activeChapterIndex, state.activePageIndex + (Number(delta) || 0)).catch(error => {
            setReaderStatus(error.message || 'Không thể chuyển trang.', { tone: 'error' });
        });
    }

    function toggleChapterToc() {
        byId('chapterReader')?.classList.toggle('toc-open');
    }

    function toggleChapterEditMode() {
        state.editMode = !state.editMode;
        const panel = byId('chapterReaderEditPanel');
        const suggestions = byId('toggleChapterSuggestionsWrap');
        const button = byId('toggleChapterEditBtn');
        if (panel) panel.hidden = !state.editMode;
        if (suggestions) suggestions.hidden = !state.editMode || state.suggestions.length === 0;
        if (button) button.setAttribute('aria-pressed', String(state.editMode));
        if (!state.editMode) state.showSuggestions = false;
        rebuildDisplayRows();
    }

    function toggleChapterSuggestions(enabled) {
        state.showSuggestions = Boolean(enabled);
        rebuildDisplayRows();
    }

    function removeChapterBoundary(chapterIndex) {
        const index = Math.trunc(Number(chapterIndex));
        if (!state.editMode || index <= 0 || index >= state.chapters.length) return;
        state.chapters.splice(index, 1);
        state.activeChapterIndex = Math.max(0, index - 1);
        rebuildEditedIndex();
        renderActiveChapter(state.activeChapterIndex, 0);
        setReaderStatus('Đã bỏ mốc; nội dung được gộp vào mục trước.', { tone: 'success' });
    }

    function enableSuggestedChapterBoundary(suggestionIndex) {
        const index = Math.trunc(Number(suggestionIndex));
        const suggestion = state.suggestions[index];
        if (!state.editMode || !suggestion) return;
        state.suggestions.splice(index, 1);
        state.chapters.push({ ...suggestion, confidence: 'suggested' });
        rebuildEditedIndex();
        const nextIndex = state.chapters.findIndex(item => Number(item.headingByteStart) === Number(suggestion.headingByteStart));
        renderActiveChapter(Math.max(0, nextIndex), 0);
        setReaderStatus('Đã bật mốc gợi ý.', { tone: 'success' });
    }

    function renderHeadingMatches(matches) {
        const container = byId('chapterHeadingMatches');
        if (!container) return;
        container.replaceChildren();
        if (matches.length === 0) {
            const empty = global.document.createElement('p');
            empty.className = 'chapter-heading-empty';
            empty.textContent = 'Không tìm thấy dòng tiêu đề trùng khớp.';
            container.appendChild(empty);
            return;
        }
        const fragment = global.document.createDocumentFragment();
        matches.forEach((match, index) => {
            const button = global.document.createElement('button');
            button.type = 'button';
            button.className = 'chapter-heading-match';
            button.dataset.clickAction = 'addChapterBoundary';
            button.dataset.matchIndex = String(index);
            const strong = global.document.createElement('strong');
            strong.textContent = match.title || match.line || 'Tiêu đề';
            const preview = global.document.createElement('span');
            preview.textContent = match.preview || '';
            button.append(strong, preview);
            fragment.appendChild(button);
        });
        container.appendChild(fragment);
    }

    async function findChapterHeading() {
        const query = String(byId('chapterHeadingQuery')?.value || '').trim();
        if (!query || !state.snapshot) return;
        setReaderStatus('Đang tìm dòng tiêu đề…', { busy: true, progress: 0 });
        try {
            const result = await runChapterWorker('findHeading', {
                blob: state.snapshot.blob,
                query,
            }, message => setReaderStatus(message.detail, { busy: true, progress: message.progress }));
            state.searchMatches = Array.isArray(result?.matches) ? result.matches.slice(0, 12) : (Array.isArray(result) ? result.slice(0, 12) : []);
            renderHeadingMatches(state.searchMatches);
            setReaderStatus(`Tìm thấy ${state.searchMatches.length} vị trí.`, { tone: state.searchMatches.length ? 'success' : 'warning' });
        } catch (error) {
            if (error?.name === 'AbortError') return;
            setReaderStatus(error.message || 'Không thể tìm dòng tiêu đề.', { tone: 'error' });
        }
    }

    function addChapterBoundary(matchIndex) {
        const match = state.searchMatches[Math.trunc(Number(matchIndex))];
        if (!match || !state.editMode) return;
        const duplicateIndex = state.chapters.findIndex(
            item => Number(item.headingByteStart) === Number(match.headingByteStart)
        );
        if (duplicateIndex >= 0) {
            if (duplicateIndex === 0 && isSyntheticFallbackChapter(state.chapters[0], state.chapters.length)) {
                state.chapters.splice(0, 1);
            } else {
                setReaderStatus('Vị trí này đã là một mốc chương.', { tone: 'warning' });
                return;
            }
        }
        const parsed = global.TranslatorChapterRules?.parseChapterHeading?.(match.title || match.line || '') || {};
        state.chapters.push({
            title: match.title || match.line || 'Mốc thủ công',
            ordinal: parsed.ordinal ?? null,
            family: parsed.family || 'manual',
            level: parsed.level || 'leaf',
            headingByteStart: Number(match.headingByteStart) || 0,
            contentByteStart: Number(match.contentByteStart) || Number(match.byteEnd) || 0,
            byteEnd: Number(match.byteEnd) || state.snapshot.blob.size,
            confidence: 'manual',
            parentIndex: null,
        });
        rebuildEditedIndex();
        state.searchMatches = [];
        renderHeadingMatches([]);
        const chapterIndex = state.chapters.findIndex(item => Number(item.headingByteStart) === Number(match.headingByteStart));
        renderActiveChapter(Math.max(0, chapterIndex), 0);
        setReaderStatus('Đã thêm mốc thủ công.', { tone: 'success' });
    }

    function downloadEpubBytes(bytes, fileName) {
        const blob = new Blob([bytes], { type: 'application/epub+zip' });
        const url = global.URL.createObjectURL(blob);
        const anchor = global.document.createElement('a');
        anchor.href = url;
        anchor.download = fileName || 'truyen.epub';
        global.document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        global.setTimeout(() => global.URL.revokeObjectURL(url), 1000);
    }

    async function exportChapterEpub() {
        if (!state.snapshot || state.chapters.length === 0) return;
        const button = byId('exportChapterEpubBtn');
        if (button) button.disabled = true;
        setReaderStatus('Đang chuẩn bị EPUB…', { busy: true, progress: 0 });
        try {
            const result = await runChapterWorker('exportEpub', {
                payload: {
                    snapshot: state.snapshot,
                    chapters: state.chapters,
                    title: String(byId('chapterBookTitle')?.value || '').trim() || defaultBookTitle(state.snapshot.fileName),
                    author: String(byId('chapterBookAuthor')?.value || '').trim(),
                    modified: new Date().toISOString(),
                },
            }, message => setReaderStatus(message.detail, { busy: true, progress: message.progress }));
            if (!result?.bytes) throw new Error('EPUB được tạo nhưng không có dữ liệu tải xuống.');
            downloadEpubBytes(result.bytes, result.fileName);
            setReaderStatus('Đã tạo EPUB. Hãy thử nhập file vào ứng dụng đọc của Anh Đạt.', { tone: 'success' });
        } catch (error) {
            if (error?.name === 'AbortError') return;
            console.error('[ChapterReader] EPUB export failed:', error);
            const message = `${error?.message || 'Không thể tạo EPUB.'} Dữ liệu gốc vẫn an toàn; hãy thử file nhỏ hơn hoặc tải TXT.`;
            setReaderStatus(message, { tone: 'error' });
            if (typeof global.showToast === 'function') global.showToast(message, 'error');
        } finally {
            if (button) button.disabled = false;
        }
    }

    function refreshChapterReader() {
        if (!state.snapshot) return;
        openReader(state.kind, {
            force: true,
            metadata: {
                title: String(byId('chapterBookTitle')?.value || ''),
                author: String(byId('chapterBookAuthor')?.value || ''),
            },
        });
    }

    function trapReaderFocus(event) {
        if (!isReaderOpen()) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            closeChapterReader();
            return;
        }
        if (event.key !== 'Tab') return;
        const reader = byId('chapterReader');
        const focusable = Array.from(reader.querySelectorAll(
            'button:not([disabled]):not([hidden]), input:not([disabled]):not([hidden]), [tabindex]:not([tabindex="-1"])'
        )).filter(element => element.offsetParent !== null);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && global.document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && global.document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    function initChapterFeature() {
        byId('chapterTocViewport')?.addEventListener('scroll', scheduleTocRender, { passive: true });
        byId('originalText')?.addEventListener('input', () => {
            state.sourceCache = null;
        }, { passive: true });
        global.document.addEventListener('keydown', trapReaderFocus);
    }

    const api = Object.freeze({
        addChapterBoundary,
        cancelChapterTask,
        changeReaderChapter,
        changeReaderPage,
        close: closeChapterReader,
        enableSuggestedChapterBoundary,
        exportEpub: exportChapterEpub,
        findChapterHeading,
        openPartial: () => openReader('translated'),
        openResult: () => openReader('translated'),
        openSource: () => openReader('source'),
        refresh: refreshChapterReader,
        removeChapterBoundary,
        reset: resetChapterFeature,
        selectChapter: selectReaderChapter,
        toggleEditMode: toggleChapterEditMode,
        toggleSuggestions: toggleChapterSuggestions,
        toggleToc: toggleChapterToc,
    });
    global.TranslatorChapterFeature = api;
    initChapterFeature();
})(typeof globalThis !== 'undefined' ? globalThis : self);
