# Valoriser le XML LRPGN embarqué dans les PDF d'audition — page Analyse

Date : 2026-07-20
Portée : `src/features/synthese/` (page `/analyse`), `server/synthese.mjs`, `server/proxy.mjs`

## Contexte

Les PDF d'audition produits par LRPGN embarquent une pièce jointe `data.xml`
(flux PDF `/Type/EmbeddedFile`, compressé deflate) contenant les données
structurées de la procédure : enquêteurs, entête, faits (natinf, libellé,
période, lieu, coordonnées GPS), personnes (état civil complet, implication),
rédaction du PV.

Exemple vérifié : `20250221_1445_PVAudition_VIC_BIDULE_MARC.pdf` — 5 125 octets
de XML, racine `<Procedure>`, `Vs_LRPGN v3720313`, attributs applicatifs
(`CASSIOPEE`, `FOVES`, `PULSAR`…) à `PREPRODUCTION`.

Aujourd'hui la page `/analyse` (`SyntheseApp`) envoie la pièce entière au
workflow IAka de synthèse et affiche le markdown produit dans un éditeur. Ces
données certaines ne sont pas exploitées : tout ce que l'analyse affirme est
extrait par le LLM depuis le rendu visuel du PDF.

## Objectifs

1. **Fiche contexte** — afficher à l'écran les données structurées certaines,
   séparées du texte généré, donc non hallucinables.
2. **Ancrage du workflow** — transmettre le XML au workflow IAka pour que
   l'analyse s'appuie sur des identités, rôles, dates et qualifications exacts.

Hors périmètre : passerelle vers les pages carte / ariane (le GPS et les
personnes sont dans le XML, exploitables plus tard), contrôle de cohérence
post-analyse, formats autres que PDF.

## Décisions

- Extraction **côté front**, dès le choix du fichier : la fiche s'affiche avant
  le lancement de l'analyse (qui dure des dizaines de secondes).
- **Aucune dépendance ajoutée** : `DecompressionStream('deflate')` est natif
  navigateur.
- Champs affichés : **essentiel métier** uniquement. Téléphone, adresse
  personnelle, profession, situation familiale, consentement et GPS sont
  extraits du XML mais **non affichés** — inutiles à la relecture et sensibles.
- Absence de XML = cas normal (fichiers jpg/png/docx/odt, PDF non LRPGN) :
  aucune mention, aucune erreur. Présence de XML = badge « Données LRPGN
  détectées ».
- La fiche est du contexte écran : elle n'entre **pas** dans la copie
  presse-papier ni dans l'export PDF, qui restent la proposition rédigée.

## Architecture

| Fichier | Rôle | Dépend de |
|---|---|---|
| `src/features/synthese/pdfXml.ts` | `extraireXmlPdf(file: File): Promise<string \| null>` — scan des octets du PDF, inflate, décodage UTF-8. Tout échec → `null`. | rien |
| `src/features/synthese/lrpgn.ts` | `parseLrpgn(xml: string): ContexteProcedure \| null` — DOMParser, mapping des champs. | rien |
| `src/features/synthese/ContexteFiche.tsx` | Rendu pur d'un `ContexteProcedure`. Aucun accès au store. | le type |
| `src/features/synthese/syntheseStore.ts` | État `contexte` / `xml` ; `setPieces` déclenche l'extraction. | les trois ci-dessus |
| `src/features/synthese/syntheseApi.ts` | `sendSynthese(files, contexte?)` → body `{ files, contexte }`. | — |
| `server/proxy.mjs` | Lit `contexte` du corps, le passe à `runSynthese`. | — |
| `server/synthese.mjs` | Envoie le contexte en champ `prompt`, avec repli. | — |

### Type `ContexteProcedure`

Listes, car le schéma XML autorise N personnes et N faits (l'exemple n'en a
qu'un de chaque).

```ts
type ContexteProcedure = {
  personnes: {
    nom: string; prenom: string;
    naissanceDate: string; naissanceLieu: string;
    implication: string;      // VICTIME, MIS EN CAUSE, TÉMOIN…
    nationalite: string;
  }[];
  faits: {
    libelle: string; natinf: string;
    debut: string; fin: string;
    localisation: string; commune: string; codePostal: string;
  }[];
  procedure: {
    numero: string; annee: string;
    unite: string;              // Unite_L4
    typeEnquete: string;        // Enquete_Type
    dateActe: string;           // Acte_Enquete_Date
  };
  enqueteurs: { nom: string; qualite: string }[];
};
```

Champ absent du XML → chaîne vide, et la ligne correspondante n'est pas rendue.
`parseLrpgn` renvoie `null` si la racine n'est pas `<Procedure>` ou si le
document est malformé.

### Extraction PDF (`pdfXml.ts`)

1. Lire le `File` en `ArrayBuffer`.
2. Localiser les flux `/Type/EmbeddedFile` … `stream\n` … `endstream` par
   recherche sur les octets.
3. Inflater via `DecompressionStream('deflate')`, décoder en UTF-8.
4. Retenir le premier flux dont le contenu commence par un prologue XML et
   contient `<Procedure`.
5. Toute exception (PDF chiffré, flux non-deflate, encodage inattendu) est
   avalée → `null`.

L'extraction est asynchrone et ne bloque jamais : `setPieces` pose les pièces
immédiatement, la fiche apparaît quand l'extraction aboutit.

### Flux

```
choisir(fichier)
  → setPieces : pieces posées, contexte/xml remis à null
  → extraireXmlPdf (async)
      → null : rien à l'écran, comportement identique à aujourd'hui
      → xml  : parseLrpgn → contexte → badge + fiche au-dessus de l'éditeur
« Analyser »
  → POST /api/synthese { files, contexte: xml }
  → workflow IAka → markdown → éditeur (inchangé)
```

### Envoi au workflow, avec repli

`server/iaka.mjs` documente que certains workflows IAka rejettent en 422 tout
champ inattendu. Les workflows multipart existants (synthèse, identify, pvtcmp)
n'envoient que `app_id`, `tenant_id`, `langue` et le ou les fichiers. Le
contrat du workflow de synthèse n'est pas figé : ajouter un champ peut casser
l'analyse.

D'où un envoi tolérant, dans `runSynthese` :

```
postExec(avecContexte) → FormData
    app_id / tenant_id / langue / file(s)
    [+ prompt = XML, si avecContexte]

1er POST : avecContexte = Boolean(contexte)
si réponse 4xx et contexte fourni → console.error + 2e POST sans contexte
si réponse toujours !ok → SYNTHESE_UPSTREAM (inchangé)
```

- Le champ utilisé est `prompt`, déjà connu de l'API IAka, pas un champ inventé.
- Repli **uniquement** sur le POST d'exécution, et **uniquement** sur 4xx : un
  5xx est une panne amont, rejouer n'y changerait rien.
- Le polling du statut est inchangé.
- Coût quand le workflow ne supporte pas le champ : une requête perdue (~1 s).
  Le jour où il le supporte, l'enrichissement s'active sans modification.

`proxy.mjs` tronque `contexte` à 100 ko avant transmission (le XML observé fait
5 ko).

## Gestion des erreurs

Aucune nouvelle erreur utilisateur. L'extraction, le parsing et l'enrichissement
sont best-effort : leur échec laisse la page se comporter exactement comme
aujourd'hui. Les messages de `MESSAGES` dans `syntheseStore` sont inchangés.

## Tests

**Front (Vitest)**

- `pdfXml.test.ts` — PDF minimal fabriqué en mémoire (`CompressionStream('deflate')`
  sur un XML) → XML restitué ; PDF sans `/Type/EmbeddedFile` → `null` ; flux
  corrompu → `null`.
- `lrpgn.test.ts` — sur la fixture `src/fixtures/lrpgn-audition.xml` (le
  `data.xml` réel du PDF d'exemple, données fictives, procédure marquée
  `PREPRODUCTION`) : personne VICTIME BIDULE / Marc, natinf 10832, période
  20→21/02/2025, unité `COB LE-LION-D-ANGERS`. XML vide ou malformé → `null`.
  XML sans `<Personnes>` → liste vide.
- `ContexteFiche.test.tsx` — rend nom, implication et natinf ; un champ absent
  ne produit pas de ligne vide.
- `syntheseStore.test.ts` — fichier sans XML : `contexte` reste `null`, aucune
  erreur, `pieces` posé quand même.
- `syntheseApi.test.ts` — `contexte` présent dans le corps si XML, absent sinon.

**Serveur (`node --test`)**

- `server/synthese.test.mjs` — stub de fetch renvoyant 422 au 1er POST : un 2e
  POST part sans champ `prompt` et l'analyse aboutit. Sans contexte : un seul
  POST. Réponse 500 : pas de rejeu, `SYNTHESE_UPSTREAM`.

**Risque identifié** : `DecompressionStream` peut être absent sous jsdom. Si
c'est le cas, le test de `pdfXml` bascule en `// @vitest-environment node` ; le
module reste destiné au navigateur, où l'API est standard (Chrome 80+,
Firefox 113+). À vérifier au premier test.

## Suites possibles (hors périmètre)

- Contrôle de cohérence : comparer noms, dates et rôle du markdown produit aux
  données XML, signaler les écarts sous la proposition.
- Passerelles : GPS des faits → page carte ; personnes → ariane / réseau.
