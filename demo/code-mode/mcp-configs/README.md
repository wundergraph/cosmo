# Code Mode MCP Client Configs

These snippets connect MCP clients to the Code Mode demo server at `http://localhost:5027/mcp`.
Start the demo first:

```bash
make code-mode-demo
```

The configs are illustrative.
Real users can adapt paths, server names, timeouts, and auth settings for their local setup.
Do not add API keys or auth tokens to these files.

## Claude Code

`claude.mcp.json` matches Claude Code's `mcpServers` settings schema for Streamable HTTP:

```json
{
  "mcpServers": {
    "yoko": {
      "type": "http",
      "url": "http://localhost:5027/mcp"
    }
  }
}
```

Run with the config snippet directly:

```bash
claude --mcp-config demo/code-mode/mcp-configs/claude.mcp.json --strict-mcp-config -p "$(cat demo/code-mode/mcp-configs/sample-prompts/01-search-employees.txt)"
```

Or install it into Claude Code project config:

```bash
claude mcp add --scope project --transport http yoko http://localhost:5027/mcp
```

Claude Code writes project-scoped MCP servers to `.mcp.json`.
Use `--scope user` instead if you want the server available outside this checkout.

## Claude Desktop

Claude Desktop only speaks stdio, so it cannot connect to the demo's HTTP MCP endpoint directly.
The demo ships a tiny `mcp-stdio-proxy` binary that bridges Claude Desktop's stdio transport to the upstream HTTP server.
`make code-mode-demo` builds it at `demo/code-mode/mcp-stdio-proxy/mcp-stdio-proxy`.

`claude.desktop.json` is the matching config:

```json
{
  "mcpServers": {
    "yoko": {
      "command": "/ABSOLUTE/PATH/TO/cosmo/demo/code-mode/mcp-stdio-proxy/mcp-stdio-proxy",
      "args": ["--upstream", "http://127.0.0.1:5027/mcp"]
    }
  }
}
```

Replace `/ABSOLUTE/PATH/TO/cosmo` with the absolute path to your checkout, then merge into `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows) and restart Claude Desktop.

## Codex CLI

`codex.toml` matches Codex CLI's `~/.codex/config.toml` table format:

```toml
[mcp_servers."yoko"]
url = "http://localhost:5027/mcp"
```

Install it by copying the table into `~/.codex/config.toml`, or add the same server with:

```bash
codex mcp add yoko --url http://localhost:5027/mcp
```

Then run a prompt with your normal Codex config:

```bash
codex exec --full-auto -- "$(cat demo/code-mode/mcp-configs/sample-prompts/02-execute-fetch.txt)"
```

To point one invocation at this snippet without editing your global config, pass equivalent config overrides:

```bash
codex exec --full-auto \
  -c 'mcp_servers.yoko.url="http://localhost:5027/mcp"' \
  -- "$(cat demo/code-mode/mcp-configs/sample-prompts/02-execute-fetch.txt)"
```

Codex does not currently expose a direct `--config-file` flag for `codex.toml`.
For an isolated run against the checked-in snippet, place it at `$CODEX_HOME/config.toml` in a temporary directory:

```bash
tmp_codex_home="$(mktemp -d)"
cp demo/code-mode/mcp-configs/codex.toml "$tmp_codex_home/config.toml"
CODEX_HOME="$tmp_codex_home" codex exec --full-auto -- "$(cat demo/code-mode/mcp-configs/sample-prompts/02-execute-fetch.txt)"
```

## Sample Prompts

`sample-prompts/01-search-employees.txt` asks the client to call `code_mode_search_tools` with two prompts in one batch.
Expected output shape: the assistant should show the newly returned TypeScript `tools` declarations for the first-employee operation and the employee-by-id operation.

`sample-prompts/02-execute-fetch.txt` asks the client to discover an employee-by-id operation and run `code_mode_run_js`.
Expected output shape: the assistant should show an `code_mode_run_js` result for employee `1`, returning the employee's `forename` and `surname`.

`sample-prompts/03-multi-tool.txt` asks the client to discover two operations and compose them in a single `code_mode_run_js` program.
Expected output shape: the assistant should return both the first employee and that employee's family from one sandbox execution.

`sample-prompts/04-mutation-not-approved.txt` asks the client to try an employee-tag mutation.
The historical prompt name mentions "not approved", but the demo config sets `require_mutation_approval: false` in `demo/code-mode/router-config.yaml`.
That means this prompt is not declined by operator approval in the default demo; it should run like a normal mutation if the mock can generate the operation.
Skip this prompt when you specifically need to demonstrate approval rejection.

## Caveat

The mock Yoko service shells out to the `codex` CLI for query generation.
The local `codex` CLI must be installed and authenticated before `code_mode_search_tools` can generate operations.
