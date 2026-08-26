# RAI — agent project rules

## Web Tools

### Tavily Search API (search)

Coding assistants (opencode) get Bright Data's MCP server automatically from
the version-controlled project config at `.opencode/opencode.json` — it reads
`$BRIGHTDATA_API_TOKEN` from the environment, so no secret is committed.
Restart the assistant after cloning; then `scrape_as_markdown`, `search_engine`,
and `scrape_batch` are native tools in the terminal — no dashboard round-trips.

Tool: `tavily_search(query, max_results=5)` in `agent_backend/tools.py`.

- Endpoint: `POST https://api.tavily.com/search`
- Auth: `Authorization: Bearer $TAVILY_API_KEY`
- Body: `{query, max_results, search_depth: "basic"}`
- Env: `TAVILY_API_KEY` (required for live calls; from https://app.tavily.com),
  `TAVILY_TIMEOUT_S` (default `30`)
- Returns structured JSON formatted as markdown: titles, URLs, content snippets
- Without a token, falls back to `kb_lookup` (offline knowledge base)

### Bright Data Web Unlocker (scraping)

Tool: `brightdata_scrape(url, expect="")` in `agent_backend/tools.py`,
whitelisted for the `data_scout` role (`agent_backend/agents/roles.py`).

- Endpoint: `POST https://api.brightdata.com/request` (Web Unlocker API)
- Auth: `Authorization: Bearer $BRIGHTDATA_API_TOKEN`
- Body: `{zone, url, format: "raw", data_format: "markdown"}`; the repair
  fetch adds `render: "true"` (JS rendering)
- Env: `BRIGHTDATA_API_TOKEN` (required for live calls),
  `BRIGHTDATA_ZONE` (code default `web_unlocker1`; this project uses
  `mcp_unlocker` — auto-created by the MCP server on first scrape, set in
  `agent_backend/.env`),
  `BRIGHTDATA_TIMEOUT_S` (default `60`)

### Validation + repair policy (brightdata_scrape)
- A scrape is valid when the body is non-empty AND every comma-separated
  `expect` marker appears (case-insensitive).
- On validation failure: emit `scraper.repair` (warn) with url + reason,
  re-fetch with `render: "true"`, return the rendered markdown even if markers
  stay missing — the stale markers, not the pipeline, were wrong; emit
  `scraper.repaired` listing which markers went stale.
- On transport failure or empty repair: emit `scraper.failed` (error) and
  return `""` — never raise into an agent run.
- No Bright Data AI-extract REST endpoint is documented (their `extract` tool
  is MCP-only, AI-sampled client-side), so repair = escalating re-fetch,
  not a guessed endpoint.

### Fallback chain (data_scout)
1. `brightdata_scrape` — known source URL, token set (bot detection/CAPTCHA)
2. `tavily_search` — source discovery (Tavily Search API)
3. `web_fetch` — direct page fetch with httpx (simple pages, no bot detection)
4. `kb_lookup` — offline knowledge base, final fallback

With no token, each tool emits a skip/warn event, returns empty, and the agent
falls through the chain.

### Verifying changes
Run mocked tests (no key needed): `.venv/bin/python scripts/test-brightdata.py`
Then the full gate: `PATH="$PWD/.venv/bin:$PATH" node scripts/check-all.mjs`
