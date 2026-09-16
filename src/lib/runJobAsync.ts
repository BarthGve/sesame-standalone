// Lance un workflow BFF asynchrone (POST start → { jobId }) puis poll /api/job/status
// jusqu'à done/error. Chaque requête est courte → compatible Cloudflare (~100s).
export interface RunJobOpts {
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  // Appelé dès que le jobId est connu : permet à l'appelant de le persister pour
  // reprendre le polling après un F5 (le job continue côté serveur, détaché).
  onStart?: (jobId: string) => void;
  // Reprend le polling d'un job DÉJÀ lancé (F5) : pas de POST de démarrage.
  resumeJobId?: string;
}

export async function runJobAsync<T = unknown>(
  startUrl: string,
  body: unknown,
  opts: RunJobOpts = {},
): Promise<T> {
  const f = opts.fetchImpl ?? fetch;
  const interval = opts.intervalMs ?? 3000;
  const timeout = opts.timeoutMs ?? 300000;

  let jobId: string;
  if (opts.resumeJobId) {
    // Reprise : on ne relance rien, on re-poll le job existant.
    jobId = opts.resumeJobId;
  } else {
    const startRes = await f(startUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    // Le start attend un 202 avec { jobId }. Toute autre réponse (4xx/5xx, y compris une
    // page HTML Cloudflare/OVH) doit échouer proprement plutôt que de laisser un
    // SyntaxError de parse JSON opaque remonter.
    let started: any;
    try {
      started = await startRes.json();
    } catch {
      throw new Error("UPSTREAM");
    }
    if (!startRes.ok || !started?.jobId) throw new Error(started?.error || "START_FAILED");
    jobId = started.jobId;
  }
  opts.onStart?.(jobId);

  const deadline = Date.now() + timeout;
  for (;;) {
    if (Date.now() > deadline) throw new Error("TIMEOUT");
    await new Promise((r) => setTimeout(r, interval));
    if (opts.signal?.aborted) throw new Error("ABORTED");
    const res = await f(`/api/job/status?jobId=${encodeURIComponent(jobId)}`, { signal: opts.signal });
    // Job inconnu (ex. conteneur redémarré) : échouer immédiatement plutôt que de
    // poller jusqu'au TIMEOUT.
    if (res.status === 404) throw new Error("JOB_INCONNU");
    let job: any;
    try {
      job = await res.json();
    } catch {
      throw new Error("UPSTREAM");
    }
    if (job?.error === "JOB_INCONNU") throw new Error("JOB_INCONNU");
    if (job.status === "done") return job.result as T;
    if (job.status === "error") throw new Error(job.error || "INTERNAL_ERROR");
  }
}
