#!/usr/bin/env bash
# LOD bake: agent_backend/data/grid/scores.pmtiles as a TWO-TIER archive —
#   z0-9:  layer `scorecells` — grid-cell mean-score choropleth from
#          bin_scores.py (the low-zoom LOD; raw parcels at low zoom are an
#          anti-pattern — Regrid serves none below z10 — and tippecanoe's
#          drop-as-needed alone throws away the score signal)
#   z10+:  layer `scores` — full scored parcels, the production recipe
#          (-pn keeps shared parcel nodes so adjacent boundaries don't
#          sliver when simplified)
# Merged with tile-join (disjoint zoom bands — no tile exceeds the 500K cap
# by combining, so tile-join's silent oversized-tile drop cannot trigger).
#
# Output goes to a temp file then atomic-mv's over SCORES_PMTILES_OUT
# (default: the live scores.pmtiles) so the served layer never half-writes.
#
# Usage: bash scripts/score/bake_scores_lod.sh [scored.geojsonl ...]
set -euo pipefail

TIPPECANOE="/tmp/opencode/tippecanoe/tippecanoe"
TILEJOIN="/tmp/opencode/tippecanoe/tile-join"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCORES_DIR="${RAI_SCORES_DIR:-$REPO_ROOT/agent_backend/data/scores}"
DATA_DIR="$REPO_ROOT/agent_backend/data/grid"
OUT="${SCORES_PMTILES_OUT:-$DATA_DIR/scores.pmtiles}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

if [ "$#" -gt 0 ]; then
  INPUTS=("$@")
else
  shopt -s nullglob
  INPUTS=("$SCORES_DIR"/*.scored.geojsonl)
fi
[ "${#INPUTS[@]}" -gt 0 ] || {
  echo "no scored geojsonl — run scripts/score/score_parcels.py first"; exit 1; }

echo "== binning cells"
"$REPO_ROOT/.venv/bin/python" "$REPO_ROOT/scripts/score/bin_scores.py" \
  "${INPUTS[@]}" -o "$TMP_DIR/scorecells.geojsonl"

echo "== cells tier (z0-9, keep every cell)"
"$TIPPECANOE" -Z0 -z9 -r1 -pk \
  -y score -y n -y gated -y acres \
  -Lscorecells:"$TMP_DIR/scorecells.geojsonl" \
  -o "$TMP_DIR/cells.pmtiles" --force

LARGS=()
for f in "${INPUTS[@]}"; do
  LARGS+=("-Lscores:$(cd "$(dirname "$f")" && pwd)/$(basename "$f")")
done

echo "== parcel tier (z10+, production recipe + shared-node simplify)"
"$TIPPECANOE" -Z10 -zg \
  --drop-densest-as-needed --extend-zooms-if-still-dropping \
  -pn \
  -y score -y gated -y dist_mi -y kv -y acres \
  "${LARGS[@]}" \
  -o "$TMP_DIR/parcels.pmtiles" --force

echo "== merge tiers"
"$TILEJOIN" -o "$TMP_DIR/merged.pmtiles" \
  "$TMP_DIR/cells.pmtiles" "$TMP_DIR/parcels.pmtiles" --force

mv "$TMP_DIR/merged.pmtiles" "$OUT.tmp"
mv "$OUT.tmp" "$OUT"
ls -la "$OUT"
