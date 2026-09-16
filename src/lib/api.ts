import type { FeatureCollection } from "./geo";
import { runJobAsync } from "./runJobAsync";

// `onStart` reçoit le jobId dès le 202 (pour persister le job en vol et pouvoir
// reprendre le polling après un F5). `resumeJobId` re-poll un job DÉJÀ lancé sans
// le relancer (pas de POST) : la cartographie détachée côté serveur est retrouvée.
export async function queryMap(
  question: string,
  fetchImpl: typeof fetch = fetch,
  opts: { onStart?: (jobId: string) => void; resumeJobId?: string } = {}
): Promise<FeatureCollection> {
  return runJobAsync<FeatureCollection>(
    "/api/query",
    opts.resumeJobId ? null : { question },
    { fetchImpl, timeoutMs: 540000, onStart: opts.onStart, resumeJobId: opts.resumeJobId }
  );
}
