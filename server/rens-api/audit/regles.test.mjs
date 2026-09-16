import { test } from 'node:test';
import assert from 'node:assert';
import { portePii } from './regles.mjs';

test('portePii : un nom de personne est reconnu, un sigle de service ne l\'est pas', () => {
  // La détection décide du périmètre du décret : une fiche sans DCP perd tous ses griefs.
  // Trop large, elle rendait cette sortie inatteignable — « [A-Z]{3,} » s'allumait sur GGD.
  for (const texte of [
    'Contrôle de M. Karim BENNANI le 3 août.',
    'Karim BENNANI a été aperçu sur les lieux.',
    'Véhicule immatriculé AB-123-CD.',
    'Individu né(e) le 01/01/1990.',
    'Compte suivi sur https://t.me/canal49.',
  ]) assert.strictEqual(portePii(texte), true, `donnée personnelle manquée : « ${texte} »`);

  for (const texte of [
    'Patrouille GGD 49 sur la RN 162, secteur ZAC des Landes.',
    'Des dégradations ont été constatées sur du mobilier urbain du centre-bourg.',
    "Rassemblement d'une vingtaine de personnes non identifiées, aucune infraction relevée.",
  ]) assert.strictEqual(portePii(texte), false, `faux positif sur « ${texte} »`);
});

test('portePii : une entrée absente ou non textuelle ne fait pas planter le contrôle', () => {
  // Appelée sur un texte volant venu du réseau : une valeur manquante doit répondre
  // « je n'ai rien détecté », jamais jeter — le verdict des agents reste, lui, souverain.
  for (const entree of [null, undefined, 42, {}]) assert.strictEqual(portePii(entree), false);
});
