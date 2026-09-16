// Les PDF d'audition produits par LRPGN embarquent un `data.xml` (données
// structurées de la procédure) dans un flux PDF `/Type/EmbeddedFile` compressé
// deflate. On le récupère sans dépendance : recherche sur les octets +
// DecompressionStream natif.
//
// Best-effort de bout en bout : PDF chiffré, flux non-deflate, XML inattendu →
// null. L'appelant continue sans contexte, l'analyse n'est jamais bloquée.

const MARQUEUR = "/Type/EmbeddedFile";

function chercher(octets: Uint8Array<ArrayBuffer>, motif: string, depuis: number): number {
  const cible = new TextEncoder().encode(motif);
  boucle: for (let i = depuis; i <= octets.length - cible.length; i++) {
    for (let j = 0; j < cible.length; j++) if (octets[i + j] !== cible[j]) continue boucle;
    return i;
  }
  return -1;
}

// Un octet qui peut faire partie d'un nom/mot PDF (lettres, chiffres, `-`,
// `_`) : sert à détecter que « stream » n'est que la fin d'un mot plus long,
// comme dans `/Subtype/application#2foctet-stream`.
function estCaractereDeNom(octet: number): boolean {
  return (
    (octet >= 0x30 && octet <= 0x39) || // 0-9
    (octet >= 0x41 && octet <= 0x5a) || // A-Z
    (octet >= 0x61 && octet <= 0x7a) || // a-z
    octet === 0x2d || // -
    octet === 0x5f // _
  );
}

// Repère le mot-clé PDF `stream` qui ouvre effectivement un flux, à partir de
// `depuis`. Dans un vrai PDF, la valeur d'une clé de dictionnaire peut contenir
// la sous-chaîne « stream » (ex. `/Subtype/application#2foctet-stream`) : une
// recherche d'octets naïve tombe alors dedans, à l'intérieur du dictionnaire,
// avant le vrai mot-clé. On ne retient donc que les occurrences qui respectent
// la syntaxe du mot-clé lui-même :
// - non précédées d'un caractère de nom PDF (lettre, chiffre, `-`, `_`), pour
//   exclure une fin de mot comme `octet-stream` ;
// - immédiatement suivies d'un saut de ligne (`\r`, `\n` ou `\r\n`), comme
//   l'exige la spécification PDF pour le mot-clé `stream`.
function chercherMotCleStream(octets: Uint8Array<ArrayBuffer>, depuis: number): number {
  let position = depuis;
  for (;;) {
    const trouve = chercher(octets, "stream", position);
    if (trouve < 0) return -1;
    const precedeParNom = trouve > 0 && estCaractereDeNom(octets[trouve - 1]);
    const suivant = octets[trouve + "stream".length];
    const suiviDunSautDeLigne = suivant === 0x0d || suivant === 0x0a;
    if (!precedeParNom && suiviDunSautDeLigne) return trouve;
    position = trouve + 1;
  }
}

async function decompresser(octets: Uint8Array<ArrayBuffer>): Promise<string> {
  const flux = new Blob([octets]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Response(flux).text();
}

export async function extraireXmlPdf(file: File): Promise<string | null> {
  try {
    const octets = new Uint8Array<ArrayBuffer>(await file.arrayBuffer());
    let curseur = 0;
    for (;;) {
      const marque = chercher(octets, MARQUEUR, curseur);
      if (marque < 0) return null;
      const motStream = chercherMotCleStream(octets, marque);
      if (motStream < 0) {
        // Pas de mot-clé `stream` valide après ce marqueur : occurrence
        // fortuite de `/Type/EmbeddedFile` ou objet mal formé. On tente la
        // pièce jointe suivante plutôt que d'abandonner toute l'extraction.
        curseur = marque + 1;
        continue;
      }
      let debut = motStream + "stream".length;
      if (octets[debut] === 0x0d) debut++;
      if (octets[debut] === 0x0a) debut++;
      const fin = chercher(octets, "endstream", debut);
      if (fin < 0) {
        curseur = marque + 1;
        continue;
      }
      curseur = fin;
      // Le saut de ligne qui précède `endstream` appartient au PDF, pas au flux.
      let borne = fin;
      while (borne > debut && (octets[borne - 1] === 0x0a || octets[borne - 1] === 0x0d)) borne--;
      try {
        const texte = await decompresser(octets.subarray(debut, borne));
        if (texte.includes("<Procedure")) return texte;
      } catch {
        /* flux illisible : on tente la pièce jointe suivante */
      }
    }
  } catch {
    return null;
  }
}
