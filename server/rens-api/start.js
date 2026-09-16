'use strict';

const { run } = require('./migrate');

run()
  .then(() => {
    const token = process.env.API_TOKEN || '';
    if (!token) {
      console.error('FATAL: API_TOKEN manquant — refus de démarrer');
      process.exit(1);
    }
    const http = require('http');
    const { createHandler } = require('./server');
    http.createServer(createHandler()).listen(8080, () => console.log('rens-api :8080'));
  })
  .catch((err) => {
    console.error('FATAL: migrate/seed', err?.message || err);
    process.exit(1);
  });
