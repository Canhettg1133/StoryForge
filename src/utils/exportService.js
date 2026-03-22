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
            chapterTitle: chapter.title || 'Chương không tên',
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
        content += `Chương ${idx + 1}: ${sec.chapterTitle}\n`;
        content += `-\n\n`;

        sec.scenes.forEach(sceneHtml => {
            const text = stripHtmlToText(sceneHtml);
            if (text) {
                content += text + '\n\n';
            }
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
        // Tên chương
        docChildren.push(
            new Paragraph({
                text: `Chương ${idx + 1}: ${sec.chapterTitle}`,
                heading: HeadingLevel.HEADING_1,
                spacing: { before: 400, after: 200 }
            })
        );

        // Nội dung các cảnh
        sec.scenes.forEach(sceneHtml => {
            if (!sceneHtml) return;

            // Xử lý nới lỏng HTML thành các paragraph riêng biệt
            const paragraphs = sceneHtml.split(/<\/p>/i);
            paragraphs.forEach(p => {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = p;
                const text = (tempDiv.textContent || tempDiv.innerText || '').trim();

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
