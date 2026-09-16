'use strict';

const { run } = require('./migrate');

run()
  .then(() => {
    const { server } = require('./server');
    const token = process.env.API_TOKEN || '';
    if (!token) {
      console.error('FATAL: API_TOKEN manquant — refus de démarrer');
      process.exit(1);
    }
    server.listen(8080, () => console.log('rgp-api :8080'));
  })
  .catch((err) => {
    console.error('FATAL: migrate/seed', err?.message || err);
    process.exit(1);
  });
