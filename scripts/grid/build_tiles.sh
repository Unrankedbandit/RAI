#!/usr/bin/env bash
# Bake agent_backend/data/grid/grid.pmtiles from lines.geojson + substations.geojson.
# Recipe per contract (parcel-research/reports/10-grid-v1-contract.md section 1):
#   -zg --drop-densest-as-needed --extend-zooms-if-still-dropping
#   -y kv -y volt_class -y owner -y status -y source -y name   (keep normalized attrs)
#   -Ltransmission:lines.geojson -Lsubstations:substations.geojson  (two layers)
#   >=230 kV only below z8 via -j feature filter (installed tippecanoe v2.82.0 supports it;
#   filter only targets the transmission layer by testing for the 'kv' attr).
#
# tippecanoe used: built from source (github.com/felt/tippecanoe, v2.82.0) at
#   /tmp/opencode/tippecanoe/tippecanoe   (npm 'tippecanoe' pkg is a wrapper lib, no binary)
# Re-runnable: bash scripts/grid/build_tiles.sh [path-to-tippecanoe]
set -euo pipefail

TIPPECANOE="${1:-/tmp/opencode/tippecanoe/tippecanoe}"
DATA_DIR="$(cd "$(dirname "$0")/../../agent_backend/data/grid" && pwd)"
cd "$DATA_DIR"

[ -x "$TIPPECANOE" ] || { echo "tippecanoe not found at $TIPPECANOE"; exit 1; }
[ -f lines.geojson ] && [ -f substations.geojson ] || {
  echo "run scripts/grid/fetch_grid_data.py first"; exit 1; }

# -j filter per contract: "transmission" layer keeps a feature below z8 only if
# kv >= 230 (unknown-kv lines are also dropped below z8 -- strictest contract reading:
# ">=230kV-only below z8"). Substations layer is unfiltered (not named in the filter).
# Syntax notes (tippecanoe v2.82.0): comparison ops take a bare attribute-name string
# key (["get",...] is NOT supported -> "comparison key is not a string"); "$zoom" is
# the special zoom key; negation is "!has" (there is no ["!", ...] operator).
read -r -d '' FILTER <<'JSON' || true
{"transmission": ["any", [">=", "kv", 230], [">=", "$zoom", 8]]}
JSON

# NOTE: -j per-layer filters keyed by layer name ("transmission": ...) are supported in
# tippecanoe >= 2.x. Substation layer is unfiltered (not named in the filter).
"$TIPPECANOE" \
  -zg \
  --drop-densest-as-needed \
  --extend-zooms-if-still-dropping \
  -y kv -y volt_class -y owner -y status -y source -y name \
  -j "$FILTER" \
  -Ltransmission:"$DATA_DIR/lines.geojson" \
  -Lsubstations:"$DATA_DIR/substations.geojson" \
  -o "$DATA_DIR/grid.pmtiles" \
  --force

ls -la "$DATA_DIR/grid.pmtiles"
