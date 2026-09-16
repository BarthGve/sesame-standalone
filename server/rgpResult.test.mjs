import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeResult } from "./rgpResult.mjs";

test("écriture : extrait data du tool-output + message", () => {
  const text =
    '<tool>createProcedure<tool-input>{"unite":15127}</tool-input>' +
    '<tool-output>{"data":{"una":"15127/126/2026","urgent":true}}</tool-output></tool>\n\n' +
    "La procédure a bien été créée.";
  const { parsed, message } = normalizeResult(text);
  assert.deepEqual(parsed, { data: { una: "15127/126/2026", urgent: true } });
  assert.equal(message, "La procédure a bien été créée.");
});

test("lecture : déballe json_build_object", () => {
  const text =
    '<tool>execute_sql<tool-input>{"sql":"..."}</tool-input>' +
    '<tool-output>{"json_build_object":{"data":[{"una":"15127/126/2026"}]}}</tool-output></tool>\n\n' +
    '{"data":[{"una":"15127/126/2026"}]}';
  const { parsed, message } = normalizeResult(text);
  assert.deepEqual(parsed, { data: [{ una: "15127/126/2026" }] });
  assert.equal(message, "");
});

test("écriture : phrase conservée, bloc ```json``` retiré du message", () => {
  const text =
    '<tool>modifyProcedure<tool-input>{}</tool-input>' +
    '<tool-output>{"data":{"una":"15127/126/2026"}}</tool-output></tool>\n\n' +
    "La procédure a bien été modifiée.\n```json\n{\"data\":{}}\n```";
  const { parsed, message } = normalizeResult(text);
  assert.equal(message, "La procédure a bien été modifiée.");
  assert.equal(parsed.data.una, "15127/126/2026");
});

test("erreur métier RGP dans le tool-output", () => {
  const text =
    '<tool>createProcedure<tool-input>{}</tool-input>' +
    '<tool-output>{"error":{"code":"groupe_inconnu","message":"Groupe X inconnu"}}</tool-output></tool>';
  const { parsed } = normalizeResult(text);
  assert.equal(parsed.error.code, "groupe_inconnu");
});

test("apostrophe française préservée (JSON double-quote)", () => {
  const text =
    "<tool-output>{\"data\":{\"synthese\":\"vol à l'étalage\"}}</tool-output>";
  const { parsed } = normalizeResult(text);
  assert.equal(parsed.data.synthese, "vol à l'étalage");
});

test("pas de wrapper : JSON direct", () => {
  const { parsed } = normalizeResult('{"data":[]}');
  assert.deepEqual(parsed, { data: [] });
});

test("inparsable → parsed null, message conservé", () => {
  const { parsed, message } = normalizeResult("texte libre sans json");
  assert.equal(parsed, null);
  assert.equal(message, "texte libre sans json");
});

test("non-string → parsed null", () => {
  assert.equal(normalizeResult(null).parsed, null);
});
