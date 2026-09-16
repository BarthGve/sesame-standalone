import type { Dossier, Partie, Role } from "./arianeApi";
import { groupByRole, ROLE_LABEL_SINGULIER, ROLE_COLORS } from "./graph";
import { formatCote } from "./cotes";
import { formatDateFr } from "./dates";

// Fiches des parties. La hierarchie suit ce que l'enqueteur cherche : d'abord QUI,
// puis son etat civil, et seulement ensuite OU le retrouver dans le dossier. Les
// cotes sont donc des reperes discrets, pas le premier element lu.

// `qualite` est du texte libre produit par le modele : il y ecrit les dates au
// format ISO. On les remet au format francais a l'affichage, comme partout ailleurs.
const datesEnFrancais = (texte: string) =>
  texte.replace(/\d{4}-\d{2}-\d{2}/g, (iso) => formatDateFr(iso));

// Un role, les cotes ou la personne le porte. Deux mentions du meme role sur deux
// pieces donnaient « Mis en cause en A · Mis en cause en B » : on groupe.
function rolesGroupes(p: Partie): { role: Role; cotes: string[] }[] {
  if (!p.roles?.length) return [{ role: p.role, cotes: [p.premiere_cote] }];
  const par = new Map<Role, string[]>();
  for (const r of p.roles) {
    const cotes = par.get(r.role) ?? [];
    if (!cotes.includes(r.cote)) cotes.push(r.cote);
    par.set(r.role, cotes);
  }
  return [...par.entries()].map(([role, cotes]) => ({ role, cotes }));
}

function Cote({ cote }: { cote: string }) {
  const { date, libelle } = formatCote(cote);
  return (
    <span
      title={cote}
      style={{
        display: "inline-flex", alignItems: "baseline", gap: 5,
        padding: "2px 7px", borderRadius: 4, fontSize: 11, lineHeight: 1.6,
        background: "#f4f4f8", color: "#4a4a58", whiteSpace: "nowrap",
        maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis",
      }}
    >
      {date && <span style={{ color: "#8a8a99", fontVariantNumeric: "tabular-nums" }}>{date}</span>}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{libelle}</span>
    </span>
  );
}

export default function PartiesView({ dossier }: { dossier: Dossier }) {
  const groups = groupByRole(dossier.parties);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      {groups.map((g) => (
        <section key={g.role}>
          <h3 style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, margin: "0 0 10px" }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: g.color, display: "inline-block" }} aria-hidden />
            {g.label} <span style={{ color: "#929292", fontWeight: 400 }}>({g.parties.length})</span>
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(268px, 1fr))", gap: 12 }}>
            {g.parties.map((p) => {
              const groupes = rolesGroupes(p);
              return (
                // Le liseré porte la couleur du rôle : l'appartenance se lit sur la
                // fiche elle-même, sans la répéter en toutes lettres.
                <article key={p.id} style={{
                  border: "1px solid #e5e5e5", borderLeft: `3px solid ${g.color}`,
                  borderRadius: 6, padding: "11px 13px",
                }}>
                  <div style={{ fontWeight: 600, fontSize: 15, lineHeight: 1.3 }}>{p.nom}</div>

                  {p.qualite && (
                    <div style={{ fontSize: 12.5, color: "#5b5b6b", marginTop: 3, lineHeight: 1.45 }}>
                      {datesEnFrancais(p.qualite)}
                    </div>
                  )}

                  {(p.aliases?.length ?? 0) > 0 && (
                    <div style={{ fontSize: 12, color: "#9a9aa6", marginTop: 5, lineHeight: 1.45 }}>
                      alias : {p.aliases!.join(", ")}
                    </div>
                  )}

                  <div style={{ marginTop: 9, display: "flex", flexDirection: "column", gap: 5 }}>
                    {groupes.map(({ role, cotes }) => (
                      <div key={role} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
                        {/* Le rôle n'est nommé que s'il diffère de celui du groupe :
                            sinon l'en-tête de section le dit déjà. */}
                        {groupes.length > 1 && (
                          <span style={{ fontSize: 11, fontWeight: 600, color: ROLE_COLORS[role] }}>
                            {ROLE_LABEL_SINGULIER[role]}
                          </span>
                        )}
                        {cotes.map((c) => <Cote key={c} cote={c} />)}
                      </div>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
