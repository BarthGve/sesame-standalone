# SÉSAME standalone — installation air-gap

Démonstrateur des cas d’usage **IAKA** pour un serveur **coupé d’Internet**.
Ce dépôt contient le code, le compose et cette documentation d’install.
IAKA n’est **pas** livrée ici : c’est un produit tiers déjà posé sur le LAN,
joint par URL.

La démo cloud vit dans un autre dépôt. Ici : stack locale, seeds légers,
dumps lourds à part.

**Ne pas mettre de JWT dans le wiki.** Les identifiants de workflows (`app_id`)
et les secrets restent dans le `.env` de la machine, jamais dans git ni ces pages.

## But

Installer, sur un serveur hors Internet, la stack SÉSAME (front + BFF +
rgp-api + rens-api + cote-api + Postgres/PostGIS + MinIO) **à côté** d’une
instance IAKA déjà disponible, et faire tourner tout le démonstrateur
(accueil, carte, perquisitions, RGP, FRS, synthèse, PV transport, évaluation,
Ariane) en appelant les API IAKA locales.

Le navigateur n’appelle **jamais** IAKA ni un service externe : même origine
que le BFF (port LAN **80**).

## Schéma

Seul ingress LAN : le BFF (port hôte `80` → conteneur `8787`).
Les API internes, Postgres et MinIO ne sont pas publiés sur le LAN
(sauf Postgres `5432` avec le profil `debug`).

```
[ Navigateur LAN ]  HTTP, pas d'auth UI
        │
        ▼
[ BFF : SPA statique + /api/* ]     ← seul ingress (80 → 8787)
        ├── IAKA (externe)          IAKA_BASE_URL + JWT + tenant + app_id
        ├── rgp-api (interne)       :8080
        ├── rens-api (interne)      :8080
        └── cote-api (interne)      :8082

Réseau Docker interne (non publié sur le LAN, hors profil debug) :
  postgres  — bases rgp, rens, bdsp (PostGIS)
  minio     — bucket perquisitions
  rgp-api → postgres (rgp) + minio
  rens-api → postgres (rens)
```

IAKA parle ensuite aux MCP HTTP (`rgp-api`, `rens-api`, `cote-api`) et à
Postgres `bdsp` (utilisateur `iaka_ro`) — voir [Brancher IAKA](Brancher-IAKA.md).

## Git vs dumps

| Dans git (léger) | Hors git (archives, wiki d’import) |
|---|---|
| Code front / BFF / microservices | Dump Postgres `bdsp` (carte) |
| `docker-compose.yml`, `.env.example` | Photos MinIO (optionnel) |
| Seed RGP minimal UNA `12345/1/2026` | Archive de tuiles carto |
| Seed FRS (`server/rens-api/seed/`) | Dump Addok / BAN (optionnel) |
| Catalogue cote simulé | |

Sans dump : l’application démarre quand même, en mode dégradé
(fond de carte vide, BAN `[]`, couches BDSP vides, photos 404).
Voir [Importer les dumps](Importer-les-dumps.md).

## Parcours d’install

1. [Prérequis](Prerequis.md) — machine, Docker, IAKA joignable, archives
2. [Build hors ligne](Build-hors-ligne.md) — `compose build` / `save` / `load`
3. [Installation](Installation.md) — `.env`, `up -d`, `/health`, `/api/ready`
4. [Brancher IAKA](Brancher-IAKA.md) — URL, JWT, tenant, `app_id`, MCP
5. [Importer les dumps](Importer-les-dumps.md) — BDSP, MinIO, tuiles, BAN
6. [Pages de l’application](Pages-de-l-application.md) — routes réelles
7. [Exploitation](Exploitation.md) — logs, jobs, backup
8. [Dépannage](Depannage.md) — codes d’erreur stables
9. [Changelog install](Changelog-install.md) — variables d’environnement

Santé : `GET /health` (processus BFF). Diagnostic d’install : `GET /api/ready`.
