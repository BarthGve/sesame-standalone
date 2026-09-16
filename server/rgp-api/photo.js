const { randomUUID } = require('crypto');

// Photos de scellés : rgp-api est le SEUL service qui parle à MinIO (réseau
// docker interne, jamais exposé). Le BFF forwarde /api/photo vers /photo ici,
// il n'a plus les identifiants MinIO. Fonctions pures (le client MinIO est
// injecté) pour rester testables sans stockage réel — même patron que
// perquisition.js.

const EXT_BY_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/heic': '.heic' };
const MIME_BY_EXT = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.heic': 'image/heic' };

// Type MIME sûr dérivé de l'EXTENSION de la clé (jamais du metadata stocké) : une
// clé qui ne serait pas une image ne peut pas être servie en text/html.
function safeMimeFromKey(key) {
  const m = /(\.[a-z0-9]+)$/i.exec(key || '');
  return (m && MIME_BY_EXT[m[1].toLowerCase()]) || 'application/octet-stream';
}

// Upload : décode le base64, valide le MIME (liste blanche d'images), stocke sous
// une clé UUID. Renvoie { code, data:{key} } ou { code, error }.
async function uploadPhoto(minio, bucket, body) {
  const { imageBase64, mime } = body || {};
  if (!imageBase64 || typeof imageBase64 !== 'string')
    return { code: 400, error: { code: 'bad_request', message: 'imageBase64 requis' } };
  if (!mime || !EXT_BY_MIME[mime])
    return { code: 400, error: { code: 'bad_request', message: 'type image invalide' } };
  const buf = Buffer.from(imageBase64, 'base64');
  if (!(await minio.bucketExists(bucket))) await minio.makeBucket(bucket);
  const key = randomUUID() + EXT_BY_MIME[mime];
  await minio.putObject(bucket, key, buf, buf.length, { 'Content-Type': mime });
  return { code: 200, data: { key } };
}

// Lecture : garde anti-traversal sur la clé, statObject (lève si absente → 404
// géré par l'appelant), puis flux. Le durcissement navigateur (nosniff, CSP) est
// réappliqué par le BFF, qui est ce qui parle au navigateur.
async function getPhoto(minio, bucket, key) {
  if (!key || key.includes('/') || key.includes('..'))
    return { code: 400, error: { code: 'bad_request', message: 'clé invalide' } };
  await minio.statObject(bucket, key);
  const stream = await minio.getObject(bucket, key);
  return { code: 200, stream, mime: safeMimeFromKey(key) };
}

module.exports = { uploadPhoto, getPhoto, safeMimeFromKey, EXT_BY_MIME, MIME_BY_EXT };
