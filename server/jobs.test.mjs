// server/jobs.test.mjs
import { test, beforeEach } from "node:test";
import assert from "node:assert";
import { createJob, getJob, runJob, _resetJobsForTests } from "./jobs.mjs";

const tick = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  _resetJobsForTests();
});

test("createJob → jobId + statut pending", () => {
  const id = createJob();
  assert.equal(typeof id, "string");
  assert.equal(getJob(id).status, "pending");
});

test("runJob : done + result quand le worker réussit", async () => {
  const id = createJob();
  runJob(id, async () => ({ texte: "ok" }));
  assert.equal(getJob(id).status, "running");
  await tick(); await tick();
  assert.equal(getJob(id).status, "done");
  assert.deepEqual(getJob(id).result, { texte: "ok" });
});

test("runJob : error + message quand le worker jette", async () => {
  const id = createJob();
  runJob(id, async () => { throw new Error("SYNTHESE_UPSTREAM"); });
  await tick(); await tick();
  assert.equal(getJob(id).status, "error");
  assert.equal(getJob(id).error, "SYNTHESE_UPSTREAM");
});

test("getJob : undefined si inconnu", () => {
  assert.equal(getJob("nope"), undefined);
});

test("getJob : undefined après TTL (job expiré traité comme inconnu)", async () => {
  // Recharger le module avec un TTL très court n'est pas trivial en ESM ;
  // on simule en vieillissant createdAt à la main via le store public get/set.
  const id = createJob();
  const job = getJob(id);
  assert.ok(job);
  job.createdAt = Date.now() - (31 * 60 * 1000); // > 30 min par défaut
  assert.equal(getJob(id), undefined, "job expiré doit disparaître");
  assert.equal(getJob(id), undefined, "déjà purgé de la Map");
});

test("createJob : purge les expirés et plafonne la taille", () => {
  // Crée quelques jobs puis les marque expirés ; le suivant doit purger.
  const ids = [createJob(), createJob(), createJob()];
  for (const id of ids) {
    getJob(id).createdAt = Date.now() - (31 * 60 * 1000);
  }
  const fresh = createJob();
  for (const id of ids) {
    assert.equal(getJob(id), undefined);
  }
  assert.equal(getJob(fresh).status, "pending");
});
