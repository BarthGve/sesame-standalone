import { useEffect, useReducer, useRef } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

type ToolBtn = {
  icon: string;
  label: string;
  run: (e: Editor) => void;
  actif?: (e: Editor) => boolean;
};

const GROUPES: ToolBtn[][] = [
  [
    { icon: "format_bold", label: "Gras", run: (e) => e.chain().focus().toggleBold().run(), actif: (e) => e.isActive("bold") },
    { icon: "format_italic", label: "Italique", run: (e) => e.chain().focus().toggleItalic().run(), actif: (e) => e.isActive("italic") },
    { icon: "format_underlined", label: "Souligné", run: (e) => e.chain().focus().toggleUnderline().run(), actif: (e) => e.isActive("underline") },
  ],
  [
    { icon: "title", label: "Titre", run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(), actif: (e) => e.isActive("heading", { level: 2 }) },
    { icon: "text_fields", label: "Sous-titre", run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(), actif: (e) => e.isActive("heading", { level: 3 }) },
  ],
  [
    { icon: "format_list_bulleted", label: "Liste à puces", run: (e) => e.chain().focus().toggleBulletList().run(), actif: (e) => e.isActive("bulletList") },
    { icon: "format_list_numbered", label: "Liste numérotée", run: (e) => e.chain().focus().toggleOrderedList().run(), actif: (e) => e.isActive("orderedList") },
  ],
  [
    { icon: "undo", label: "Annuler", run: (e) => e.chain().focus().undo().run() },
    { icon: "redo", label: "Rétablir", run: (e) => e.chain().focus().redo().run() },
  ],
];

export default function PropositionEditor({
  html,
  onChange,
}: {
  html: string;
  onChange: (html: string) => void;
}) {
  const [, force] = useReducer((n) => n + 1, 0);
  // Dernier HTML synchronisé, pour distinguer une mise à jour venue du store
  // (résultat d'analyse) d'un écho d'une édition locale → évite les boucles.
  const lastHtml = useRef(html);

  const editor = useEditor({
    extensions: [StarterKit],
    content: html,
    editable: true,
    onUpdate: ({ editor }) => {
      const h = editor.getHTML();
      lastHtml.current = h;
      onChange(h);
    },
  });

  // Reflète les états actifs de la barre d'outils sur sélection / transaction.
  useEffect(() => {
    if (!editor) return;
    const rerender = () => force();
    editor.on("transaction", rerender);
    return () => {
      editor.off("transaction", rerender);
    };
  }, [editor]);

  // Applique un changement provenant du store (nouveau résultat, vidage) sans
  // réémettre d'update (garde-fou lastHtml pour ne pas réinjecter nos propres
  // éditions ni déplacer le curseur).
  useEffect(() => {
    if (!editor) return;
    if (html !== lastHtml.current) {
      lastHtml.current = html;
      editor.commands.setContent(html, { emitUpdate: false });
    }
  }, [editor, html]);

  return (
    <div>
      <div
        role="toolbar"
        aria-label="Mise en forme"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          flexWrap: "wrap",
          padding: "6px 8px",
          borderBottom: "1px solid var(--c--globals--colors--gray-300, #ddd)",
          background: "var(--c--globals--colors--gray-050, #f6f6f6)",
        }}
      >
        {GROUPES.map((groupe, gi) => (
          <div key={gi} style={{ display: "flex", gap: 2, alignItems: "center" }}>
            {gi > 0 && (
              <span style={{ width: 1, height: 20, background: "var(--c--globals--colors--gray-300, #ddd)", margin: "0 4px" }} aria-hidden />
            )}
            {groupe.map((b) => {
              const actif = editor ? b.actif?.(editor) ?? false : false;
              return (
                <button
                  key={b.icon}
                  type="button"
                  title={b.label}
                  aria-label={b.label}
                  aria-pressed={actif}
                  disabled={!editor}
                  onClick={() => editor && b.run(editor)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 32,
                    height: 32,
                    borderRadius: 6,
                    border: "1px solid transparent",
                    background: actif ? "var(--c--globals--colors--brand-050, #ececff)" : "transparent",
                    color: actif ? "#000091" : "inherit",
                    cursor: editor ? "pointer" : "default",
                  }}
                >
                  <span className="material-icons" aria-hidden style={{ fontSize: 18 }}>
                    {b.icon}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <EditorContent editor={editor} className="proposition-editor" />
    </div>
  );
}
