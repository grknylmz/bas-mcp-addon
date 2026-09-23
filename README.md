# BAS MCP Addon

`bas-mcp-addon` installs the `bas-vsp-mcp` command for SAP Business Application Studio (BAS). It discovers eligible BAS ABAP destinations and exposes them through the Model Context Protocol (MCP) using the VSP binary.

Requires Node.js 20 or newer.

## Installation

Install globally with npm from a BAS dev space:

```sh
npm install --global bas-mcp-addon
```

The install lifecycle performs two provisioning steps automatically:

1. Detects Go from `GO_BINARY`, `PATH`, or the package-local Go installation. If Go is missing, it downloads and installs the pinned supported Go release without prompting.
2. Uses the package's checksum-verified patched VSP binary for the current platform. A remote download is only used when the package does not contain a bundled asset.

In a BAS terminal, the installer then discovers eligible ABAP destinations and asks which systems should be configured as MCP servers. The walkthrough is skipped when `H2O_URL` is absent or no controlling terminal is available.
The installer also reports directly to the terminal whether BAS discovery was skipped, found no eligible destinations, or configured MCP servers. npm may hide normal lifecycle output; the direct terminal report remains visible when the install runs from an interactive shell.
When npm runs the lifecycle script with piped stdin, the installer reuses the controlling terminal for BAS discovery so the destination list and selection prompt remain interactive.

If a setup step is skipped or fails, rerun it from an interactive BAS terminal:

```sh
bas-vsp-mcp --setup
```

For a non-interactive installation or a platform without a published VSP asset, provide a trusted binary override:

```sh
BAS_VSP_BINARY=/path/to/vsp npm install --global bas-mcp-addon
```

After setup completes, the installer prints every generated MCP server name and its BAS destination, followed by the connection steps. In BAS/VS Code:

1. Open the Command Palette.
2. Run **MCP: List Servers**.
3. Select a printed `basVspMcp_*` server and choose **Start Server**.

Use **MCP: Open User Configuration** to inspect or edit the generated entries. Each entry is isolated to its displayed `BAS_VSP_DESTINATION`.

## BAS setup

`bas-vsp-mcp --setup` uses `H2O_URL/api/listDestinations` to find destinations that have:

- `WebIDEEnabled=true`
- `HTML5.DynamicDestination=true`
- `WebIDEUsage=dev_abap` (when present)

Each displayed destination includes its name, SAP client, authentication type, and probe status. Press Enter to select all probe-available systems, or enter one of:

- `all` — select available and unavailable displayed systems
- `none` — remove this package's generated MCP entries
- `1,3` — select displayed systems by number; unavailable systems may be selected explicitly

The setup reconciles only entries whose names start with `basVspMcp_`. Existing unrelated MCP servers and top-level configuration such as `inputs` are preserved.

Each selected system receives one isolated stdio MCP entry similar to:

```json
{
  "type": "stdio",
  "command": "bas-vsp-mcp",
  "env": {
    "H2O_URL": "https://bas.example",
    "BAS_VSP_DESTINATION": "DEV_ABAP"
  },
  "BAS_EXT": "true"
}
```

Credentials, cookies, SAP usernames, passwords, and raw BAS destination payloads are not written to the MCP configuration.

## MCP configuration location

The configuration path is selected in this order:

1. `BAS_VSP_MCP_CONFIG`
2. Existing `$HOME/.vscode/data/User/mcp.json`
3. Existing `$HOME/.vscode-server/data/User/mcp.json`
4. Existing `$HOME/.code-server/data/User/mcp.json`
5. `$HOME/.vscode/data/User/mcp.json` as the default

Set `BAS_VSP_MCP_CONFIG` when the BAS deployment uses a different user-data location:

```sh
BAS_VSP_MCP_CONFIG="$HOME/.vscode/data/User/mcp.json" bas-vsp-mcp --setup
```

The file must be strict JSON with an object-valued `servers` property. Existing malformed or incompatible files are rejected without overwriting them.

## Commands

Run the interactive configuration walkthrough:

```sh
bas-vsp-mcp --setup
```

List discovered systems and probe status:

```sh
bas-vsp-mcp --list-destinations
```

Use machine-readable, redacted diagnostic output:

```sh
bas-vsp-mcp --list-destinations --json
```

Check destination availability without starting the MCP server:

```sh
bas-vsp-mcp --check
```

With `H2O_URL` set, the normal command starts the MCP proxy. Each generated MCP entry supplies one `BAS_VSP_DESTINATION`, so that entry exposes only its selected BAS system.

Without `H2O_URL`, the command passes arguments directly through to the installed VSP binary. This preserves direct VSP usage outside BAS.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `H2O_URL` | BAS endpoint used to discover destinations. Required for BAS discovery. |
| `BAS_VSP_DESTINATION` | Comma-separated destination allowlist for normal runtime discovery. Setup clears this temporarily so it can display all eligible systems. |
| `BAS_VSP_MCP_CONFIG` | Explicit MCP user configuration path. |
| `BAS_VSP_BINARY` | Trusted prebuilt VSP executable; skips Go and binary provisioning. |
| `BAS_VSP_BINARY_URL` | Alternate VSP binary download URL. |
| `BAS_VSP_CACHE_DIR` | Binary cache directory. |
| `GO_BINARY` | Explicit Go executable used for provisioning when automatic Go installation is unavailable. |
| `BAS_VSP_SKIP_PROBE=true` | Skip destination probes; useful for controlled diagnostics or fixtures. |
| `HTTP_PROXY` / `HTTPS_PROXY` | BAS proxy settings used for destination probing and child processes. |
| `NO_PROXY` | Proxy bypass list; `.dest` hosts remain routed through the BAS proxy. |

## Troubleshooting

If no systems are listed, verify the BAS endpoint and destination metadata:

```sh
curl "$H2O_URL/api/listDestinations"
bas-vsp-mcp --list-destinations --json
```

Eligible destinations must be BAS-enabled dynamic ABAP destinations. The backend must also be reachable through the BAS proxy at `/sap/bc/adt`.
If automatic Go or VSP provisioning fails, check network access and the package's supported platform. You can install Go manually or set `GO_BINARY` as an explicit fallback. A trusted prebuilt VSP can be supplied with `BAS_VSP_BINARY`.

## Development

Run the built-in Node.js test suite:

```sh
npm test
```

The package repository is [oisee/bas-mcp-addon](https://github.com/oisee/bas-mcp-addon).
