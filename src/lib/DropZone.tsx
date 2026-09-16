import { useRef, useState } from "react";

// Zone de dépôt générique : glisser-déposer OU clic pour parcourir. Filtre selon `accept`
// (extensions .xxx et/ou types MIME, jokers `image/*` compris) et la taille (`maxBytes`).
// `multiple` gère le lot ou la pièce unique. La zone affiche `files` (état porté par le
// parent, donc persistant hors composant) avec un bouton « retirer » par pièce ; c'est le
// parent qui décide de cumuler ou de remplacer dans son `onFiles`.

function tailleLisible(o: number): string {
  if (o >= 1024 * 1024) return `${(o / (1024 * 1024)).toFixed(1)} Mo`;
  if (o >= 1024) return `${Math.round(o / 1024)} Ko`;
  return `${o} o`;
}

// Un fichier est retenu s'il satisfait AU MOINS un jeton d'`accept` : extension (".pdf"),
// type MIME exact ("application/pdf") ou joker ("image/*").
function matcheAccept(f: File, accept: string): boolean {
  const toks = accept.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (!toks.length) return true;
  const nom = f.name.toLowerCase();
  const type = (f.type || "").toLowerCase();
  return toks.some((t) => {
    if (t.startsWith(".")) return nom.endsWith(t);
    if (t.endsWith("/*")) return type.startsWith(t.slice(0, -1));
    return type === t;
  });
}

export default function DropZone({
  onFiles, files, onRemove, accept, maxBytes, quoi, hint, multiple = false, disabled = false,
}: {
  onFiles: (files: File[]) => void;
  files: File[];
  onRemove: (index: number) => void;
  accept: string;
  maxBytes: number;
  quoi: string; // ex. « les pièces PDF de la procédure », « vos notes de terrain »
  hint: string; // ligne de contraintes, ex. « PDF uniquement · 20 Mo max »
  multiple?: boolean;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  // Ne retient que les fichiers conformes (type + taille) ; le reste est écarté silencieusement.
  function retenir(liste: FileList | File[]) {
    const ok = Array.from(liste).filter((f) => matcheAccept(f, accept) && f.size <= maxBytes);
    const retenus = multiple ? ok : ok.slice(0, 1);
    if (retenus.length) onFiles(retenus);
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    retenir(e.target.files ?? []);
    e.target.value = ""; // permet de re-sélectionner le même fichier après un retrait
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    retenir(e.dataTransfer.files);
  }

  function ouvrir() {
    if (!disabled) inputRef.current?.click();
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={`Déposer ${quoi}, ou cliquer pour parcourir`}
        aria-disabled={disabled}
        onClick={ouvrir}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ouvrir(); } }}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }}
        onDragEnter={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8,
          padding: "28px 20px", borderRadius: 10, textAlign: "center",
          border: `2px dashed ${dragging ? "#000091" : "#c5c5d3"}`,
          background: disabled ? "#f5f5f7" : dragging ? "#ececff" : "#fafafb",
          color: disabled ? "#9a9aa5" : "#3a3a3a",
          cursor: disabled ? "not-allowed" : "pointer", transition: "background .15s, border-color .15s",
        }}
      >
        <span className="material-icons" aria-hidden style={{ fontSize: 34, color: disabled ? "#b5b5be" : "#000091" }}>cloud_upload</span>
        <span style={{ fontSize: 14 }}>
          <strong>Glissez-déposez</strong> {quoi} ici, ou <span style={{ color: "#000091", textDecoration: "underline" }}>cliquez pour parcourir</span>
        </span>
        <span style={{ fontSize: 12, color: "#8a8a99" }}>{hint}</span>
        <input ref={inputRef} type="file" multiple={multiple} accept={accept} onChange={onChange} disabled={disabled}
          style={{ display: "none" }} aria-hidden tabIndex={-1} />
      </div>

      {files.length > 0 && (
        <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {files.map((f, i) => (
            <li key={`${f.name}-${f.size}-${i}`}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", background: "#fff", border: "1px solid #e5e5e5", borderRadius: 6, fontSize: 13 }}>
              <span className="material-icons" aria-hidden style={{ fontSize: 18, color: "#000091" }}>description</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
              <span style={{ color: "#8a8a99", flexShrink: 0 }}>{tailleLisible(f.size)}</span>
              <button type="button" onClick={() => onRemove(i)} disabled={disabled} aria-label={`Retirer ${f.name}`}
                style={{ border: "none", background: "none", cursor: disabled ? "not-allowed" : "pointer", color: "#5b5b6b", display: "flex", flexShrink: 0 }}>
                <span className="material-icons" aria-hidden style={{ fontSize: 18 }}>close</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
