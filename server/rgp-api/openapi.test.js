const { test } = require('node:test');
const assert = require('node:assert/strict');
const spec = require('./openapi.json');

test('servers pointe vers le DNS Docker rgp-api:8080', () => {
  assert.equal(spec.servers[0].url, 'http://rgp-api:8080');
  assert.doesNotMatch(spec.servers[0].url, /localhost/);
});
