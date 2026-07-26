# Mr. Mart MCP Server

The data and action contract between the AI layer, the Backend, and the Frontend.

## Tool categories

| Category | Tools | Who calls them |
|---|---|---|
| **Read** | `mrmart_get_stock_levels`, `mrmart_get_sales_summary`, `mrmart_get_top_sellers`, `mrmart_get_today_activity` | Frontend (via Backend), publicly reachable |
| **Decide** | `mrmart_list_pending_actions`, `mrmart_get_action_detail`, `mrmart_approve_action`, `mrmart_reject_action` | Frontend (via Backend), publicly reachable |
| **Draft** | `mrmart_draft_reorder` … `mrmart_draft_day_close` (7 tools) | Worker only, system-only |
| **Execute** | `mrmart_execute_*` (7 functions) | Internal only — called **exclusively** from `mrmart_approve_action` |

**The golden rule (doc 02 §2):** `mrmart_approve_action` is the only code path that may call an execute function. This is enforced architecturally — execute tools are not registered on the MCP HTTP transport, only as internal functions. No network path to them exists.

## Run locally

```bash
cd packages/mcp-server
npm install
npm run dev
# → Mr. Mart MCP server listening on http://localhost:3333/mcp
```

## Connect MCP Client

The `.agents/mcp_config.json` at the repo root already has the right config:

```json
{ "mcpServers": { "mrmart": { "serverUrl": "http://localhost:3333/mcp" } } }
```

In your IDE: `... → MCP Servers → Manage MCP Servers → View raw config` — confirm `mrmart` appears with all tools listed.

## Stage status

| Stage | Data layer | Note |
|---|---|---|
| 0 (current) | In-memory mock (`src/store/mock-store.ts`) | All tools work, no persistence |
| 1 | Real Postgres queries | Replace mock-store functions with pg queries |
| 2+ | Full Worker integration | Draft tools called by scheduler, execute tools called after approval |

## Next steps (adding automations)

Per doc 02 §5: to add a new automation, follow this pattern from `mrmart_draft_reorder` → `mrmart_approve_action` → `mrmart_execute_reorder`:

1. Add a draft tool to `src/tools/draft.ts` following the same shape
2. Add its execute function to `src/tools/execute.ts` and wire it into `executeByType`
3. The decide layer (`mrmart_approve_action`) dispatches automatically via the type
4. Add the matching Postgres query in Stage 1 when replacing the mock store

Tool signatures must not change between Stage 0 and Stage 1 — the Frontend is built against this contract.
