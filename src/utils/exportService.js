import { Document, Packer, Paragraph, HeadingLevel, TextRun } from 'docx';
import { saveAs } from 'file-saver';
import db from '../services/db/database';

// Helper: Chuyển đổi HTML của Tiptap thành văn bản thô
function stripHtmlToText(html) {
    if (!html) return '';
    // Tạo element ảo để trình duyệt tự parse HTML
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    // Thay thế các thẻ <p> bằng khoảng trắng/dấu xuống dòng nếu cần,
    // nhưng innerText thường tự lo phần này khá tốt.
    // Tuy nhiên, để an toàn và giữ khoảng cách đoạn (paragraph)
    const paragraphs = html.split(/<\/p>/i);
    const textArray = paragraphs.map(p => {
        tempDiv.innerHTML = p;
        return tempDiv.textContent || tempDiv.innerText || '';
    }).filter(text => text.trim().length > 0);

    return textArray.join('\n\n');
}

const CHAPTER_HEADING_PATTERN = /^(?:#{1,6}\s*)?(?:chương|chuong|chapter)\s+([0-9]+|[ivxlcdm]+)\s*(?:(?:[:.\-\u2013\u2014])\s*(.*))?$/iu;

function cleanHeadingLine(value) {
    return String(value || '').trim().replace(/^#{1,6}\s*/, '').trim();
}

function normalizeChapterNumber(value) {
    const numberText = String(value || '').trim();
    if (/^\d+$/.test(numberText)) {
        return String(Number(numberText));
    }
    return numberText.toLowerCase();
}

function parseChapterHeading(value) {
    const line = cleanHeadingLine(value);
    const match = line.match(CHAPTER_HEADING_PATTERN);
    if (!match) return null;

    const numberText = normalizeChapterNumber(match[1]);
    let subtitle = String(match[2] || '').trim();

    while (subtitle) {
        const nested = parseChapterHeading(subtitle);
        if (!nested || nested.numberText !== numberText) break;
        subtitle = nested.subtitle;
    }

    return { numberText, subtitle };
}

function buildChapterHeadingText(parsedHeading) {
    if (!parsedHeading) return '';
    const prefix = `Chương ${parsedHeading.numberText}`;
    return parsedHeading.subtitle ? `${prefix}: ${parsedHeading.subtitle}` : prefix;
}

function normalizeHeadingForCompare(value) {
    const parsed = parseChapterHeading(value);
    const heading = parsed ? buildChapterHeadingText(parsed) : cleanHeadingLine(value);
    return heading.toLocaleLowerCase('vi-VN').replace(/\s+/g, ' ').trim();
}

function headingsMatch(left, right) {
    return normalizeHeadingForCompare(left) === normalizeHeadingForCompare(right);
}

export function extractLeadingChapterHeading(text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    const firstLine = lines.find(line => line.trim().length > 0);
    const parsed = parseChapterHeading(firstLine || '');
    return parsed ? buildChapterHeadingText(parsed) : '';
}

export function formatChapterExportTitle(chapterTitle, arrayIndex, leadingContentHeading = '') {
    const title = cleanHeadingLine(chapterTitle);
    const titleHeading = parseChapterHeading(title);
    const contentHeading = parseChapterHeading(leadingContentHeading);

    if (titleHeading) {
        if (
            !titleHeading.subtitle
            && contentHeading?.subtitle
            && contentHeading.numberText === titleHeading.numberText
        ) {
            return buildChapterHeadingText(contentHeading);
        }
        return buildChapterHeadingText(titleHeading);
    }

    if (!title && contentHeading) {
        return buildChapterHeadingText(contentHeading);
    }

    const fallbackPrefix = `Chương ${arrayIndex + 1}`;
    return title ? `${fallbackPrefix}: ${title}` : fallbackPrefix;
}

export function stripLeadingDuplicateChapterHeading(text, chapterHeading) {
    const value = String(text || '');
    const lines = value.replace(/\r\n/g, '\n').split('\n');
    const firstContentLineIndex = lines.findIndex(line => line.trim().length > 0);

    if (firstContentLineIndex === -1) return '';
    if (!headingsMatch(lines[firstContentLineIndex], chapterHeading)) return value;

    lines.splice(firstContentLineIndex, 1);
    return lines.join('\n').replace(/^\s+/, '');
}

export function buildChapterExportSection(section, arrayIndex) {
    const rawSceneTexts = (section.scenes || [])
        .map(sceneHtml => stripHtmlToText(sceneHtml))
        .filter(text => text.trim().length > 0);
    const leadingContentHeading = rawSceneTexts
        .map(text => extractLeadingChapterHeading(text))
        .find(Boolean) || '';
    const chapterHeading = formatChapterExportTitle(
        section.chapterTitle,
        arrayIndex,
        leadingContentHeading
    );
    const sceneTexts = rawSceneTexts
        .map(text => stripLeadingDuplicateChapterHeading(text, chapterHeading).trim())
        .filter(Boolean);

    return { chapterHeading, sceneTexts };
}

// Lấy toàn bộ dữ liệu truyện theo ID
async function getProjectData(projectId) {
    const project = await db.projects.get(projectId);
    if (!project) throw new Error('Không tìm thấy dự án');

    const chapters = await db.chapters
        .where('project_id').equals(projectId)
        .sortBy('order_index');

    const sections = [];

    for (const chapter of chapters) {
        const scenes = await db.scenes
            .where('chapter_id').equals(chapter.id)
            .sortBy('order_index');

        sections.push({
            chapterTitle: chapter.title || '',
            scenes: scenes.map(s => s.draft_text || '')
        });
    }

    return { project, sections };
}

/**
 * Xuất file TXT
 */
export async function exportToTxt(projectId) {
    const { project, sections } = await getProjectData(projectId);

    let content = `${project.title || 'Truyện Không Tên'}\n`;
    content += `=\n\n`;

    sections.forEach((sec, idx) => {
        const { chapterHeading, sceneTexts } = buildChapterExportSection(sec, idx);

        content += `${chapterHeading}\n`;
        content += `-\n\n`;

        sceneTexts.forEach(text => {
            content += text + '\n\n';
        });

        content += `\n\n`;
    });

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    saveAs(blob, `${project.title || 'Export'}-storyforge.txt`);
}

/**
 * Xuất file DOCX
 */
export async function exportToDocx(projectId) {
    const { project, sections } = await getProjectData(projectId);

    const docChildren = [];

    // Tên truyện (Tiêu đề lớn)
    docChildren.push(
        new Paragraph({
            text: project.title || 'Truyện Không Tên',
            heading: HeadingLevel.TITLE,
            spacing: { after: 400 }
        })
    );

    sections.forEach((sec, idx) => {
        const { chapterHeading, sceneTexts } = buildChapterExportSection(sec, idx);

        // Tên chương
        docChildren.push(
            new Paragraph({
                text: chapterHeading,
                heading: HeadingLevel.HEADING_1,
                spacing: { before: 400, after: 200 }
            })
        );

        // Nội dung các cảnh
        sceneTexts.forEach(sceneText => {
            const paragraphs = sceneText.split(/\n{2,}/);
            paragraphs.forEach(p => {
                const text = p.trim();

                if (text) {
                    docChildren.push(
                        new Paragraph({
                            children: [new TextRun(text)],
                            spacing: { after: 200 }
                        })
                    );
                }
            });
        });
    });

    const doc = new Document({
        sections: [{
            properties: {},
            children: docChildren
        }]
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, `${project.title || 'Export'}-storyforge.docx`);
}
