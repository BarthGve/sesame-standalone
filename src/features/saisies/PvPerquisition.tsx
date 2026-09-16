import { Button } from "@gouvfr-lasuite/cunningham-react";
import type { PerquisitionDetail } from "./perquisitionApi";
import { formatPvDate, objetEntete, objetChamps, groupByLieu, PLACEHOLDER } from "./pv";

export default function PvPerquisition({
  perquisition,
  onClose,
}: {
  perquisition: PerquisitionDetail;
  onClose: () => void;
}) {
  const p = perquisition;
  const date = formatPvDate(p.date_debut);
  const fin = formatPvDate(p.date_fin);
  const [unite, numero, annee] = (p.una || "").split("/");
  const perq = p.perquisitionne || PLACEHOLDER;
  const intervenants = (p.intervenants && p.intervenants.length ? p.intervenants.join(", ") : PLACEHOLDER);
  const pieces = (p.pieces && p.pieces.length ? p.pieces.join(", ") : PLACEHOLDER);
  const groupes = groupByLieu(p.objets || []);

  const legal: React.CSSProperties = { margin: "8px 0" }; // tout le texte en noir (couleur héritée #16161d)

  return (
    <div>
      <style>{`
        @media print {
          /* n'imprimer que le PV, quelle que soit sa place dans la page (sidebar, en-tête… masqués) */
          body * { visibility: hidden !important; }
          .pv-page, .pv-page * { visibility: visible !important; }
          .pv-page { position: absolute; left: 0; top: 0; width: auto !important; margin: 0 !important; box-shadow: none !important; }
          .pv-toolbar { display: none !important; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      <div className="pv-toolbar" style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <Button type="button" variant="secondary" onClick={onClose}>← Retour</Button>
        <Button type="button" onClick={() => window.print()}>Imprimer</Button>
      </div>

      <div className="pv-page" style={{ width: 794, maxWidth: "100%", margin: "20px auto", background: "#fff", padding: "48px 56px", boxShadow: "0 2px 12px rgba(0,0,0,.15)", fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 13, lineHeight: 1.5, color: "#16161d" }}>
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>GENDARMERIE NATIONALE</div>
          <div style={{ marginTop: 6 }}>Unité {unite || PLACEHOLDER}</div>
          <div style={{ marginTop: 10, fontStyle: "italic" }}>ENQUÊTE PRÉLIMINAIRE</div>
          <h1 style={{ fontSize: 18, margin: "16px 0 0" }}>PROCÈS-VERBAL DE PERQUISITION</h1>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", margin: "16px 0", fontSize: 12 }}>
          <tbody>
            <tr>
              {["Code unité", "Nmr P.V.", "Année", "Nmr dossier justice", "N° feuillet"].map((h) => (
                <th key={h} style={{ border: "1px solid #999", padding: "4px 6px", background: "#f6f6f6", textAlign: "left" }}>{h}</th>
              ))}
            </tr>
            <tr>
              {[unite || PLACEHOLDER, numero || PLACEHOLDER, annee || PLACEHOLDER, PLACEHOLDER, PLACEHOLDER].map((v, i) => (
                <td key={i} style={{ border: "1px solid #999", padding: "4px 6px" }}>{v}</td>
              ))}
            </tr>
          </tbody>
        </table>

        <p style={legal}>Le {date.longue} à {date.heure}.</p>
        <p style={legal}>Nous soussigné {p.opj || PLACEHOLDER}, Officier de Police Judiciaire en résidence à {PLACEHOLDER}.</p>
        <p style={legal}>Vu les articles 16 à 19 et 75 à 78 du Code de Procédure Pénale.</p>
        <p style={legal}>Nous trouvant au bureau de notre unité à {PLACEHOLDER}, rapportons les opérations suivantes :</p>

        <p style={legal}>Le {date.longue} à {date.heure}, nous nous présentons pour y effectuer une perquisition au domicile de {perq}, {p.adresse || PLACEHOLDER} à {p.commune_libelle || PLACEHOLDER} (Insee : {PLACEHOLDER}), qui nous paraît détenir des pièces ou objets relatifs aux faits incriminés.</p>
        <p style={legal}>Nous sommes assistés par : {intervenants}, de notre unité.</p>
        <p style={legal}>Nous sommes accompagnés par {perq}.</p>
        <p style={legal}>L'assentiment exprès autorisant la perquisition et les saisies a été préalablement sollicité, rédigé et joint à la présente pièce.</p>
        <p style={legal}>En la présence constante de {perq}, nous procédons à la perquisition des pièces suivantes : {pieces}</p>
        <p style={legal}>Dans les lieux ci-après, nous découvrons la pièce à conviction suivante :</p>

        {groupes.map((g) => (
          <div key={g.lieu} style={{ margin: "10px 0" }}>
            <div style={{ fontWeight: 700 }}>- Lieu : {g.lieu}</div>
            <div>- Pièce à conviction :</div>
            {g.objets.map((o) => (
              <div key={o.id} style={{ margin: "8px 0", border: "1px solid #ccc", borderRadius: 4, overflow: "hidden", breakInside: "avoid" }}>
                <div style={{ fontWeight: 700, background: "#f2f2f2", padding: "4px 10px", borderBottom: "1px solid #ddd" }}>
                  {objetEntete(o)}{o.numero_scelle ? ` · Scellé : ${o.numero_scelle}` : ""}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 20px", padding: "6px 10px" }}>
                  {objetChamps(o).map((c, k) => (
                    <div key={k}><span style={{ fontWeight: 600 }}>{c.libelle} :</span> {c.valeur}</div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}

        <p style={legal}>Nous déclarons à {perq} saisie de cette pièce à conviction.</p>
        <p style={legal}>Nous en portons mention sur l'inventaire des pièces à conviction et la plaçons sous scellé que paraphe avec nous {perq}.</p>
        <p style={legal}>L'objet saisi sera mis à la disposition du magistrat compétent en même temps que les pièces de la procédure.</p>
        <p style={legal}>Nos recherches au domicile de {perq} n'amènent la découverte d'aucun autre objet susceptible de servir à la manifestation de la vérité.</p>
        <p style={legal}>Nous informons la personne présente, qu'elle pourra, conformément à l'article 77-2 du code de procédure pénale, à l'expiration d'un délai d'un an à compter de la présente perquisition effectuée à son domicile, demander au procureur de la République, par lettre recommandée avec accusé de réception ou par déclaration au greffe contre récépissé, de consulter le dossier de la procédure.</p>
        <p style={legal}>La perquisition se termine le {fin.courte} à {fin.heure}.</p>
      </div>
    </div>
  );
}
