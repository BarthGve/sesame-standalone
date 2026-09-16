# Standalone air-gap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer un dépôt GitHub autonome (`sesame-standalone`) qui fait tourner tout le démonstrateur SÉSAME hors Internet, en appelant une IAKA locale via le BFF.

**Architecture:** Copie du code applicatif depuis `demo-iaka`, purge cloud (Cloudflare, GHCR, kerjean, La Gaufre, IGN, BAN directe). Compose local (BFF ingress + rgp/rens/cote + Postgres PostGIS + MinIO). IAKA hors compose, tout en variables d’environnement. Front = même origine que le BFF.

**Tech Stack:** React 19 + Vite + TS, BFF Node natif, rgp/rens/cote, Postgres/PostGIS, MinIO, Docker Compose, Vitest, `node --test`, Wiki GitHub.

**Spec:** `docs/superpowers/specs/2026-09-16-standalone-airgap-design.md`

## Global Constraints

- Dépôt **nouveau** : ne pas modifier le code OVH de `demo-iaka` (sauf ce plan/spec déjà écrits).
- Le navigateur n’appelle aucune URL `https://` externe (IGN, BAN, La Suite, IAKA).
- Aucun secret, JWT, `app_id` cloud, dump lourd dans git ni le wiki.
- Auth UI : aucune. Tokens uniquement BFF → microservices (réseau Docker).
- Fail-closed microservices (`API_TOKEN` obligatoire au start).
- SQL paramétré uniquement. Pas de log de données de procédure.
- Front : pas d’emoji. TypeScript `strict`. Pas de `as any` hors tests.
- IAKA : chemins execute/status configurables (API non figée).
- `app_id` vides dans `.env.example`.
- Français UI / wiki ; identifiants techniques en anglais (`IAKA_UNAVAILABLE`).
- CI standalone : lint + typecheck + tests + `docker compose config` / build local. Pas de GHCR, pas de deploy OVH.

---

## File structure (nouveau dépôt)

| Fichier | Responsabilité |
|---|---|
| `server/config.mjs` | `loadCfg(env)`, `publicConfig(cfg)`, `iakaReady(cfg)` |
| `server/adresses.mjs` | Proxy BAN : parse query, fetch amont, map GeoJSON → suggestions |
| `server/tiles.mjs` | Substitution `{z}/{x}/{y}` bornée (entiers) |
| `server/ready.mjs` | Sonde IAKA (TCP/HTTP HEAD execute path) → flags |
| `server/iaka.mjs` | Inchangé sauf knobs déjà présents (`executePath`/`statusPath`) + garde `iakaReady` |
| `server/proxy.mjs` | Routes `/api/config`, `/api/ready`, `/api/adresses`, `/api/tiles/...` ; plus de CF Access |
| `server/httpUtil.mjs` | `IAKA_UNAVAILABLE: 503` ; retirer `requireCfAccess` |
| `src/lib/runtimeConfig.ts` | `fetchRuntimeConfig()` → `/api/config` |
| `src/lib/mapStyle.ts` | `basemapStyle(tilesUrl)` ; fond neutre si `null` |
| `src/features/saisies/ban.ts` | `GET /api/adresses?q=` |
| `src/components/HomePage.tsx` | Sans La Gaufre |
| `src/components/MapView.tsx` | Style depuis runtime config |
| `docker-compose.yml` | bff, rgp-api, rens-api, cote-api, postgres, minio |
| `infra/postgres/init/*.sql` | Bases `rgp`/`rens`/`bdsp` + rôles |
| `server/rgp-api/migrations/000_base.sql` | Tables `una` et référentiels manquants |
| `server/rgp-api/seed/minimal.sql` | 1 UNA + 1 perquisition + 1 objet |
| `docs/wiki/*.md` | Source du Wiki GitHub |
| `.env.example` | URLs locales, `app_id` vides, knobs IAKA |
| `.github/workflows/ci.yml` | lint, tsc, tests, pas de registry |

---

### Task 1: Créer le dépôt et copier le code (purge cloud)

**Files:**
- Create: dépôt GitHub `BarthGve/sesame-standalone` (privé ou interne, même visibilité que l’équipe d’install)
- Copy depuis `demo-iaka` puis purger (liste ci-dessous)
- Modify: `package.json` (`name: "sesame-standalone"`, retirer script `release`)
- Create: `README.md` (pointeur wiki)
- Delete after copy: workflows deploy/release, `scripts/release.mjs`, URLs cloud

**Interfaces:**
- Produces: dépôt clonable, `npm ci` possible, aucun `kerjean.net` / `ghcr.io` / `BFF_REQUIRE_CF_ACCESS` dans le code livré (hors historique git, il n’y en a pas : nouveau repo sans l’historique OVH)

- [ ] **Step 1: Créer le dépôt vide**

```bash
gh repo create BarthGve/sesame-standalone --private --description "Démonstrateur SÉSAME / IAKA standalone (air-gap)" --clone=false
mkdir -p /tmp/sesame-standalone && cd /tmp/sesame-standalone
git init -b main
```

Si le nom `sesame-standalone` est refusé par l’utilisateur, s’arrêter et demander le nom. Ne pas pousser sur `demo-iaka`.

- [ ] **Step 2: Copier le code applicatif (sans historique, sans cloud)**

Depuis `demo-iaka` :

```bash
SRC=/Users/brunogauville/Developpeur/XP-IAka/demo-iaka
DST=/tmp/sesame-standalone
rsync -a --exclude node_modules --exclude dist --exclude .git --exclude .env \
  --exclude .github/workflows/deploy.yml --exclude .github/workflows/release.yml \
  --exclude scripts/release.mjs --exclude CHANGELOG.md \
  --exclude infra --exclude .codex --exclude .serena --exclude graphify-out \
  "$SRC/" "$DST/"
```

Copier aussi : `docs/superpowers/specs/2026-09-16-standalone-airgap-design.md`, `docs/corpus/` (qualité GIPASP).

- [ ] **Step 3: Purger les traces cloud**

Dans `$DST` :

1. Remplacer `.env.example` par le contenu de la Task 6 (peut rester un stub `IAKA_BASE_URL=` le temps de la Task 6).
2. `package.json` : `"name": "sesame-standalone"`, supprimer `"release": "node scripts/release.mjs"`.
3. Réécrire `README.md` :

```markdown
# SÉSAME standalone (air-gap)

Démonstrateur des cas d'usage IAKA pour installation **hors Internet**.

La démo OVH vit dans un autre dépôt. Ici : code + compose + wiki d'install.

Documentation : [Wiki](../../wiki) — commencer par **Installation**.
```

4. Réécrire `AGENTS.md` / `CLAUDE.md` : retirer GHCR, Cloudflare, kerjean, `npm run release`, `deploy.yml`. Conserver : fail-closed, SQL paramétré, pas d’emoji, tests par zone, `IAKA_*` en env.
5. Supprimer `BFF_REQUIRE_CF_ACCESS` de tout fichier (code : Task 2).
6. Vérifier :

```bash
rg -n 'kerjean\.net|ghcr\.io|BFF_REQUIRE_CF_ACCESS|data\.geopf\.fr|api-adresse\.data\.gouv\.fr|lasuite\.numerique\.gouv\.fr' \
  --glob '!docs/superpowers/**' --glob '!package-lock.json' || true
```

Attendu après Tasks 2–5 : zéro match dans `src/` et `server/` (hors commentaires de purge si on en laisse un dans le wiki). Après Task 1, les matchs `geopf` / `api-adresse` / `lasuite` restent : ils sont enlevés aux tasks front.

- [ ] **Step 4: Premier commit local (ne pas pousser tant que `gh repo create` n’a pas été confirmé)**

```bash
cd /tmp/sesame-standalone
git add -A
git commit -m "chore: import standalone depuis demo-iaka (sans historique cloud)"
```

- [ ] **Step 5: Branchement remote**

```bash
git remote add origin https://github.com/BarthGve/sesame-standalone.git
git push -u origin main
```

Critère : le dépôt GitHub existe, `demo-iaka` n’a aucun commit de code applicatif lié à ce chantier.

---

### Task 2: Config IAKA testable (`loadCfg`, `publicConfig`, `iakaReady`)

**Files:**
- Create: `server/config.mjs`
- Create: `server/config.test.mjs`
- Modify: `server/httpUtil.mjs` — ajouter `IAKA_UNAVAILABLE: 503` ; retirer la branche Cloudflare de `checkBffAccess`
- Modify: `server/httpUtil.test.mjs` — supprimer les tests CF Access
- Modify: `server/iaka.mjs` — appeler `iakaReady(cfg)` en tête de `execWorkflow`
- Modify: `server/iaka.test.mjs` — chemins custom + `IAKA_UNAVAILABLE`
- Modify: `server/proxy.mjs` — `loadCfg(process.env)` au boot ; plus de `requireCfAccess`

**Interfaces:**
- Produces:
  - `loadCfg(env: Record<string,string|undefined>): Cfg`
  - `publicConfig(cfg): { tiles: boolean, tilesUrl: string|null, ban: boolean, workflows: Record<string,boolean>, rag: boolean }`
  - `iakaReady(cfg): void` throws `Error('IAKA_UNAVAILABLE')`
- Consumes: `cfg.executePath`, `cfg.statusPath` déjà lus par `iaka.mjs`

- [ ] **Step 1: Test `config.test.mjs` (échoue : module absent)**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCfg, publicConfig, iakaReady } from "./config.mjs";

const base = {
  IAKA_BASE_URL: "http://iaka:8080",
  IAKA_JWT: "jwt",
  IAKA_TENANT_ID: "t",
};

test("loadCfg : chemins IAKA par défaut et surchargeables", () => {
  const a = loadCfg(base);
  assert.equal(a.executePath, "/workflows/execute");
  assert.equal(a.statusPath, "/workflows/executions/{id}");
  const b = loadCfg({
    ...base,
    IAKA_EXECUTE_PATH: "/v2/run",
    IAKA_STATUS_PATH: "/v2/jobs/{id}",
  });
  assert.equal(b.executePath, "/v2/run");
  assert.equal(b.statusPath, "/v2/jobs/{id}");
});

test("publicConfig : booléens, pas de JWT ni d'UUID", () => {
  const cfg = loadCfg({
    ...base,
    IAKA_CARTE_APP_ID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    IAKA_JWT: "super-secret",
    MAP_TILES_URL: "http://tiles/{z}/{x}/{y}.png",
    BAN_API_URL: "http://addok:7878",
    IAKA_RAG_CORPUS_ID: "corpus-1",
  });
  const p = publicConfig(cfg);
  const dumped = JSON.stringify(p);
  assert.equal(p.tiles, true);
  assert.equal(p.tilesUrl, "/api/tiles/{z}/{x}/{y}");
  assert.equal(p.ban, true);
  assert.equal(p.workflows.carte, true);
  assert.equal(p.workflows.rgp, false);
  assert.equal(p.rag, true);
  assert.ok(!dumped.includes("super-secret"));
  assert.ok(!dumped.includes("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));
  assert.ok(!dumped.includes("http://tiles"));
});

test("iakaReady lève IAKA_UNAVAILABLE si URL/JWT/tenant manquent", () => {
  assert.throws(() => iakaReady(loadCfg({})), /IAKA_UNAVAILABLE/);
  assert.doesNotThrow(() => iakaReady(loadCfg(base)));
});

test("app_id vide → workflow false", () => {
  const p = publicConfig(loadCfg(base));
  for (const k of Object.keys(p.workflows)) assert.equal(p.workflows[k], false);
});
```

- [ ] **Step 2: Lancer le test — FAIL module not found**

```bash
node --test server/config.test.mjs
```

Expected: `ERR_MODULE_NOT_FOUND`

- [ ] **Step 3: Implémenter `server/config.mjs`**

```js
const APP_IDS = {
  carte: "IAKA_CARTE_APP_ID",
  identify: "IAKA_IDENTIFY_APP_ID",
  rgp: "IAKA_RGP_APP_ID",
  synthese: "IAKA_SYNTHESE_APP_ID",
  evaluation: "IAKA_EVALUATION_APP_ID",
  pvtcmp: "IAKA_PVTCMP_APP_ID",
  arianeExtraction: "IAKA_ARIANE_EXTRACTION_APP_ID",
  arianeConsolidation: "IAKA_ARIANE_CONSOLIDATION_APP_ID",
  rensSynthese: "IAKA_RENS_SYNTHESE_APP_ID",
  rensZoom: "IAKA_RENS_ZOOM_APP_ID",
  qualite: "IAKA_QUALITE_APP_ID",
};

function filled(v) {
  return Boolean(v && String(v).trim());
}

export function loadCfg(env = process.env) {
  const e = env;
  const carteApp = e.IAKA_CARTE_APP_ID || e.IAKA_APP_ID;
  return {
    baseUrl: e.IAKA_BASE_URL || "",
    jwt: e.IAKA_JWT || "",
    tenantId: e.IAKA_TENANT_ID || "",
    executePath: e.IAKA_EXECUTE_PATH || "/workflows/execute",
    statusPath: e.IAKA_STATUS_PATH || "/workflows/executions/{id}",
    appId: carteApp || "",
    identifyAppId: e.IAKA_IDENTIFY_APP_ID || "",
    rgpAppId: e.IAKA_RGP_APP_ID || "",
    syntheseAppId: e.IAKA_SYNTHESE_APP_ID || "",
    evaluationAppId: e.IAKA_EVALUATION_APP_ID || "",
    pvtcmpAppId: e.IAKA_PVTCMP_APP_ID || "",
    arianeExtractionAppId: e.IAKA_ARIANE_EXTRACTION_APP_ID || "",
    arianeConsolidationAppId: e.IAKA_ARIANE_CONSOLIDATION_APP_ID || "",
    rensSyntheseAppId: e.IAKA_RENS_SYNTHESE_APP_ID || "",
    rensZoomAppId: e.IAKA_RENS_ZOOM_APP_ID || "",
    qualiteAppId: e.IAKA_QUALITE_APP_ID || "",
    mapConcurrency: Number(e.ARIANE_MAP_CONCURRENCY ?? 4),
    ragBaseUrl: e.IAKA_RAG_BASE_URL || "",
    ragCorpusId: e.IAKA_RAG_CORPUS_ID || "",
    ragIakId: e.IAKA_RAG_IAK_ID || "",
    ragModel: e.IAKA_RAG_MODEL || "",
    ragMaxTokens: Number(e.IAKA_RAG_MAX_TOKENS ?? 28000),
    imageField: e.IAKA_IMAGE_FIELD || "file",
    syntheseFileField: e.IAKA_SYNTHESE_FILE_FIELD,
    pvtcmpFileField: e.IAKA_PVTCMP_FILE_FIELD,
    pollIntervalMs: Number(e.POLL_INTERVAL_MS ?? 1500),
    pollTimeoutMs: Number(e.POLL_TIMEOUT_MS ?? 60000),
    cartePollTimeoutMs: Number(e.CARTE_POLL_TIMEOUT_MS ?? 480000),
    cartePollIntervalMs: Number(e.CARTE_POLL_INTERVAL_MS ?? 4000),
    rgpApiUrl: e.RGP_API_URL || "http://rgp-api:8080",
    rgpApiToken: e.RGP_API_TOKEN || "",
    rensApiUrl: e.RENS_API_URL || "http://rens-api:8080",
    rensApiToken: e.RENS_API_TOKEN || "",
    mapTilesUrl: e.MAP_TILES_URL || "",
    banApiUrl: e.BAN_API_URL || "",
    staticDir: e.STATIC_DIR || null,
    bffApiToken: e.BFF_API_TOKEN || "",
    auditNightly: e.AUDIT_NIGHTLY === "1",
  };
}

export function publicConfig(cfg) {
  const tiles = filled(cfg.mapTilesUrl);
  return {
    tiles,
    tilesUrl: tiles ? "/api/tiles/{z}/{x}/{y}" : null,
    ban: filled(cfg.banApiUrl),
    workflows: {
      carte: filled(cfg.appId),
      identify: filled(cfg.identifyAppId),
      rgp: filled(cfg.rgpAppId),
      synthese: filled(cfg.syntheseAppId),
      evaluation: filled(cfg.evaluationAppId),
      pvtcmp: filled(cfg.pvtcmpAppId),
      arianeExtraction: filled(cfg.arianeExtractionAppId),
      arianeConsolidation: filled(cfg.arianeConsolidationAppId),
      rensSynthese: filled(cfg.rensSyntheseAppId),
      rensZoom: filled(cfg.rensZoomAppId),
      qualite: filled(cfg.qualiteAppId),
    },
    rag: filled(cfg.ragCorpusId),
  };
}

export function iakaReady(cfg) {
  if (!filled(cfg.baseUrl) || !filled(cfg.jwt) || !filled(cfg.tenantId)) {
    throw new Error("IAKA_UNAVAILABLE");
  }
}

export { APP_IDS };
```

- [ ] **Step 4: `IAKA_UNAVAILABLE` dans `ERROR_STATUS` ; retirer CF Access**

Dans `httpUtil.mjs` `ERROR_STATUS`, ajouter `IAKA_UNAVAILABLE: 503`.

`checkBffAccess` : supprimer le bloc `cfg.requireCfAccess`. Ne garder que `bffApiToken` optionnel (off par défaut). Mettre à jour le commentaire : standalone = pas d’auth UI ; Bearer optionnel machine-to-machine.

Supprimer les tests CF dans `httpUtil.test.mjs`. Conserver les tests `BFF_API_TOKEN`.

- [ ] **Step 5: `iaka.mjs` — garde + chemins (déjà là)**

En tête de `execWorkflow` :

```js
import { iakaReady } from "./config.mjs";
// ...
iakaReady(cfg);
```

Test à ajouter dans `iaka.test.mjs` :

```js
test("cfg sans baseUrl lève IAKA_UNAVAILABLE avant tout fetch", async () => {
  let called = 0;
  const fetchImpl = async () => { called++; return { ok: true, json: async () => ({}) }; };
  await assert.rejects(
    runWorkflow({ question: "q", cfg: { jwt: "j", tenantId: "t", appId: "a", pollTimeoutMs: 10, pollIntervalMs: 1 }, fetchImpl, sleep: noSleep }),
    /IAKA_UNAVAILABLE/
  );
  assert.equal(called, 0);
});

test("executePath / statusPath custom sont utilisés", async () => {
  const urls = [];
  const cfg = { baseUrl: "http://iaka", jwt: "j", tenantId: "t", appId: "a", executePath: "/v2/run", statusPath: "/v2/jobs/{id}", pollIntervalMs: 0, pollTimeoutMs: 100 };
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.includes("/v2/run")) return { ok: true, json: async () => ({ execution_id: "e1" }) };
    return { ok: true, json: async () => ({ status: "SUCCESS", result: JSON.stringify(fc) }) };
  };
  await runWorkflow({ question: "q", cfg, fetchImpl, sleep: noSleep });
  assert.equal(urls[0], "http://iaka/v2/run");
  assert.ok(urls[1].startsWith("http://iaka/v2/jobs/e1"));
});
```

- [ ] **Step 6: Brancher `loadCfg` dans `proxy.mjs` au boot**

Remplacer le gros objet `const cfg = { ... process.env ... }` par :

```js
import { loadCfg } from "./config.mjs";
const cfg = loadCfg(process.env);
```

Retirer `cfg.requireCfAccess` et le `console.warn` Cloudflare. Log simple : `proxy IAka sur http://localhost:${port}`.

- [ ] **Step 7: Tests**

```bash
node --test server/config.test.mjs server/iaka.test.mjs server/httpUtil.test.mjs
```

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add server/config.mjs server/config.test.mjs server/httpUtil.mjs server/httpUtil.test.mjs server/iaka.mjs server/iaka.test.mjs server/proxy.mjs
git commit -m "feat: config IAKA surchargeable et IAKA_UNAVAILABLE"
```

---

### Task 3: `GET /api/config` et `GET /api/ready`

**Files:**
- Create: `server/ready.mjs`, `server/ready.test.mjs`
- Modify: `server/proxy.mjs` — routes GET
- Modify: `server/proxy.test.mjs`

**Interfaces:**
- Consumes: `publicConfig(cfg)`, `cfg.baseUrl`
- Produces: JSON `{ data: publicConfig }` et `{ data: { ok, iaka, workflows, tiles, ban, rag } }`
- `probeIaka(cfg, fetchImpl) → { reachable: boolean }` — GET `baseUrl` (pas le JWT dans les logs). Timeout 2s. Échec → `reachable: false`, pas d’exception au client.

- [ ] **Step 1: Tests ready + proxy**

`server/ready.test.mjs` :

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { probeIaka } from "./ready.mjs";

test("probeIaka : HTTP ok → reachable", async () => {
  const fetchImpl = async () => ({ ok: true, status: 200 });
  const out = await probeIaka({ baseUrl: "http://iaka:1" }, fetchImpl);
  assert.equal(out.reachable, true);
});

test("probeIaka : fetch throw → reachable false", async () => {
  const fetchImpl = async () => { throw new Error("ECONNREFUSED"); };
  const out = await probeIaka({ baseUrl: "http://iaka:1" }, fetchImpl);
  assert.equal(out.reachable, false);
});

test("probeIaka : baseUrl vide → reachable false sans fetch", async () => {
  let n = 0;
  const fetchImpl = async () => { n++; };
  const out = await probeIaka({ baseUrl: "" }, fetchImpl);
  assert.equal(out.reachable, false);
  assert.equal(n, 0);
});
```

Dans `proxy.test.mjs` (handler avec cfg complet) :

```js
test("GET /api/config n'expose pas le JWT", async () => {
  const handlerCfg = { jwt: "secret-jwt", baseUrl: "http://iaka", tenantId: "t", appId: "abc", mapTilesUrl: "", banApiUrl: "" };
  // withServer doit accepter cfg — étendre le helper :
  // createHandler({ cfg: { ...cfg, ...handlerCfg }, run })
  const server = createServer(createHandler({ cfg: { ...cfg, ...handlerCfg } }));
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const res = await fetch(`http://localhost:${port}/api/config`);
  assert.equal(res.status, 200);
  const body = await res.json();
  const s = JSON.stringify(body);
  assert.equal(body.data.workflows.carte, true);
  assert.ok(!s.includes("secret-jwt"));
  assert.ok(!s.includes("abc"));
  server.close();
});
```

Adapter `withServer` pour passer `cfg` fusionné. `/api/config` et `/api/ready` sont sous `/api/` donc passent `checkBffAccess` — token vide = OK.

- [ ] **Step 2: FAIL puis implémenter `ready.mjs`**

```js
export async function probeIaka(cfg, fetchImpl = fetch) {
  if (!cfg.baseUrl) return { reachable: false };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2000);
  try {
    const res = await fetchImpl(cfg.baseUrl, { method: "GET", signal: ctrl.signal });
    return { reachable: Boolean(res && (res.ok || res.status)) };
  } catch {
    return { reachable: false };
  } finally {
    clearTimeout(t);
  }
}
```

Routes dans `createHandler`, **avant** les forwards, après le garde `/api/` :

```js
import { publicConfig } from "./config.mjs";
import { probeIaka } from "./ready.mjs";

if (url.pathname === "/api/config" && req.method === "GET") {
  return writeJson(res, 200, { data: publicConfig(cfg) });
}
if (url.pathname === "/api/ready" && req.method === "GET") {
  const iaka = await probeIaka(cfg, fetchImpl);
  const pub = publicConfig(cfg);
  return writeJson(res, 200, {
    data: { ok: true, iaka: iaka.reachable, workflows: pub.workflows, tiles: pub.tiles, ban: pub.ban, rag: pub.rag },
  });
}
```

- [ ] **Step 3: Tests PASS**

```bash
node --test server/ready.test.mjs server/proxy.test.mjs
```

- [ ] **Step 4: Commit**

```bash
git add server/ready.mjs server/ready.test.mjs server/proxy.mjs server/proxy.test.mjs
git commit -m "feat: /api/config et /api/ready sans secrets"
```

---

### Task 4: BAN via BFF + tuiles via BFF

**Files:**
- Create: `server/adresses.mjs`, `server/adresses.test.mjs`
- Create: `server/tiles.mjs`, `server/tiles.test.mjs`
- Modify: `server/proxy.mjs`
- Modify: `server/httpUtil.mjs` — `BAN_UPSTREAM: 502` (optionnel : on renvoie `[]` plutôt qu’une erreur — spec : `[]` si BAN off ou amont ko, pour ne pas casser la saisie libre)

**Interfaces:**
- `searchAdresses(q, cfg, fetchImpl) → AdresseSuggestion[]`
- `tilesUpstreamUrl(template, z, x, y) → string | null`

- [ ] **Step 1: Tests**

```js
// server/adresses.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { searchAdresses } from "./adresses.mjs";

test("q < 3 → [] sans fetch", async () => {
  let n = 0;
  const out = await searchAdresses("ab", { banApiUrl: "http://ban" }, async () => { n++; });
  assert.deepEqual(out, []);
  assert.equal(n, 0);
});

test("BAN_API_URL vide → [] sans fetch", async () => {
  let n = 0;
  const out = await searchAdresses("rue victor", { banApiUrl: "" }, async () => { n++; });
  assert.deepEqual(out, []);
  assert.equal(n, 0);
});

test("Addok/BAN GeoJSON → suggestions", async () => {
  const fetchImpl = async (url) => {
    assert.ok(url.includes("q=rue"));
    return {
      ok: true,
      json: async () => ({
        features: [{ properties: { label: "12 Rue X, 75001 Paris", name: "12 Rue X", city: "Paris", postcode: "75001", citycode: "75101" } }],
      }),
    };
  };
  const out = await searchAdresses("rue xxxx", { banApiUrl: "http://addok:7878" }, fetchImpl);
  assert.equal(out[0].commune, "Paris");
  assert.equal(out[0].insee, "75101");
});

test("amont ko → [] (saisie libre)", async () => {
  const out = await searchAdresses("rue x", { banApiUrl: "http://addok" }, async () => ({ ok: false, status: 502 }));
  assert.deepEqual(out, []);
});
```

```js
// server/tiles.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { tilesUpstreamUrl } from "./tiles.mjs";

test("entiers valides substitués", () => {
  assert.equal(
    tilesUpstreamUrl("http://t/{z}/{x}/{y}.png", "2", "1", "0"),
    "http://t/2/1/0.png"
  );
});

test("non entier → null (pas de SSRF path)", () => {
  assert.equal(tilesUpstreamUrl("http://t/{z}/{x}/{y}", "../", "1", "1"), null);
  assert.equal(tilesUpstreamUrl("http://t/{z}/{x}/{y}", "1", "x", "1"), null);
});

test("template vide → null", () => {
  assert.equal(tilesUpstreamUrl("", "1", "1", "1"), null);
});
```

- [ ] **Step 2: FAIL puis implémenter**

`adresses.mjs` : `q.trim().length < 3` ou `!cfg.banApiUrl` → `[]`. Sinon GET `${banApiUrl}/search/?q=&limit=6&autocomplete=1` (si `banApiUrl` a déjà un path, joindre proprement : si se termine par `/search` ne pas doubler). Mapper `features[].properties` comme l’actuel `ban.ts`. Catch / `!ok` → `[]`. Ne pas logger `q`.

`tiles.mjs` :

```js
export function tilesUpstreamUrl(template, z, x, y) {
  if (!template) return null;
  if (![z, x, y].every((v) => /^\d+$/.test(String(v)))) return null;
  return template.replaceAll("{z}", String(z)).replaceAll("{x}", String(x)).replaceAll("{y}", String(y));
}
```

Proxy dans `proxy.mjs` :

- `GET /api/adresses` : `q` depuis query, `writeJson(200, { data: await searchAdresses(q, cfg, fetchImpl) })`
- `GET /api/tiles/:z/:x/:y` : parser path `/api/tiles/(\d+)/(\d+)/(\d+)`. Si `tilesUpstreamUrl` null → 404 `{ error: "TILES_OFF" }`. Sinon `fetchImpl(upstream)` et pipe status + `Content-Type` image (borne : refuser redirect hors template). Timeout 5s. Échec → 502 `{ error: "TILES_UPSTREAM" }` sans body amont.

- [ ] **Step 3: Tests PASS + commit**

```bash
node --test server/adresses.test.mjs server/tiles.test.mjs server/proxy.test.mjs
git add server/adresses.mjs server/adresses.test.mjs server/tiles.mjs server/tiles.test.mjs server/proxy.mjs server/proxy.test.mjs
git commit -m "feat: proxy BAN et tuiles same-origin"
```

---

### Task 5: Front air-gap (tuiles, BAN, La Gaufre)

**Files:**
- Create: `src/lib/runtimeConfig.ts`, `src/lib/runtimeConfig.test.ts`
- Create: `src/lib/mapStyle.test.ts`
- Modify: `src/lib/mapStyle.ts`
- Modify: `src/components/MapView.tsx`
- Modify: `src/features/saisies/ban.ts`
- Create: `src/features/saisies/ban.test.ts`
- Modify: `src/components/HomePage.tsx`
- Modify: `src/App.test.tsx` — pas de texte/URL La Gaufre

**Interfaces:**
- Consumes: `GET /api/config` → `{ data: { tiles, tilesUrl, ban, workflows, rag } }`
- `basemapStyle(tilesUrl: string | null): StyleSpecification`
- `searchAdresse(query, fetchImpl, signal)` → `/api/adresses?q=`

- [ ] **Step 1: Tests front (FAIL)**

`src/lib/mapStyle.test.ts` :

```ts
import { basemapStyle } from "./mapStyle";

test("sans tuiles : pas d'URL externe", () => {
  const s = JSON.stringify(basemapStyle(null));
  expect(s).not.toMatch(/geopf|https:\/\//);
  expect(basemapStyle(null).sources).toEqual({});
});

test("avec tuiles same-origin", () => {
  const s = basemapStyle("/api/tiles/{z}/{x}/{y}");
  expect(s.sources.basemap.tiles[0]).toBe("/api/tiles/{z}/{x}/{y}");
});
```

`src/features/saisies/ban.test.ts` :

```ts
import { searchAdresse } from "./ban";

test("appelle /api/adresses et mappe data", async () => {
  const fetchImpl = async (url: string) => {
    expect(url).toBe("/api/adresses?q=rue%20x");
    return { ok: true, json: async () => ({ data: [{ label: "L", name: "N", commune: "C", codePostal: "75001", insee: "75101" }] }) } as Response;
  };
  const out = await searchAdresse("rue x", fetchImpl as typeof fetch);
  expect(out[0].commune).toBe("C");
});

test("q court → [] sans fetch", async () => {
  let n = 0;
  await searchAdresse("ab", (async () => { n++; }) as unknown as typeof fetch);
  expect(n).toBe(0);
});
```

`runtimeConfig.test.ts` : mock fetch `/api/config`, retourne `data`.

`App.test.tsx` : `expect(document.documentElement.innerHTML).not.toMatch(/lasuite\.numerique|lagaufre/i)` sur la route `/`.

- [ ] **Step 2: FAIL `basemapStyle is not a function` / URL geopf encore là**

```bash
npx vitest run src/lib/mapStyle.test.ts src/features/saisies/ban.test.ts
```

- [ ] **Step 3: Implémenter**

`mapStyle.ts` :

```ts
import type { StyleSpecification } from "maplibre-gl";

export function basemapStyle(tilesUrl: string | null): StyleSpecification {
  if (!tilesUrl) {
    return { version: 8, sources: {}, layers: [] };
  }
  return {
    version: 8,
    sources: {
      basemap: { type: "raster", tiles: [tilesUrl], tileSize: 256 },
    },
    layers: [{ id: "basemap", type: "raster", source: "basemap" }],
  };
}
```

`ban.ts` : remplacer `ENDPOINT` par `/api/adresses?q=` ; parser `body.data` (tableau déjà mappé). Si `!res.ok` → `[]` (pas throw, saisie libre).

`runtimeConfig.ts` :

```ts
export type RuntimeConfig = {
  tiles: boolean;
  tilesUrl: string | null;
  ban: boolean;
  workflows: Record<string, boolean>;
  rag: boolean;
};

const EMPTY: RuntimeConfig = {
  tiles: false,
  tilesUrl: null,
  ban: false,
  workflows: {},
  rag: false,
};

export async function fetchRuntimeConfig(fetchImpl: typeof fetch = fetch): Promise<RuntimeConfig> {
  const res = await fetchImpl("/api/config");
  if (!res.ok) return EMPTY;
  const body = await res.json();
  return (body.data as RuntimeConfig) ?? EMPTY;
}
```

`MapView.tsx` : état `tilesUrl` chargé via `fetchRuntimeConfig` dans le `useEffect` d’init (ne créer la map qu’après le fetch, ou `setStyle` ensuite). Utiliser `basemapStyle(cfg.tilesUrl)`.

`HomePage.tsx` : supprimer import et JSX `LaGaufreV2`. Laisser `headerOptions` vide ou sans `actions`. **Garder** `@gouvfr-lasuite/ui-kit` (CunninghamProvider / MainLayout dans `App.tsx`).

- [ ] **Step 4: Tests + grep**

```bash
npx vitest run src/lib/mapStyle.test.ts src/features/saisies/ban.test.ts src/lib/runtimeConfig.test.ts src/App.test.tsx
rg -n 'geopf|api-adresse\.data\.gouv|lasuite\.numerique|anct\.gouv' src/
```

Expected: tests PASS, grep vide.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mapStyle.ts src/lib/mapStyle.test.ts src/lib/runtimeConfig.ts src/lib/runtimeConfig.test.ts \
  src/features/saisies/ban.ts src/features/saisies/ban.test.ts src/components/MapView.tsx src/components/HomePage.tsx src/App.test.tsx
git commit -m "feat: front air-gap (tuiles, BAN, sans La Gaufre)"
```

---

### Task 6: Compose, `.env.example`, images

**Files:**
- Create: `docker-compose.yml`
- Create: `infra/postgres/init/01-databases.sql`
- Create: `infra/postgres/init/02-passwords.sql` (ALTER ROLE, mots de passe **dev locaux** documentés, pas des secrets prod)
- Create: `.env.example` (remplace le stub)
- Modify: `Dockerfile` (BFF, déjà là) — `STATIC_DIR=/app/dist`
- Create: `infra/minio/init.sh` — `mc mb` bucket `perquisitions`

**Interfaces:**
- BFF env compose : `RGP_API_URL=http://rgp-api:8080`, `RENS_API_URL=http://rens-api:8080`, `IAKA_BASE_URL` depuis `.env`
- Ports publiés : `80:8787` seulement (postgres `5432` en profil `debug`)

- [ ] **Step 1: `.env.example`**

```
IAKA_BASE_URL=http://iaka:8080
IAKA_JWT=
IAKA_TENANT_ID=
IAKA_EXECUTE_PATH=/workflows/execute
IAKA_STATUS_PATH=/workflows/executions/{id}

IAKA_CARTE_APP_ID=
IAKA_IDENTIFY_APP_ID=
IAKA_RGP_APP_ID=
IAKA_SYNTHESE_APP_ID=
IAKA_EVALUATION_APP_ID=
IAKA_PVTCMP_APP_ID=
IAKA_ARIANE_EXTRACTION_APP_ID=
IAKA_ARIANE_CONSOLIDATION_APP_ID=
IAKA_RENS_SYNTHESE_APP_ID=
IAKA_RENS_ZOOM_APP_ID=
IAKA_QUALITE_APP_ID=

IAKA_RAG_CORPUS_ID=
IAKA_RAG_BASE_URL=
IAKA_RAG_IAK_ID=
IAKA_RAG_MODEL=
IAKA_RAG_MAX_TOKENS=28000

POLL_INTERVAL_MS=1500
POLL_TIMEOUT_MS=600000
CARTE_POLL_TIMEOUT_MS=480000
CARTE_POLL_INTERVAL_MS=4000

RGP_API_URL=http://rgp-api:8080
RGP_API_TOKEN=changeme
RENS_API_URL=http://rens-api:8080
RENS_API_TOKEN=changeme

MAP_TILES_URL=
BAN_API_URL=
AUDIT_NIGHTLY=0
PROXY_PORT=8787
```

Aucun UUID, aucun kerjean.

- [ ] **Step 2: `infra/postgres/init/01-databases.sql`**

```sql
CREATE DATABASE rgp;
CREATE DATABASE rens;
CREATE DATABASE bdsp;
```

Le superuser compose (`POSTGRES_USER=sesame`) crée ces bases au premier boot. `bdsp` recevra PostGIS via `CREATE EXTENSION postgis;` dans un `03-bdsp.sql` connecté à `bdsp` (fichier `03-bdsp.sh` : `psql -d bdsp -c 'CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS unaccent;'`).

- [ ] **Step 3: `docker-compose.yml`**

Services : `postgres` (`postgis/postgis:16-3.5`), `minio` (`minio/minio:RELEASE.2024-12-18T13-15-44Z` pin une version), `minio-init` (depends_on minio, `mc alias` + `mc mb perquisitions`), `rgp-api` (build `server/rgp-api`, env `API_TOKEN`, `PG*`, `MINIO_*`, port interne 8080), `rens-api` (build `server/rens-api`, `API_TOKEN`, `PG*`, `AUDIT_NIGHTLY=0`, IAKA_* pour audit si activé), `cote-api` (8082), `bff` (build `.`, ports `80:8787`, `STATIC_DIR=/app/dist`, env_file `.env`).

Aucun `image: ghcr.io`. Healthcheck BFF : `wget -qO- http://127.0.0.1:8787/health`.

- [ ] **Step 4: Valider le compose (sans up si images de base absentes)**

```bash
docker compose -f docker-compose.yml config
```

Expected: exit 0, services listés.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml .env.example infra/postgres infra/minio
git commit -m "feat: compose air-gap (BFF, rgp, rens, cote, postgres, minio)"
```

---

### Task 7: Schéma RGP de base + seed minimal

**Files:**
- Create: `server/rgp-api/migrations/000_base.sql`
- Create: `server/rgp-api/seed/minimal.sql`
- Create: `server/rgp-api/migrations/000_base.test.mjs` (parse SQL : contient `CREATE TABLE una` et pas de PII réelle)
- Create: `infra/postgres/init/04-rgp-roles.sql` — rôles `rgp_api`, `iaka_ro` (LOGIN) pour que les GRANT des migrations 001/003 ne cassent pas

**Interfaces:**
- Après migrations + seed : `SELECT count(*) FROM una` ≥ 1, une perquisition, un objet `TELEPHONE`. Données **fictives** (pas de nom réel, pas d’IMEI réel).

- [ ] **Step 1: Test du fichier seed (pas de réseau)**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("000_base crée una et communes", () => {
  const sql = readFileSync(new URL("./000_base.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE una\b/);
  assert.match(sql, /CREATE TABLE communes\b/);
});

test("seed minimal : une UNA fictive, pas d'IMEI", () => {
  const sql = readFileSync(new URL("../seed/minimal.sql", import.meta.url), "utf8");
  assert.match(sql, /12345\/1\/2026|unite.*12345/i);
  assert.doesNotMatch(sql, /\b\d{15}\b/); // pas d'IMEI 15 chiffres
});
```

Chemin du test : `server/rgp-api/seed/minimal.test.mjs` pour que `import.meta.url` colle.

- [ ] **Step 2: FAIL fichier absent**

- [ ] **Step 3: `000_base.sql`**

Créer si absentes (OVH les a déjà ; standalone non) :

- `unite (code int PK, description text)`
- `type_document (id int PK, libelle text, description text)`
- `groupe (id int PK, libelle text)`
- `communes (code_insee varchar(5) PK, nom text, code_postal varchar(5))`
- `una (id serial PK, unite int, numero int, annee int, type_document int, groupe int, synthese text, urgent bool, sensible bool, commune varchar(5), nigend_de text, date_limit timestamptz, date_submit timestamptz, UNIQUE(unite,numero,annee))`

`IF NOT EXISTS` partout. Rôles : `CREATE ROLE rgp_api LOGIN; CREATE ROLE iaka_ro LOGIN;` + GRANT SELECT/INSERT/UPDATE/DELETE pour `rgp_api`, SELECT pour `iaka_ro`.

- [ ] **Step 4: `seed/minimal.sql`**

```sql
INSERT INTO unite (code, description) VALUES (12345, 'COB Démo') ON CONFLICT DO NOTHING;
INSERT INTO type_document (id, libelle, description) VALUES (1, 'PV', 'Procès-verbal') ON CONFLICT DO NOTHING;
INSERT INTO groupe (id, libelle) VALUES (1, 'Démo') ON CONFLICT DO NOTHING;
INSERT INTO communes (code_insee, nom, code_postal) VALUES ('49001', 'Segré-en-Anjou Bleu', '49500') ON CONFLICT DO NOTHING;
INSERT INTO una (unite, numero, annee, type_document, groupe, synthese, urgent, sensible, commune, date_submit)
VALUES (12345, 1, 2026, 1, 1, 'Procédure de démonstration — faits fictifs.', false, false, '49001', now())
ON CONFLICT DO NOTHING;
-- perquisition + objet : INSERT ... SELECT id FROM una WHERE unite=12345 AND numero=1 AND annee=2026
```

Objet : catégorie `TELEPHONE`, scellé `SC-DEMO-1`, pas de `photo_url` (MinIO optionnel). Adresse fictive « 1 rue de la Gendarmerie, 49500 Segré-en-Anjou Bleu ».

- [ ] **Step 5: Documenter dans wiki (Task 9) la commande**

`docker compose exec postgres psql -U sesame -d rgp -f /migrations/...` — le compose RGP doit monter `migrations/` et `seed/` ou un entrypoint `node` qui applique les SQL au boot. **Préférer un petit `server/rgp-api/migrate.js`** déjà ? S’il n’existe pas : `infra/postgres/init` ne peut pas lire les fichiers du service. Solution : entrypoint rgp-api :

```sh
for f in /app/migrations/*.sql; do psql "$DATABASE_URL" -f "$f" || true; done
psql "$DATABASE_URL" -f /app/seed/minimal.sql || true
exec node server.js
```

`psql` n’est pas dans `node:20-alpine`. Mieux : script Node `migrate.mjs` avec `pg` (déjà dépendance rgp-api) qui lit les fichiers et `client.query`. Test unitaire : ordre des fichiers `000` puis `001`…

Minimal : `server/rgp-api/migrate.js` :

```js
const fs = require("fs");
const path = require("path");
async function migrate(pool, dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    await pool.query(fs.readFileSync(path.join(dir, f), "utf8"));
  }
}
module.exports = { migrate };
```

Test : faux pool capture les SQL, premier fichier `000_base.sql`.

CMD Dockerfile rgp : `node -e 'require("./migrate").run().then(()=>require("./server"))'` trop sale. CMD : `node start.js` avec `start.js` = migrate puis listen.

- [ ] **Step 6: Tests + commit**

```bash
npm test --prefix server/rgp-api
git add server/rgp-api/migrations/000_base.sql server/rgp-api/seed server/rgp-api/migrate.js server/rgp-api/start.js server/rgp-api/Dockerfile
git commit -m "feat: schéma RGP de base et seed de démonstration"
```

---

### Task 8: rens-api — chemins IAKA + audit nocturne off

**Files:**
- Modify: `server/rens-api/audit/iaka.mjs` — `executePath` / `statusPath` comme le BFF
- Modify: `server/rens-api/audit/iaka.test.mjs` (créer si absent) — custom paths
- Modify: `server/rens-api/server.js` ou `nightly.mjs` — ne pas lancer le cron si `AUDIT_NIGHTLY !== '1'`
- Modify: compose rens-api `AUDIT_NIGHTLY=0`

**Interfaces:**
- Même contrat que `server/iaka.mjs` pour les chemins.

- [ ] **Step 1: Test chemins custom** (même structure que Task 2 `iaka.test.mjs`)

- [ ] **Step 2: Implémenter lecture `cfg.executePath || '/workflows/execute'`**

- [ ] **Step 3: Guard nightly**

```js
if (process.env.AUDIT_NIGHTLY === "1") { /* schedule existant */ }
```

Test : importer le module de boot n’appelle pas `execWorkflow` si unset (si le schedule est dans `server.js`, extraire `shouldRunNightly(env) → boolean`).

```js
export function shouldRunNightly(env) { return env.AUDIT_NIGHTLY === "1"; }
```

- [ ] **Step 4: `npm test --prefix server/rens-api` PASS + commit**

```bash
git commit -m "feat: rens-api IAKA configurable, audit nocturne opt-in"
```

---

### Task 9: Wiki (`docs/wiki/*.md`)

**Files:**
- Create: `docs/wiki/Home.md`
- Create: `docs/wiki/Prerequis.md`
- Create: `docs/wiki/Build-hors-ligne.md`
- Create: `docs/wiki/Installation.md`
- Create: `docs/wiki/Brancher-IAKA.md`
- Create: `docs/wiki/Importer-les-dumps.md`
- Create: `docs/wiki/Pages-de-l-application.md`
- Create: `docs/wiki/Exploitation.md`
- Create: `docs/wiki/Depannage.md`
- Create: `docs/wiki/Changelog-install.md`
- Modify: `README.md` — liens relatifs `docs/wiki/`

**Interfaces:**
- Aucun secret. Aucun `kerjean` / Cloudflare / GHCR.
- Publier vers le Wiki GitHub : `git clone https://github.com/BarthGve/sesame-standalone.wiki.git` puis copier les md (Home.md → `Home.md`).

Contenu **obligatoire** (écrire les fichiers complets, pas des stubs) :

**Home.md** — but air-gap, schéma (BFF seul ingress, IAKA externe), git vs dumps, liens.

**Prerequis.md** — Docker 24+, 8 Go RAM min (16 reco), disque 20 Go sans dumps / + tuiles selon archive, IAKA joignable sur le LAN, archives optionnelles (bdsp dump, minio, tuiles, addok).

**Build-hors-ligne.md** :

```bash
docker compose build
docker compose save -o sesame-images.tar   # si compose save indispo :
docker save -o sesame-images.tar $(docker compose config --images)
# USB → serveur
docker load -i sesame-images.tar
```

**Installation.md** — `cp .env.example .env`, remplir IAKA_*, `docker compose up -d`, `curl -s localhost/health`, `curl -s localhost/api/ready`. Seeds auto rgp + rens.

**Brancher-IAKA.md** — tableau variable ↔ page. MCP HTTP : `http://rgp-api:8080`, `http://rens-api:8080`, `http://cote-api:8082` **depuis le réseau Docker d’IAKA** (si IAKA n’est pas sur ce réseau : publier les API en interne machine et documenter `http://<ip-docker-bridge>:port`). Postgres BDSP : hôte `postgres` base `bdsp` user `iaka_ro`. `app_id` vide = page « non configuré ».

**Importer-les-dumps.md** — `pg_restore -d bdsp dump.fc`, `mc cp` photos, tuiles `MAP_TILES_URL=http://tiles:8080/{z}/{x}/{y}.png`, Addok `BAN_API_URL=http://addok:7878`. Chaque skip → dégradation (fond vide, BAN [], carte sans couches BDSP).

**Pages-de-l-application.md** — une section par route `/`, `/app/accueil`, `/app/carte`, `/app/saisies`, `/app/rgp`, `/app/frs`, `/app/qualite`, `/app/synthese`, `/app/pvtransport`, `/app/evaluation`, `/app/ariane` (vérifier les paths dans `src/App.tsx` et coller les vrais).

**Exploitation.md** — `docker compose logs -f bff`, jobs mémoire, backup `pg_dump`, pas d’auth UI.

**Depannage.md** — `IAKA_UNAVAILABLE`, `IAKA_UPSTREAM`, 422 prompt, tuiles 404, BAN [], photo 404, `/api/ready` iaka:false.

**Changelog-install.md** — `MAP_TILES_URL`, `BAN_API_URL`, `IAKA_EXECUTE_PATH`, `IAKA_STATUS_PATH`, `AUDIT_NIGHTLY`.

- [ ] **Step 1: Écrire les 10 fichiers**
- [ ] **Step 2: Grep secrets**

```bash
rg -n 'kerjean|Cloudflare|ghcr\.io|IAKA_JWT=.+' docs/wiki
```

Expected: aucun match (sauf mention « ne pas mettre de JWT dans le wiki »).

- [ ] **Step 3: Publier le wiki** (après push du repo)

```bash
gh repo sync  # repo déjà créé
# activer wiki sur GitHub si besoin, puis :
git clone https://github.com/BarthGve/sesame-standalone.wiki.git /tmp/sesame-wiki
cp docs/wiki/*.md /tmp/sesame-wiki/
# Home.md doit s'appeler Home.md
cd /tmp/sesame-wiki && git add -A && git commit -m "docs: wiki d'installation air-gap" && git push
```

- [ ] **Step 4: Commit git principal**

```bash
git add docs/wiki README.md
git commit -m "docs: wiki d'installation standalone"
```

---

### Task 10: CI standalone + filet anti-cloud

**Files:**
- Modify: `.github/workflows/ci.yml` — retirer le job docker qui tag `demo-iaka:ci` ou le renommer `sesame-standalone:ci` **sans push**
- Delete: s’ils ont survécu, `deploy.yml` / `release.yml`
- Create: `scripts/check-airgap.sh` — grep CI

**Interfaces:**
- CI = lint, `tsc -b`, `npm test`, `test:bff`, `test:rens`, `test:rgp`, `test:cote`, `docker compose config`

- [ ] **Step 1: `scripts/check-airgap.sh`**

```bash
#!/bin/sh
set -e
# Échec si une URL cloud réapparaît dans le runtime
if rg -n 'kerjean\.net|data\.geopf\.fr|api-adresse\.data\.gouv\.fr|lasuite\.numerique\.gouv\.fr|static\.suite\.anct\.gouv\.fr' \
  src server --glob '!*.md' ; then
  echo "airgap: URL cloud dans src/ ou server/" >&2
  exit 1
fi
```

Test local : `sh scripts/check-airgap.sh` exit 0 après Task 5.

- [ ] **Step 2: `ci.yml`**

Jobs : `test` (comme aujourd’hui, Node 20) + step `sh scripts/check-airgap.sh` + `docker compose config`. Job `docker` : `docker build -t sesame-standalone:ci .` sans login registry.

- [ ] **Step 3: Lancer localement**

```bash
npm run lint && npx tsc -b && npm test && npm run test:bff && npm run test:rens && npm run test:rgp && npm run test:cote
sh scripts/check-airgap.sh
docker compose config
```

Expected: tout vert. Ne pas affirmer sans l’avoir exécuté.

- [ ] **Step 4: Commit + push**

```bash
git add .github/workflows/ci.yml scripts/check-airgap.sh
git commit -m "ci: lint, tests, filet air-gap, pas de registry"
git push
```

---

## Self-review (spec coverage)

| Spec § | Task |
|---|---|
| Nouveau dépôt, OVH intact | 1 |
| IAKA knobs + app_id vides | 2, 6 |
| `IAKA_UNAVAILABLE` | 2 |
| `/api/config` `/api/ready` | 3 |
| BAN + tuiles same-origin | 4, 5 |
| La Gaufre out, IGN out | 5 |
| Compose, pas GHCR | 6 |
| Seeds git, dumps wiki | 7, 9 |
| Auth UI none | 2 (CF retiré), 6 |
| rens nightly off | 8 |
| Wiki 10 pages | 9 |
| Tests + CI | 5, 10 |
| MCP recâblage documenté pas automatisé | 9 Brancher-IAKA |

Écart volontaire vs spec §7 « booléens uniquement » : `tilesUrl` est un **chemin relatif** `/api/tiles/{z}/{x}/{y}` (pas d’hôte, pas de secret) — nécessaire à MapLibre.

---

## Notes d’exécution

- Travailler **dans** `sesame-standalone`, jamais merger ces commits sur `demo-iaka`.
- Ne pas lancer `npm run release`.
- IAKA n’est pas un service compose : si l’équipe IAKA n’a pas encore l’API, `/api/ready` → `iaka: false` et les pages agent affichent l’erreur stable.
)
