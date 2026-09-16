// Découpage du lot et composition du payload transmis au workflow.
//
// LISTE BLANCHE, pas liste noire : on énumère les champs autorisés au lieu d'essayer
// de retirer les indésirables. C'est ce qui garantit que le marqueur de vérité terrain
// `defaut:<code>` — et tout champ ajouté plus tard — ne peut pas fuiter dans le prompt.
// Un agent qui lit la réponse ne mesure plus rien.

// Exactement ce qu'une FRS porte : ses métadonnées et son texte. Ni motif, ni date
// d'événement, ni origine de l'information — ces champs n'existent pas à la saisie, les
// transmettre reviendrait à faire contrôler du vide.
export const CHAMPS_FRAGMENT = [
  'id', 'date_redaction', 'titre', 'unite', 'code_ggd', 'commune', 'texte', 'porte_pii',
];

export const TAILLE_DEFAUT = 40;

export function decouper(fiches, taille) {
  const t = Number.isInteger(taille) && taille > 0 ? taille : TAILLE_DEFAUT;
  const out = [];
  for (let i = 0; i < fiches.length; i += t) out.push(fiches.slice(i, i + t));
  return out;
}

export function composerFragment(rang, fiches) {
  return {
    fragment: rang,
    fiches: fiches.map((f) => {
      const o = {};
      for (const c of CHAMPS_FRAGMENT) o[c] = f[c] ?? null;
      return o;
    }),
  };
}
