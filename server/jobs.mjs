// server/jobs.mjs
// Store de jobs en mémoire (démo, pas de persistance) : rend les endpoints IAka
// asynchrones (start rend un jobId, le front poll /api/job/status). Généralise le
// pattern déjà utilisé par Ariane.
//
// Garde-fous prod-démo : TTL (fuite mémoire après F5 abandonnés) + plafond de
// entrées (DoS par création massive de jobs). Les jobs expirés se comportent
// comme « inconnus » côté getJob → le front reçoit JOB_INCONNU.
import { randomUUID } from "node:crypto";

const JOB_TTL_MS = Number(process.env.JOB_TTL_MS ?? 30 * 60 * 1000); // 30 min
const JOB_MAX = Number(process.env.JOB_MAX ?? 500);

const jobs = new Map();

function purgeExpired(now = Date.now()) {
  for (const [id, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS) jobs.delete(id);
  }
}

// Si le plafond est atteint après purge, on retire les plus anciens d'abord
// (FIFO sur l'ordre d'insertion de Map) pour laisser passer le nouveau job.
function enforceMax() {
  while (jobs.size >= JOB_MAX) {
    const oldest = jobs.keys().next().value;
    if (oldest === undefined) break;
    jobs.delete(oldest);
  }
}

export function createJob() {
  purgeExpired();
  enforceMax();
  const jobId = randomUUID();
  jobs.set(jobId, { status: "pending", createdAt: Date.now() });
  return jobId;
}

export function getJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return undefined;
  if (Date.now() - job.createdAt > JOB_TTL_MS) {
    jobs.delete(jobId);
    return undefined;
  }
  return job;
}

// Lance le worker en arrière-plan et met à jour le job. Ne bloque pas l'appelant :
// la route a déjà renvoyé le jobId. Le worker doit renvoyer un résultat DÉJÀ normalisé
// (au format attendu par la feature) — le status générique le ressert tel quel.
export function runJob(jobId, worker) {
  const job = getJob(jobId);
  if (!job) return;
  job.status = "running";
  Promise.resolve()
    .then(worker)
    .then((result) => {
      // Le job a pu expirer pendant le worker : on n'écrit plus dans la Map.
      const current = jobs.get(jobId);
      if (!current) return;
      current.result = result;
      current.status = "done";
    })
    .catch((e) => {
      // Log serveur systématique : sans ça, une erreur non whitelistée (cf. ERROR_STATUS
      // dans proxy.mjs) est masquée côté client et ne laisse AUCUNE trace.
      console.error("job_worker_error", e?.message);
      const current = jobs.get(jobId);
      if (!current) return;
      current.error = e?.message || "INTERNAL_ERROR";
      current.status = "error";
    });
}

// Réservé aux tests : vide le store (évite les fuites entre cas).
export function _resetJobsForTests() {
  jobs.clear();
}
