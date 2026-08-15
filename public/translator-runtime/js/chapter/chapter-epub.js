(function initializeTranslatorChapterEpub(global) {
    'use strict';

    const EPUB_MIME = 'application/epub+zip';
    const LANGUAGE = 'vi';
    const XML_ESCAPES = Object.freeze({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
    });

    function stripInvalidXmlCharacters(value) {
        const input = String(value == null ? '' : value);
        return input
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
            .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
            .replace(/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '$1');
    }

    function escapeXml(value) {
        return stripInvalidXmlCharacters(value)
            .replace(/[&<>"']/g, character => XML_ESCAPES[character]);
    }

    function normalizeLineEndings(value) {
        return String(value == null ? '' : value).replace(/\r\n?/g, '\n');
    }

    function textBody(value) {
        const normalized = normalizeLineEndings(value).replace(/^\uFEFF/, '');
        if (!normalized) {
            return '<p></p>';
        }
        return `<p>${escapeXml(normalized).replace(/\n/g, '<br />\n')}</p>`;
    }

    function finiteOffset(value, fallback, maximum) {
        const number = Number(value);
        if (!Number.isFinite(number)) {
            return fallback;
        }
        return Math.max(0, Math.min(maximum, Math.trunc(number)));
    }

    async function readBlobRange(blob, start, end) {
        const safeStart = finiteOffset(start, 0, blob.size);
        const safeEnd = Math.max(safeStart, finiteOffset(end, blob.size, blob.size));
        return blob.slice(safeStart, safeEnd).text();
    }

    function defaultTitleFromFile(fileName) {
        const name = String(fileName || '').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '').trim();
        return name || 'Truyện';
    }

    function sanitizeFileName(value) {
        const safe = stripInvalidXmlCharacters(value)
            .replace(/[<>:"/\\|?*]/g, '')
            .replace(/[\u0000-\u001F\u007F]/g, '')
            .replace(/\s+/g, ' ')
            .replace(/[. ]+$/g, '')
            .trim()
            .slice(0, 180);
        return safe || 'truyen';
    }

    function normalizeModified(value) {
        const parsed = value ? new Date(value) : new Date();
        const safeDate = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
        return safeDate.toISOString().replace(/\.\d{3}Z$/, 'Z');
    }

    function makeIdentifier(title, snapshot, modified) {
        const input = `${title}\u0000${snapshot.fileName || ''}\u0000${snapshot.blob.size}\u0000${modified}`;
        let hash = 0x811C9DC5;
        for (let index = 0; index < input.length; index += 1) {
            hash ^= input.charCodeAt(index);
            hash = Math.imul(hash, 0x01000193);
        }
        return `urn:storyforge:${(hash >>> 0).toString(16).padStart(8, '0')}`;
    }

    function isFrontMatterChapter(chapter, index, chapterCount) {
        if (!chapter || index !== 0 || chapterCount <= 1) {
            return false;
        }
        if (chapter.family === 'frontmatter' || chapter.level === 'frontmatter') {
            return true;
        }
        const startsAtBeginning = Number(chapter.headingByteStart) === 0
            && Number(chapter.contentByteStart) === 0;
        return startsAtBeginning && /^(mở đầu|lời mở đầu|front matter)$/iu.test(String(chapter.title || '').trim());
    }

    function prepareStructure(rawChapters, blobSize) {
        const source = Array.isArray(rawChapters) ? rawChapters : [];
        let frontMatter = null;
        const rows = source.map((chapter, sourceIndex) => ({
            ...chapter,
            sourceIndex,
            title: String(chapter && chapter.title || '').trim() || `Chương ${sourceIndex + 1}`,
            headingByteStart: finiteOffset(chapter && chapter.headingByteStart, 0, blobSize),
            contentByteStart: finiteOffset(chapter && chapter.contentByteStart, 0, blobSize),
            byteEnd: finiteOffset(chapter && chapter.byteEnd, blobSize, blobSize),
        }));

        if (rows.length && isFrontMatterChapter(rows[0], 0, rows.length)) {
            frontMatter = rows.shift();
        } else if (rows.length && rows[0].headingByteStart > 0) {
            frontMatter = {
                title: 'Mở đầu',
                sourceIndex: -1,
                headingByteStart: 0,
                contentByteStart: 0,
                byteEnd: rows[0].headingByteStart,
            };
        }

        if (!rows.length) {
            rows.push({
                title: 'Nội dung',
                family: 'content',
                level: 'leaf',
                parentIndex: null,
                sourceIndex: 0,
                headingByteStart: 0,
                contentByteStart: 0,
                byteEnd: blobSize,
            });
            frontMatter = null;
        }

        const childCount = new Map();
        for (const row of rows) {
            if (row.level === 'leaf' && Number.isInteger(row.parentIndex)) {
                childCount.set(row.parentIndex, (childCount.get(row.parentIndex) || 0) + 1);
            }
        }

        const leaves = [];
        for (const row of rows) {
            const hasChildren = row.level === 'container' && (childCount.get(row.sourceIndex) || 0) > 0;
            if (row.level !== 'container' || !hasChildren) {
                leaves.push({ ...row, level: 'leaf' });
            }
        }

        const leafBySourceIndex = new Map();
        leaves.forEach((leaf, index) => {
            leaf.outputIndex = index;
            leaf.href = `Text/chapter-${String(index + 1).padStart(6, '0')}.xhtml`;
            leaf.id = `chapter-${String(index + 1).padStart(6, '0')}`;
            leafBySourceIndex.set(leaf.sourceIndex, leaf);
        });

        const containers = new Map();
        for (const row of rows) {
            if (row.level !== 'container') {
                continue;
            }
            const children = leaves.filter(leaf => leaf.parentIndex === row.sourceIndex);
            if (children.length) {
                containers.set(row.sourceIndex, { ...row, children });
            }
        }

        const navigation = [];
        for (const row of rows) {
            const container = containers.get(row.sourceIndex);
            if (container) {
                navigation.push({
                    title: container.title,
                    href: container.children[0].href,
                    sourceIndex: container.sourceIndex,
                    children: container.children,
                });
                continue;
            }
            const leaf = leafBySourceIndex.get(row.sourceIndex);
            if (!leaf || containers.has(leaf.parentIndex)) {
                continue;
            }
            navigation.push({ title: leaf.title, href: leaf.href, leaf, children: [] });
        }

        return { frontMatter, rows, leaves, containers, navigation };
    }

    function buildXhtml(title, body, options) {
        const extraClass = options && options.extraClass ? ` class="${escapeXml(options.extraClass)}"` : '';
        const note = options && options.incomplete
            ? '<aside class="notice" role="note">Chương cuối của bản tạm có thể chưa hoàn tất.</aside>'
            : '';
        const introduction = options && options.introduction
            ? `<section class="part-introduction"><h2>${escapeXml(options.introduction.title)}</h2>${textBody(options.introduction.content)}</section>`
            : '';

        return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${LANGUAGE}" lang="${LANGUAGE}">
  <head>
    <meta charset="utf-8" />
    <title>${escapeXml(title)}</title>
    <link rel="stylesheet" type="text/css" href="../Styles/book.css" />
  </head>
  <body${extraClass}>
    <main>
      <h1>${escapeXml(title)}</h1>
      ${note}
      ${introduction}
      ${textBody(body)}
    </main>
  </body>
</html>`;
    }

    function buildFrontMatterXhtml(frontMatterText, snapshot) {
        const partialInfo = snapshot.partial
            ? `<section class="notice" role="note">
      <h2>Bản tạm</h2>
      <p>Đã xuất ${escapeXml(snapshot.completedChunks)} / ${escapeXml(snapshot.totalChunks)} chunk liên tục. Nội dung cuối có thể chưa hoàn tất.</p>
    </section>`
            : '';
        const content = frontMatterText ? textBody(frontMatterText) : '';

        return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${LANGUAGE}" lang="${LANGUAGE}">
  <head>
    <meta charset="utf-8" />
    <title>Mở đầu</title>
    <link rel="stylesheet" type="text/css" href="../Styles/book.css" />
  </head>
  <body>
    <main>
      <h1>Mở đầu</h1>
      ${partialInfo}
      ${content}
    </main>
  </body>
</html>`;
    }

    function buildNavXhtml(title, navigation, hasFrontMatter) {
        const frontMatterItem = hasFrontMatter
            ? '<li><a href="Text/front-matter.xhtml">Mở đầu</a></li>'
            : '';
        const items = navigation.map(item => {
            if (!item.children.length) {
                return `<li><a href="${escapeXml(item.href)}">${escapeXml(item.title)}</a></li>`;
            }
            const children = item.children
                .map(child => `<li><a href="${escapeXml(child.href)}">${escapeXml(child.title)}</a></li>`)
                .join('');
            return `<li><a href="${escapeXml(item.href)}">${escapeXml(item.title)}</a><ol>${children}</ol></li>`;
        }).join('');

        return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${LANGUAGE}" lang="${LANGUAGE}">
  <head>
    <meta charset="utf-8" />
    <title>Mục lục</title>
    <link rel="stylesheet" type="text/css" href="Styles/book.css" />
  </head>
  <body>
    <nav epub:type="toc" id="toc" role="doc-toc">
      <h1>${escapeXml(title)}</h1>
      <ol>${frontMatterItem}${items}</ol>
    </nav>
  </body>
</html>`;
    }

    function buildNcx(title, author, identifier, navigation, hasFrontMatter) {
        let playOrder = 1;
        const points = [];
        if (hasFrontMatter) {
            points.push(`<navPoint id="front-matter" playOrder="${playOrder++}"><navLabel><text>Mở đầu</text></navLabel><content src="Text/front-matter.xhtml"/></navPoint>`);
        }
        for (const item of navigation) {
            if (!item.children.length) {
                points.push(`<navPoint id="nav-${playOrder}" playOrder="${playOrder++}"><navLabel><text>${escapeXml(item.title)}</text></navLabel><content src="${escapeXml(item.href)}"/></navPoint>`);
                continue;
            }
            const containerOrder = playOrder++;
            const children = item.children.map(child => {
                const childOrder = playOrder++;
                return `<navPoint id="nav-${childOrder}" playOrder="${childOrder}"><navLabel><text>${escapeXml(child.title)}</text></navLabel><content src="${escapeXml(child.href)}"/></navPoint>`;
            }).join('');
            points.push(`<navPoint id="nav-${containerOrder}" playOrder="${containerOrder}"><navLabel><text>${escapeXml(item.title)}</text></navLabel><content src="${escapeXml(item.href)}"/>${children}</navPoint>`);
        }

        return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${escapeXml(identifier)}"/>
    <meta name="dtb:depth" content="2"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  ${author ? `<docAuthor><text>${escapeXml(author)}</text></docAuthor>` : ''}
  <navMap>${points.join('')}</navMap>
</ncx>`;
    }

    function buildOpf(title, author, identifier, modified, leaves, hasFrontMatter) {
        const frontManifest = hasFrontMatter
            ? '<item id="front-matter" href="Text/front-matter.xhtml" media-type="application/xhtml+xml"/>'
            : '';
        const frontSpine = hasFrontMatter ? '<itemref idref="front-matter"/>' : '';
        const chapterManifest = leaves
            .map(leaf => `<item id="${leaf.id}" href="${leaf.href}" media-type="application/xhtml+xml"/>`)
            .join('');
        const chapterSpine = leaves.map(leaf => `<itemref idref="${leaf.id}"/>`).join('');
        const startHref = hasFrontMatter ? 'Text/front-matter.xhtml' : leaves[0].href;

        return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="3.0" xml:lang="${LANGUAGE}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/">
    <dc:identifier id="bookid">${escapeXml(identifier)}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:language>${LANGUAGE}</dc:language>
    ${author ? `<dc:creator>${escapeXml(author)}</dc:creator>` : ''}
    <meta property="dcterms:modified">${escapeXml(modified)}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="Styles/book.css" media-type="text/css"/>
    ${frontManifest}
    ${chapterManifest}
  </manifest>
  <spine toc="ncx">
    ${frontSpine}
    ${chapterSpine}
  </spine>
  <guide>
    <reference type="toc" title="Mục lục" href="nav.xhtml"/>
    <reference type="text" title="Bắt đầu" href="${escapeXml(startHref)}"/>
  </guide>
</package>`;
    }

    function reportProgress(callback, completed, total) {
        if (typeof callback === 'function') {
            callback({ phase: 'exportEpub', completed, total });
        }
    }

    async function buildChapterEpub(input, dependencies) {
        const snapshot = input && input.snapshot;
        const JSZip = dependencies && dependencies.JSZip;
        const onProgress = dependencies && dependencies.onProgress;
        if (!snapshot || !snapshot.blob || typeof snapshot.blob.slice !== 'function') {
            throw new TypeError('Snapshot EPUB không có Blob hợp lệ.');
        }
        if (typeof JSZip !== 'function') {
            throw new TypeError('Thiếu JSZip để đóng gói EPUB.');
        }

        const structure = prepareStructure(input.chapters, snapshot.blob.size);
        const baseTitle = stripInvalidXmlCharacters(String(input.title || '').trim())
            || defaultTitleFromFile(snapshot.fileName);
        const bookTitle = snapshot.partial ? `${baseTitle} – Bản tạm` : baseTitle;
        const author = stripInvalidXmlCharacters(String(input.author || '').trim());
        const modified = normalizeModified(input.modified);
        const identifier = makeIdentifier(bookTitle, snapshot, modified);
        const hasFrontMatter = Boolean(structure.frontMatter || snapshot.partial);
        const totalReads = structure.leaves.length
            + structure.containers.size
            + (structure.frontMatter ? 1 : 0);
        let completedReads = 0;

        let frontMatterText = '';
        if (structure.frontMatter) {
            frontMatterText = await readBlobRange(
                snapshot.blob,
                structure.frontMatter.contentByteStart,
                structure.frontMatter.byteEnd,
            );
            reportProgress(onProgress, ++completedReads, totalReads);
        }

        const zip = new JSZip();
        zip.file('mimetype', EPUB_MIME, { compression: 'STORE' });
        zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);
        zip.file('OEBPS/Styles/book.css', `body { line-height: 1.6; margin: 1em; }
h1, h2 { line-height: 1.3; }
p { margin: 0 0 1em; }
.notice { border: 1px solid currentColor; padding: 0.75em; margin-bottom: 1em; }
ol { padding-inline-start: 1.5em; }`);

        if (hasFrontMatter) {
            zip.file(
                'OEBPS/Text/front-matter.xhtml',
                buildFrontMatterXhtml(frontMatterText, snapshot),
            );
            frontMatterText = '';
        }

        for (let index = 0; index < structure.leaves.length; index += 1) {
            const leaf = structure.leaves[index];
            const parent = structure.containers.get(leaf.parentIndex);
            const isFirstChild = parent && parent.children[0].sourceIndex === leaf.sourceIndex;
            const introductionText = isFirstChild
                ? await readBlobRange(snapshot.blob, parent.contentByteStart, parent.byteEnd)
                : '';
            if (isFirstChild) reportProgress(onProgress, ++completedReads, totalReads);
            const introduction = introductionText && introductionText.trim()
                ? { title: parent.title, content: introductionText }
                : null;
            const leafText = await readBlobRange(snapshot.blob, leaf.contentByteStart, leaf.byteEnd);
            reportProgress(onProgress, ++completedReads, totalReads);
            zip.file(
                `OEBPS/${leaf.href}`,
                buildXhtml(leaf.title, leafText, {
                    introduction,
                    incomplete: Boolean(snapshot.partial && index === structure.leaves.length - 1),
                }),
            );
        }

        zip.file('OEBPS/nav.xhtml', buildNavXhtml(bookTitle, structure.navigation, hasFrontMatter));
        zip.file('OEBPS/toc.ncx', buildNcx(bookTitle, author, identifier, structure.navigation, hasFrontMatter));
        zip.file(
            'OEBPS/content.opf',
            buildOpf(bookTitle, author, identifier, modified, structure.leaves, hasFrontMatter),
        );

        const generated = await zip.generateAsync({
            type: 'uint8array',
            mimeType: EPUB_MIME,
            compression: 'DEFLATE',
            compressionOptions: { level: 3 },
            streamFiles: true,
        });
        const bytes = generated instanceof Uint8Array ? generated : new Uint8Array(generated);
        const partialSuffix = snapshot.partial ? ' Bản tạm' : '';
        reportProgress(onProgress, totalReads, totalReads);
        return {
            bytes,
            fileName: `${sanitizeFileName(baseTitle)}${partialSuffix}.epub`,
        };
    }

    global.TranslatorChapterEpub = Object.freeze({
        buildChapterEpub,
        escapeXml,
        stripInvalidXmlCharacters,
    });
})(typeof self !== 'undefined' ? self : globalThis);
