#!/usr/bin/env bash
# Vercel's build (vercel.json buildCommand): nothing is compiled, web/ is served as it is. It leaves any
# video out of the deployment and writes web/version.json for the page (the release reads as the
# VERSION and the commit, as GitHub Pages' reads as the VERSION and the run number: .github/workflows/pages.yml).
# A script, not a line in vercel.json: Vercel refuses a buildCommand longer than 256 characters.
set -eu
cd "$(dirname "$0")/.."
find web/data \( -name '*.mp4' -o -name '*.webm' \) -delete
v=$(tr -d '[:space:]' < VERSION)
c=${VERCEL_GIT_COMMIT_SHA:-}
printf '{"version":"%s","release":"%s+%.7s","commit":"%s","built":"%s"}' "$v" "$v" "$c" "$c" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > web/version.json
