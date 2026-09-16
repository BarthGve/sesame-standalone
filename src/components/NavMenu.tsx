// Menu de navigation (contenu du left panel du MainLayout ui-kit).
// Placeholder : les pages viendront ensuite.
const ITEMS: { label: string; active: boolean }[] = [
  { label: "Carte", active: true },
  { label: "Statistiques", active: false },
  { label: "À propos", active: false },
];

export default function NavMenu() {
  return (
    <nav aria-label="Navigation" style={{ padding: 8 }}>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        {ITEMS.map((it) => (
          <li key={it.label}>
            <a
              href="#"
              aria-current={it.active ? "page" : undefined}
              onClick={(e) => { if (!it.active) e.preventDefault(); }}
              style={{
                display: "block",
                padding: "10px 12px",
                borderRadius: 4,
                textDecoration: "none",
                fontWeight: it.active ? 700 : 400,
                color: it.active ? "#000091" : "var(--c--globals--colors--gray-700, #45474A)",
                background: it.active ? "var(--c--globals--colors--brand-050, #EDF0FF)" : "transparent",
                borderLeft: it.active ? "3px solid #000091" : "3px solid transparent",
                cursor: it.active ? "default" : "not-allowed",
                opacity: it.active ? 1 : 0.6,
              }}
            >
              {it.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
