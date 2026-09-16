import type { ContexteProcedure } from "../../lib/lrpgn/lrpgn";

// Rendu des données certaines de la procédure (issues du XML LRPGN), affichées
// à part de la proposition rédigée par l'IA : ici rien n'est généré, tout est lu.
// Composant pur : aucun accès au store.

const carte: React.CSSProperties = {
  border: "1px solid var(--c--globals--colors--gray-300, #ddd)",
  borderRadius: 4,
  padding: "12px 14px",
  marginBottom: 16,
  background: "var(--c--globals--colors--gray-050, #f6f6f6)",
};

const titreBloc: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  margin: "0 0 4px",
  color: "#000091",
};

const ligne: React.CSSProperties = { margin: "0 0 2px", fontSize: 13, color: "#3a3a44" };

const roleStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "1px 6px",
  borderRadius: 3,
  background: "#e3e3fd",
  color: "#000091",
  fontSize: 12,
  fontWeight: 700,
};

// Assemble les fragments non vides avec le séparateur donné : un fragment
// absent ne laisse ni séparateur orphelin ni espace parasite. Motif unique
// pour toutes les lignes composées du composant — voir joindre / joindreTirets.
function assembler(separateur: string, ...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(separateur);
}

const joindre = (...parts: (string | false | undefined)[]) => assembler(" ", ...parts);
const joindreTirets = (...parts: (string | false | undefined)[]) => assembler(" — ", ...parts);

// Phrase de naissance : gère les trois combinaisons date/lieu sans laisser
// « né(e) » sans complément, ni le lieu orphelin de son introducteur.
function naissanceTexte(date: string, lieu: string): string {
  if (date && lieu) return `né(e) le ${date} à ${lieu}`;
  if (date) return `né(e) le ${date}`;
  if (lieu) return `né(e) à ${lieu}`;
  return "";
}

// Période d'un fait : « du » suppose une fin possible, « au » seul suppose un
// début. On explicite la préposition selon les bornes réellement connues.
function periodeTexte(debut: string, fin: string): string {
  if (debut && fin) return `du ${debut} au ${fin}`;
  if (debut) return `à partir du ${debut}`;
  if (fin) return `jusqu'au ${fin}`;
  return "";
}

// Lieu d'un fait : la commune (et son code postal) ne doit pas hériter de la
// virgule prévue pour suivre une localisation absente.
function lieuTexte(localisation: string, commune: string, codePostal: string): string {
  const ville = joindre(commune, codePostal && `(${codePostal})`);
  if (localisation && ville) return `${localisation}, ${ville}`;
  return localisation || ville;
}

// Référence de la procédure : compose numéro / année (slash seulement si les
// deux sont présents) et unité (tiret seulement si numéro ou année la
// précèdent). Aucune ponctuation orpheline si un champ est absent.
function refProcedureTexte(numero: string, annee: string, unite: string): string {
  const base = [numero && `Procédure ${numero}`, annee].filter(Boolean).join(" / ");
  return joindreTirets(base, unite);
}

export default function ContexteFiche({ contexte }: { contexte: ContexteProcedure }) {
  const { personnes, faits, procedure, enqueteurs } = contexte;
  const refProcedure = refProcedureTexte(procedure.numero, procedure.annee, procedure.unite);
  const typeEtDate = joindreTirets(procedure.typeEnquete, procedure.dateActe);

  // Pour chaque bloc à liste, les lignes rendables sont calculées avant le
  // rendu : le titre du bloc suit la présence effective de contenu, pas la
  // longueur du tableau (une entrée peut se réduire à null une fois vidée).
  const lignesPersonnes = personnes.map((p, i) => {
    const identite = joindre(p.nom, p.prenom);
    const details = joindreTirets(naissanceTexte(p.naissanceDate, p.naissanceLieu), p.nationalite);
    if (!identite && !p.implication && !details) return null;
    return (
      <p key={i} style={ligne}>
        {identite}
        {identite && p.implication && " "}
        {p.implication && <span style={roleStyle}>{p.implication}</span>}
        {details && (identite || p.implication) && " — "}
        {details}
      </p>
    );
  });

  const lignesFaits = faits.map((f, i) => {
    const titre = joindre(f.libelle, f.natinf && `(natinf ${f.natinf})`);
    const periode = periodeTexte(f.debut, f.fin);
    const lieu = lieuTexte(f.localisation, f.commune, f.codePostal);
    const contenu = joindreTirets(titre, periode, lieu);
    if (!contenu) return null;
    return (
      <p key={i} style={ligne}>
        {contenu}
      </p>
    );
  });

  const lignesEnqueteurs = enqueteurs.map((e, i) => {
    const texte = joindreTirets(e.nom, e.qualite);
    if (!texte) return null;
    return (
      <p key={i} style={ligne}>
        {texte}
      </p>
    );
  });

  return (
    <section style={carte} aria-label="Contexte de la procédure">
      {lignesPersonnes.some(Boolean) && (
        <div style={{ marginBottom: 10 }}>
          <p style={titreBloc}>Personne entendue</p>
          {lignesPersonnes}
        </div>
      )}

      {lignesFaits.some(Boolean) && (
        <div style={{ marginBottom: 10 }}>
          <p style={titreBloc}>Faits</p>
          {lignesFaits}
        </div>
      )}

      <div>
        {(refProcedure || typeEtDate) && (
          <>
            <p style={titreBloc}>Procédure</p>
            {refProcedure && <p style={ligne}>{refProcedure}</p>}
            {typeEtDate && <p style={ligne}>{typeEtDate}</p>}
          </>
        )}
        {lignesEnqueteurs.some(Boolean) && (
          <>
            <p style={{ ...titreBloc, marginTop: 8 }}>Enquêteur</p>
            {lignesEnqueteurs}
          </>
        )}
      </div>
    </section>
  );
}
