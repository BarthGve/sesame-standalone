const { test } = require('node:test');
const assert = require('node:assert');
const { Readable } = require('node:stream');
const { uploadPhoto, getPhoto, safeMimeFromKey } = require('./photo');

function fakeMinio(overrides = {}) {
  const calls = [];
  return {
    calls,
    bucketExists: async () => true,
    makeBucket: async (b) => { calls.push({ op: 'makeBucket', b }); },
    putObject: async (b, key, buf, len, meta) => { calls.push({ op: 'putObject', b, key, len, meta }); },
    statObject: async (b, key) => { calls.push({ op: 'statObject', b, key }); return {}; },
    getObject: async (b, key) => { calls.push({ op: 'getObject', b, key }); return Readable.from([Buffer.from('img')]); },
    ...overrides,
  };
}

test('safeMimeFromKey : extension connue -> image, sinon octet-stream', () => {
  assert.equal(safeMimeFromKey('abc.png'), 'image/png');
  assert.equal(safeMimeFromKey('abc.JPG'), 'image/jpeg');
  assert.equal(safeMimeFromKey('abc.html'), 'application/octet-stream');
  assert.equal(safeMimeFromKey(''), 'application/octet-stream');
});

test('uploadPhoto : image jpeg -> putObject + { data:{key} } clé .jpg', async () => {
  const m = fakeMinio();
  const out = await uploadPhoto(m, 'perquisitions', { imageBase64: Buffer.from('hi').toString('base64'), mime: 'image/jpeg' });
  assert.equal(out.code, 200);
  assert.ok(out.data.key.endsWith('.jpg'));
  const put = m.calls.find((c) => c.op === 'putObject');
  assert.equal(put.b, 'perquisitions');
  assert.equal(put.meta['Content-Type'], 'image/jpeg');
});

test('uploadPhoto : crée le bucket s\'il est absent', async () => {
  const m = fakeMinio({ bucketExists: async () => false });
  await uploadPhoto(m, 'perquisitions', { imageBase64: Buffer.from('x').toString('base64'), mime: 'image/png' });
  assert.ok(m.calls.some((c) => c.op === 'makeBucket'), 'makeBucket appelé');
});

test('uploadPhoto : mime non-image -> 400 (anti-XSS)', async () => {
  const m = fakeMinio({ putObject: async () => { throw new Error('ne doit pas être appelé'); } });
  const out = await uploadPhoto(m, 'perquisitions', { imageBase64: Buffer.from('x').toString('base64'), mime: 'text/html' });
  assert.equal(out.code, 400);
  assert.equal(out.error.code, 'bad_request');
});

test('uploadPhoto : image manquante -> 400', async () => {
  const out = await uploadPhoto(fakeMinio(), 'perquisitions', {});
  assert.equal(out.code, 400);
});

test('getPhoto : clé simple -> stream + mime dérivé de l\'extension', async () => {
  const m = fakeMinio();
  const out = await getPhoto(m, 'perquisitions', 'abc.png');
  assert.equal(out.code, 200);
  assert.equal(out.mime, 'image/png');
  assert.ok(out.stream);
});

test('getPhoto : clé de traversée -> 400, aucun accès stockage', async () => {
  const m = fakeMinio();
  for (const bad of ['../secret', 'a/b', '..']) {
    const out = await getPhoto(m, 'perquisitions', bad);
    assert.equal(out.code, 400, bad);
  }
  assert.equal(m.calls.length, 0, 'aucun statObject/getObject sur clé invalide');
});

test('getPhoto : objet absent -> l\'exception statObject remonte (404 côté serveur)', async () => {
  const m = fakeMinio({ statObject: async () => { throw new Error('NoSuchKey'); } });
  await assert.rejects(() => getPhoto(m, 'perquisitions', 'zzz.png'));
});
