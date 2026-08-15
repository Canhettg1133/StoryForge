(function initTranslatorChapterRules(scope) {
    'use strict';

    const SLICE_BYTES = 256 * 1024;
    const MAX_CARRY_BYTES = 1024;
    const MAX_DIAGNOSTICS = 200;
    const MAX_HEADING_TITLE_CHARS = 240;
    const MAX_UNSEPARATED_TITLE_CHARS = 160;
    const MAX_UNSEPARATED_CONTAINER_TITLE_CHARS = 80;
    const MAX_LOWERCASE_CONTAINER_TITLE_CHARS = 40;

    const FAMILY_BY_PREFIX = Object.freeze({
        chương: 'chapter',
        chapter: 'chapter',
        chap: 'chapter',
        ch: 'chapter',
        hồi: 'hoi',
        tiết: 'tiet',
        phần: 'phan',
        part: 'phan',
        quyển: 'quyen',
        tập: 'tap',
    });

    const CONTAINER_FAMILIES = new Set(['phan', 'quyen', 'tap']);
    const VIETNAMESE_DIGITS = Object.freeze({
        không: 0,
        linh: 0,
        lẻ: 0,
        một: 1,
        mốt: 1,
        hai: 2,
        ba: 3,
        bốn: 4,
        tư: 4,
        năm: 5,
        lăm: 5,
        sáu: 6,
        bảy: 7,
        tám: 8,
        chín: 9,
    });
    const SINO_DIGITS = Object.freeze({
        nhất: 1,
        nhị: 2,
        tam: 3,
        tứ: 4,
        ngũ: 5,
        lục: 6,
        thất: 7,
        bát: 8,
        cửu: 9,
    });
    const NUMBER_WORDS = new Set([
        ...Object.keys(VIETNAMESE_DIGITS),
        ...Object.keys(SINO_DIGITS),
        'mười', 'mươi', 'trăm', 'nghìn', 'ngàn', 'thập', 'bách', 'thiên',
    ]);

    function stripLine(line) {
        return String(line == null ? '' : line)
            .replace(/^\uFEFF/, '')
            .trim();
    }

    function normalizeWord(word) {
        return String(word || '').toLocaleLowerCase('vi-VN');
    }

    function romanToInteger(value) {
        const roman = String(value || '').toUpperCase();
        if (!/^(?=[MDCLXVI])M{0,4}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/.test(roman)) {
            return null;
        }
        const values = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
        let total = 0;
        let previous = 0;
        for (let index = roman.length - 1; index >= 0; index -= 1) {
            const current = values[roman[index]];
            total += current < previous ? -current : current;
            previous = current;
        }
        return total || null;
    }

    function parseSinoWords(words) {
        let total = 0;
        let current = 0;
        let sawUnit = false;
        const units = { thập: 10, bách: 100, thiên: 1000 };
        for (const word of words) {
            if (Object.prototype.hasOwnProperty.call(SINO_DIGITS, word)) {
                current = SINO_DIGITS[word];
                continue;
            }
            const unit = units[word];
            if (!unit) return null;
            sawUnit = true;
            total += (current || 1) * unit;
            current = 0;
        }
        if (!sawUnit && words.length !== 1) return null;
        return total + current;
    }

    function parseVietnameseWords(words) {
        let total = 0;
        let section = 0;
        let current = 0;
        let valid = false;
        for (const word of words) {
            if (Object.prototype.hasOwnProperty.call(VIETNAMESE_DIGITS, word)) {
                current = VIETNAMESE_DIGITS[word];
                valid = true;
            } else if (word === 'mười') {
                section += 10;
                current = 0;
                valid = true;
            } else if (word === 'mươi') {
                section += (current || 1) * 10;
                current = 0;
                valid = true;
            } else if (word === 'trăm') {
                section += (current || 1) * 100;
                current = 0;
                valid = true;
            } else if (word === 'nghìn' || word === 'ngàn') {
                total += (section + current || 1) * 1000;
                section = 0;
                current = 0;
                valid = true;
            } else if (word === 'linh' || word === 'lẻ') {
                valid = true;
            } else {
                return null;
            }
        }
        return valid ? total + section + current : null;
    }

    function parseNumberWords(words) {
        if (!words.length) return null;
        const lowered = words.map(normalizeWord);
        const allSino = lowered.every(word => Object.prototype.hasOwnProperty.call(SINO_DIGITS, word)
            || word === 'thập' || word === 'bách' || word === 'thiên');
        return allSino ? parseSinoWords(lowered) : parseVietnameseWords(lowered);
    }

    function parseChineseNumber(value) {
        if (/^\d+$/.test(value)) return Number(value);
        const digits = { '〇': 0, '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
        const units = { '十': 10, '百': 100, '千': 1000, '万': 10000 };
        let total = 0;
        let section = 0;
        let digit = 0;
        let sawUnit = false;
        for (const char of value) {
            if (Object.prototype.hasOwnProperty.call(digits, char)) {
                digit = digits[char];
                continue;
            }
            const unit = units[char];
            if (!unit) return null;
            sawUnit = true;
            if (unit === 10000) {
                section = (section + digit || 1) * unit;
                total += section;
                section = 0;
            } else {
                section += (digit || 1) * unit;
            }
            digit = 0;
        }
        if (!sawUnit) {
            let positional = 0;
            for (const char of value) positional = positional * 10 + digits[char];
            return positional;
        }
        return total + section + digit;
    }

    function parseOrdinalPrefix(value) {
        const input = String(value || '').trimStart();
        let match = input.match(/^(\d{1,7})(?=$|[\s:.,;!?)\]\-–—])/u);
        if (match) return { ordinal: Number(match[1]), consumed: match[1].length };

        match = input.match(/^([IVXLCDM]+)(?=$|[\s:.,;!?)\]\-–—])/u);
        if (match) {
            const ordinal = romanToInteger(match[1]);
            if (ordinal != null) return { ordinal, consumed: match[1].length };
        }

        const wordMatches = [...input.matchAll(/[\p{L}]+/gu)];
        const words = [];
        let consumed = 0;
        for (const wordMatch of wordMatches.slice(0, 8)) {
            if (wordMatch.index !== consumed && input.slice(consumed, wordMatch.index).trim() !== '') break;
            const word = normalizeWord(wordMatch[0]);
            if (!NUMBER_WORDS.has(word)) break;
            words.push(word);
            consumed = wordMatch.index + wordMatch[0].length;
        }
        if (!words.length) return null;
        const ordinal = parseNumberWords(words);
        return ordinal == null ? null : { ordinal, consumed };
    }

    function makeHeading(title, family, ordinal) {
        return {
            title,
            ordinal,
            family,
            level: CONTAINER_FAMILIES.has(family) ? 'container' : 'leaf',
        };
    }

    function parseChapterHeading(line) {
        const title = stripLine(line);
        if (!title || title.length > MAX_CARRY_BYTES) return null;

        let match = title.match(/^第([〇零一二两三四五六七八九十百千万\d]+)(章|回|节)(?:\s*(?:[:：.\-–—])?\s*.*)?$/u);
        if (match) {
            const family = match[2] === '章' ? 'chapter' : (match[2] === '回' ? 'hoi' : 'tiet');
            const ordinal = parseChineseNumber(match[1]);
            return ordinal == null ? null : makeHeading(title, family, ordinal);
        }

        match = title.match(/^Đệ\s+(.+?)\s+(chương|hồi|tiết)(?:\s*(?:[:.\-–—])\s*.*)?$/iu);
        if (match) {
            const parsed = parseOrdinalPrefix(match[1]);
            if (parsed && parsed.consumed === match[1].trim().length) {
                return makeHeading(title, FAMILY_BY_PREFIX[normalizeWord(match[2])], parsed.ordinal);
            }
        }

        match = title.match(/^Thứ\s+(.+?)\s+chương(?:\s+(.*))?$/iu);
        if (match) {
            const parsed = parseOrdinalPrefix(match[1]);
            if (parsed && parsed.consumed === match[1].trim().length) {
                const tail = String(match[2] || '').trim();
                const hasSeparator = /^[:.\-–—]/u.test(tail);
                const trailingTitle = tail.replace(/^[:.\-–—]\s*/u, '');
                const maxTitleLength = hasSeparator
                    ? MAX_HEADING_TITLE_CHARS
                    : MAX_UNSEPARATED_TITLE_CHARS;
                if (trailingTitle.length <= maxTitleLength) {
                    return makeHeading(title, 'chapter', parsed.ordinal);
                }
            }
        }

        match = title.match(/^(Chương|Chapter|Chap|Ch|Hồi|Tiết|Phần|Part|Quyển|Tập)\s+(.+)$/iu);
        if (match) {
            const family = FAMILY_BY_PREFIX[normalizeWord(match[1])];
            const ordinalText = match[2].replace(/^thứ\s+/iu, '');
            const parsed = parseOrdinalPrefix(ordinalText);
            if (parsed) {
                const tail = ordinalText.slice(parsed.consumed).trimStart();
                const hasSeparator = /^[:.\-–—]/u.test(tail);
                const trailingTitle = tail.replace(/^[:.\-–—]\s*/u, '');
                const ordinalToken = ordinalText.slice(0, parsed.consumed).trim();
                const ambiguousContainerOrdinal = CONTAINER_FAMILIES.has(family)
                    && /^(?:không|trăm|nghìn|ngàn|thập|bách|thiên)$/iu.test(ordinalToken);
                if (ambiguousContainerOrdinal) return null;
                const sentenceTail = trailingTitle.replace(/^[,;]\s*/u, '');
                const looksLikeSentence = !hasSeparator
                    && /^(?:là|có|này|đó|được|sẽ|đã|không|chỉ|vốn|trong|còn|is|was|has|will)(?![\p{L}\p{N}_])/iu.test(sentenceTail);
                let maxTitleLength = hasSeparator ? MAX_HEADING_TITLE_CHARS : MAX_UNSEPARATED_TITLE_CHARS;
                if (!hasSeparator && CONTAINER_FAMILIES.has(family)) {
                    const lowercasePrefix = match[1] === match[1].toLocaleLowerCase('vi-VN');
                    maxTitleLength = lowercasePrefix
                        ? MAX_LOWERCASE_CONTAINER_TITLE_CHARS
                        : MAX_UNSEPARATED_CONTAINER_TITLE_CHARS;
                }
                if (!looksLikeSentence && trailingTitle.length <= maxTitleLength) {
                    return makeHeading(title, family, parsed.ordinal);
                }
            }
            return null;
        }

        match = title.match(/^(Ngoại\s+truyện|Prologue|Epilogue|Mở\s+đầu|Lời\s+mở\s+đầu|Hậu\s+ký)(?:\s+(\d{1,7}|[IVXLCDM]+))?(?:\s*(?:[:.\-–—])\s*.*)?$/iu);
        if (match) {
            const ordinal = match[2] ? (Number(match[2]) || romanToInteger(match[2])) : null;
            return makeHeading(title, 'special', ordinal);
        }

        return null;
    }

    function parseBareNumberHeading(line) {
        const title = stripLine(line);
        const match = title.match(/^(\d{1,7})$/u);
        if (!match) return null;
        const ordinal = Number(match[1]);
        return {
            title,
            ordinal,
            family: 'chapter',
            level: 'leaf',
            plausible: ordinal >= 0 && ordinal <= 9999,
        };
    }

    function isTocMarker(line) {
        const normalized = stripLine(line)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/gi, 'd')
            .toLowerCase();
        return /^(muc\s+luc|table\s+of\s+contents|contents)\s*[:：]?$/.test(normalized);
    }

    function mightBeHeadingBytes(bytes) {
        let index = 0;
        while (index < bytes.length
            && (bytes[index] === 9 || bytes[index] === 11 || bytes[index] === 12 || bytes[index] === 32)) index += 1;
        if (index + 2 < bytes.length && bytes[index] === 0xEF && bytes[index + 1] === 0xBB && bytes[index + 2] === 0xBF) index += 3;
        while (index < bytes.length
            && (bytes[index] === 9 || bytes[index] === 11 || bytes[index] === 12 || bytes[index] === 32)) index += 1;
        if (index >= bytes.length) return false;
        const first = bytes[index];
        if (first >= 48 && first <= 57) return true;
        const startsWithDe = first === 0xC4 && (bytes[index + 1] === 0x90 || bytes[index + 1] === 0x91);
        const startsWithChineseOrdinal = first === 0xE7
            && bytes[index + 1] === 0xAC
            && bytes[index + 2] === 0xAC;
        if (startsWithDe || startsWithChineseOrdinal) return true;
        const lower = first >= 65 && first <= 90 ? first + 32 : first;
        return lower === 99 || lower === 104 || lower === 116 || lower === 112
            || lower === 113 || lower === 110 || lower === 109 || lower === 101
            || lower === 108;
    }

    scope.TranslatorChapterRules = Object.freeze({
        SLICE_BYTES,
        MAX_CARRY_BYTES,
        MAX_DIAGNOSTICS,
        parseChapterHeading,
        parseBareNumberHeading,
        parseChineseNumber,
        parseOrdinalPrefix,
        isTocMarker,
        mightBeHeadingBytes,
    });
}(typeof self !== 'undefined' ? self : globalThis));
