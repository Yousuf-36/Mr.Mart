# Mr. Mart — MCP Server Config

How to point your MCP client at the Mr. Mart MCP server so its tools (`mrmart_*`) show up in the tool list and can be called directly.

---

## 1. Start the server locally first

The `serverUrl` config connects to an **already-running** HTTP server — unlike a `command`-based stdio config, it does not launch the process for you.

```bash
cd packages/mcp-server
npm install
npm run dev
```

Confirm it's up: you should see `Mr. Mart MCP server listening on http://localhost:3333/mcp` in the terminal.

## 2. Add the config

1. Open your MCP client.
2. Open raw MCP config (`.agents/mcp_config.json` in project root).
3. Merge in the config:

```json
{
  "mcpServers": {
    "mrmart": {
      "serverUrl": "http://localhost:3333/mcp"
    }
  }
}
```

> **Note:** Use `serverUrl`, not `url`, for HTTP-based servers.

4. Restart your client for the change to take effect.
5. You should see `mrmart` listed with its tools (`mrmart_get_stock_levels`, `mrmart_draft_reorder`, `mrmart_approve_action`, etc.).

## 3. Production / staging config

Once the Backend service is deployed (per `01_Project_Instructions.md` Section 8) behind a real domain and auth:

```json
{
  "mcpServers": {
    "mrmart": {
      "serverUrl": "https://api.mrmart.yourdomain.com/mcp",
      "headers": {
        "Authorization": "Bearer <YOUR_MRMART_API_TOKEN>"
      }
    }
  }
}
```

Replace the URL with your actual deployed Backend endpoint and the token with a real credential — never commit a filled-in version of this file to source control (see `05_Security_and_Compliance.md` Section 5 on secrets).

**Important per the security doc:** only **read** and **decide** tools (`mrmart_get_*`, `mrmart_list_pending_actions`, `mrmart_approve_action`, `mrmart_reject_action`) should ever be reachable at this public Backend URL. **Draft** and **execute** tools (`mrmart_draft_*`) belong to the Worker process and must not be exposed on this endpoint at all.

## 4. A note on tool count

Keep total enabled tools under ~50 for best performance. Mr. Mart's full tool set across all 7 automations (read + draft + decide + execute) lands well under that on its own.

## 5. Using it in a prompt

Once connected, you can reference tools directly in a prompt, e.g.:

> "Using the `mrmart` MCP tools, build the Approval Queue screen that calls `mrmart_list_pending_actions` and renders each item as an Approval Card per the design system in `01_Project_Instructions.md`."

This keeps the frontend prompt grounded in the actual tool contract.

---

## For other MCP clients (Claude Desktop / Claude Code)

If you also want to poke at the server from Claude Desktop or Claude Code while developing, the equivalent config (using `url` instead of `serverUrl`) is:

```json
{
  "mcpServers": {
    "mrmart": {
      "url": "http://localhost:3333/mcp"
    }
  }
}
```

Claude Desktop: `claude_desktop_config.json`. Claude Code: `claude mcp add --transport http mrmart http://localhost:3333/mcp`.