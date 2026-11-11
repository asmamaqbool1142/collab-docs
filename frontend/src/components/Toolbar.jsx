const btn = (label, title, isActive, run, disabled) => ({ label, title, isActive, run, disabled });

export default function Toolbar({ editor }) {
  if (!editor) return null;
  const c = () => editor.chain().focus();
  const groups = [
    [
      btn('B', 'Bold (Ctrl+B)', editor.isActive('bold'), () => c().toggleBold().run()),
      btn('I', 'Italic (Ctrl+I)', editor.isActive('italic'), () => c().toggleItalic().run()),
      btn('U', 'Underline (Ctrl+U)', editor.isActive('underline'), () => c().toggleUnderline().run()),
      btn('S', 'Strikethrough', editor.isActive('strike'), () => c().toggleStrike().run()),
    ],
    [
      btn('Text', 'Normal text', editor.isActive('paragraph'), () => c().setParagraph().run()),
      btn('H1', 'Heading 1', editor.isActive('heading', { level: 1 }), () => c().toggleHeading({ level: 1 }).run()),
      btn('H2', 'Heading 2', editor.isActive('heading', { level: 2 }), () => c().toggleHeading({ level: 2 }).run()),
      btn('H3', 'Heading 3', editor.isActive('heading', { level: 3 }), () => c().toggleHeading({ level: 3 }).run()),
    ],
    [
      btn('• List', 'Bulleted list', editor.isActive('bulletList'), () => c().toggleBulletList().run()),
      btn('1. List', 'Numbered list', editor.isActive('orderedList'), () => c().toggleOrderedList().run()),
      btn('❝', 'Quote', editor.isActive('blockquote'), () => c().toggleBlockquote().run()),
    ],
    [
      btn('↶', 'Undo (Ctrl+Z)', false, () => c().undo().run(), !editor.can().undo()),
      btn('↷', 'Redo (Ctrl+Shift+Z)', false, () => c().redo().run(), !editor.can().redo()),
    ],
  ];
  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      {groups.map((g, i) => (
        <div className="toolbar-group" key={i}>
          {g.map((b) => (
            <button key={b.title} type="button" title={b.title} aria-label={b.title} aria-pressed={b.isActive}
              className={b.isActive ? 'tb active' : 'tb'} disabled={b.disabled}
              onMouseDown={(e) => e.preventDefault()} onClick={b.run}>
              <span className={`tb-${b.label}`}>{b.label}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
