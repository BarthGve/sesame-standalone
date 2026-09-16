const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { migrate } = require('./migrate');

test('migrate : applique les SQL triés, 000_base.sql en premier', async () => {
  const queries = [];
  const pool = {
    async query(sql) {
      queries.push(sql);
      return { rows: [] };
    },
  };
  const files = await migrate(pool, path.join(__dirname, 'migrations'));
  assert.ok(files[0] === '000_base.sql' || queries[0].includes('CREATE TABLE'));
  assert.match(queries[0], /CREATE TABLE.*una|unite|communes/is);
  assert.equal(files[0], '000_base.sql');
  assert.ok(files.includes('001_perquisitions.sql'));
});
