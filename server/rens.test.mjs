import { test } from 'node:test';
import assert from 'node:assert';
import { extractSynthese } from './rens.mjs';

test('extractSynthese : retire la trace <tool>…</tool>, garde le markdown', () => {
  const raw = `<tool>execute_sql<tool-output>{"data":[]}</tool-output></tool>\n\n## Synthèse\nTrois fiches ce jour.`;
  assert.strictEqual(extractSynthese(raw), '## Synthèse\nTrois fiches ce jour.');
});

test('extractSynthese : déballe une fence markdown englobante', () => {
  const raw = '```markdown\n**Tendance** : hausse.\n```';
  assert.strictEqual(extractSynthese(raw), '**Tendance** : hausse.');
});

test('extractSynthese : conserve un tableau GFM', () => {
  const raw = `<tool>x<tool-output>{}</tool-output></tool>\n| Thème | N |\n| --- | --- |\n| Rodéos | 3 |`;
  assert.match(extractSynthese(raw), /\| Thème \| N \|/);
});

test('extractSynthese : vide → RENS_INVALIDE', () => {
  assert.throws(() => extractSynthese('<tool>x<tool-output>{}</tool-output></tool>'), /RENS_INVALIDE/);
  assert.throws(() => extractSynthese(42), /RENS_INVALIDE/);
});
