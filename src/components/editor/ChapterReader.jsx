import React, { useEffect, useMemo, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { BookOpen } from 'lucide-react';
import { buildChapterReaderModel } from './chapterReaderModel';
import './ChapterReader.css';

export default function ChapterReader({ chapterId, scenes = [] }) {
  const scrollRef = useRef(null);
  const model = useMemo(
    () => buildChapterReaderModel(scenes, chapterId),
    [chapterId, scenes],
  );
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        horizontalRule: {
          HTMLAttributes: { class: 'chapter-reader-divider' },
        },
      }),
    ],
    content: model.html,
    editable: false,
    editorProps: {
      attributes: {
        class: 'story-editor-content chapter-reader-content',
        spellcheck: 'false',
        role: 'document',
        'aria-label': 'Nội dung chương ở chế độ đọc liền',
        'aria-readonly': 'true',
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(false);
    editor.commands.setContent(model.html, false);
  }, [editor, model.html]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [chapterId]);

  return (
    <div className="chapter-reader" ref={scrollRef}>
      <div className="chapter-reader-document">
        {model.readableScenes.length > 0 ? (
          <EditorContent editor={editor} />
        ) : (
          <div className="chapter-reader-empty">
            <BookOpen size={34} />
            <p>Chương này chưa có nội dung để đọc.</p>
          </div>
        )}

        <div className="chapter-reader-end" aria-label="Hết chương">
          Hết chương · {model.totalSceneCount.toLocaleString('vi-VN')} cảnh · {model.wordCount.toLocaleString('vi-VN')} từ
        </div>
      </div>
    </div>
  );
}
