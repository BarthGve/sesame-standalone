#!/bin/sh
set -e
# Exclude *.test.* — negative assertions may mention banned hostnames.
PATTERN='kerjean\.net|data\.geopf\.fr|api-adresse\.data\.gouv\.fr|lasuite\.numerique\.gouv\.fr|static\.suite\.anct\.gouv\.fr'

if command -v rg >/dev/null 2>&1; then
  if rg -n "$PATTERN" src server --glob '!*.md' --glob '!*.test.*'; then
    echo "airgap: URL cloud dans src/ ou server/" >&2
    exit 1
  fi
else
  # Ubuntu CI images lack ripgrep; fall back to grep -R
  if grep -R -n -E "$PATTERN" src server \
    --exclude='*.md' \
    --exclude='*.test.ts' \
    --exclude='*.test.tsx' \
    --exclude='*.test.mjs' \
    --exclude='*.test.js' \
    --exclude-dir=node_modules; then
    echo "airgap: URL cloud dans src/ ou server/" >&2
    exit 1
  fi
fi
