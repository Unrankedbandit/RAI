#!/usr/bin/env bash
# Bake agent_backend/data/grid/scores.pmtiles from scored parcel geojsonl.
# Recipe per contract (parcel-research/reports/10-grid-v1-contract.md section 8b):
#   -zg --drop-densest-as-needed --extend-zooms-if-still-dropping
#   -y score -y gated -y dist_mi -y kv -y acres   (keep score attrs)
#   one layer: -Lscores:<file>
#
# tippecanoe: built from source (same binary as scripts/grid/build_tiles.sh).
# Re-runnable: bash scripts/score/bake_scores.sh [scored.geojsonl ...]
#   With no args, bakes every *.scored.geojsonl in the scores dir.
set -euo pipefail

TIPPECANOE="/tmp/opencode/tippecanoe/tippecanoe"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCORES_DIR="${RAI_SCORES_DIR:-$REPO_ROOT/agent_backend/data/scores}"
DATA_DIR="$REPO_ROOT/agent_backend/data/grid"
OUT="${SCORES_PMTILES_OUT:-$DATA_DIR/scores.pmtiles}"

[ -x "$TIPPECANOE" ] || { echo "tippecanoe not found at $TIPPECANOE"; exit 1; }

if [ "$#" -gt 0 ]; then
  INPUTS=("$@")
else
  shopt -s nullglob
  INPUTS=("$SCORES_DIR"/*.scored.geojsonl)
fi
[ "${#INPUTS[@]}" -gt 0 ] || {
  echo "no scored geojsonl — run scripts/score/score_parcels.py first"; exit 1; }

LARGS=()
for f in "${INPUTS[@]}"; do
  LARGS+=("-Lscores:$(cd "$(dirname "$f")" && pwd)/$(basename "$f")")
done

# tippecanoe reads newline-delimited GeoJSON natively (geojsonl); multiple
# -Lscores: inputs merge into the single contract layer "scores".
"$TIPPECANOE" \
  -zg \
  --drop-densest-as-needed \
  --extend-zooms-if-still-dropping \
  -y score -y gated -y dist_mi -y kv -y acres \
  "${LARGS[@]}" \
  -o "$OUT" \
  --force

ls -la "$OUT"
