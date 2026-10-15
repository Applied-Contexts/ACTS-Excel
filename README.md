# ACTS Excel

A local [Model Context Protocol](https://modelcontextprotocol.io/) server for spreadsheet analysis with DuckDB SQL. Import XLSX, CSV, TSV, Parquet, or JSON; query and transform the data; inspect compact previews; recover complete values; and export results. MCP Apps clients also show an interactive table, chart, and export view. Other stdio MCP clients receive the same tools and text results.

ACTS Excel requires **Node.js 22+ and npm** in the environment where your MCP client runs commands. It does not require Microsoft Excel, Python, an API key, or a hosted server. On Windows, install the [Visual C++ Redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist/) if it is not already present.

## Install in ChatGPT desktop

Download **[ACTS-Excel-0.0.5-chatgpt.zip](https://github.com/Applied-Contexts/ACTS-Excel/releases/download/v0.0.5/ACTS-Excel-0.0.5-chatgpt.zip)** and import it using ChatGPT's plugin ZIP import. Use the plugin in a local task with local execution enabled. The same ZIP works with Windows, macOS, Linux, and WSL; there is no architecture selection.

The plugin runs `npx` with an exact versioned npm archive hosted in this repository's GitHub release. npm downloads and caches the server and selects DuckDB's native dependency for the actual Node process. The first XLSX operation installs DuckDB's signed Excel extension. Initial setup needs internet access to GitHub, the npm registry, and DuckDB's extension repository. Spreadsheet contents are not sent to these services.

For an explicit setup check, or a client with a short startup timeout, run this once in the client's execution environment before connecting:

```sh
npx --yes --package=https://github.com/Applied-Contexts/ACTS-Excel/releases/download/v0.0.5/acts-excel-0.0.5.tgz acts-excel --setup
```

Wait for **“ACTS Excel is ready”**, then reconnect the plugin. This fills npm's cache and installs the Excel extension. If ChatGPT uses WSL, run setup inside WSL and use Linux paths such as `/mnt/c/Users/you/Documents/sales.xlsx`. For native Windows execution, use a path such as `C:\Users\you\Documents\sales.xlsx`.

Ask: **“Use ACTS Excel to import my sales.xlsx file and summarize revenue by region.”** Include its absolute local path. Successful discovery exposes eight tools: `ingest`, `catalog`, `query`, `transform`, `read_result`, `read_cell`, `export`, and `forget`.

### Other MCP clients

Use the same npm command in your client's stdio configuration:

```json
{
  "mcpServers": {
    "acts-excel": {
      "command": "npx",
      "args": [
        "--yes",
        "--package=https://github.com/Applied-Contexts/ACTS-Excel/releases/download/v0.0.5/acts-excel-0.0.5.tgz",
        "acts-excel"
      ]
    }
  }
}
```

On Windows, a client that cannot resolve npm's `.cmd` launcher needs `"command": "cmd"` and `"/c", "npx"` prepended to the argument list. ChatGPT/Codex's Windows resolver handles `npx` itself. Restart or reconnect after configuration. MCP Apps support adds interactive tables and charts; other clients receive the same tools and text results.

### Release files and upgrades

Each release contains one small ChatGPT plugin ZIP, one npm `.tgz` runtime package, and their SHA-256 files. Import the **plugin ZIP** into ChatGPT. The `.tgz` is fetched by npm; GitHub's generated source ZIP is for source development. Starting with 0.0.5, use standard stdio configuration for other clients instead of the old platform-specific MCPB packages.

To upgrade, import the new plugin ZIP or update the versioned URL in your MCP configuration. There is no mutable `latest` dependency. Downloads can be checked against the adjacent `.sha256` file with `sha256sum`, `shasum -a 256`, or PowerShell's `Get-FileHash -Algorithm SHA256`.

## Use and data storage

Start with `ingest` using an absolute file path. Use the returned table name in `query`, for example `SELECT region, sum(revenue) FROM data.sales GROUP BY region`. `catalog` shows actual table and column names. `transform` saves a new table; `export` writes the full result. `read_result` pages through saved results and `read_cell` recovers long values omitted from previews. `forget` removes selected stored tables/results without deleting input files or exports.

Imported data and complete query results persist locally in `workspace.duckdb`. Default exports are stored alongside it in `exports/`.

| OS | Default data directory |
| --- | --- |
| Windows | `%LOCALAPPDATA%\ACTS-Excel` |
| macOS | `~/Library/Application Support/ACTS-Excel` |
| Linux | `$XDG_DATA_HOME/acts-excel`, or `~/.local/share/acts-excel` |

Set `ACTS_EXCEL_HOME` in the MCP server's environment to use another absolute directory. Use a separate directory for each concurrently running server process: DuckDB does not support independent writer processes sharing this database. Upgrades and plugin removal do not delete this data directory. Back it up or remove it explicitly while the server is stopped.

ACTS Excel does not upload spreadsheets. Dependency downloads occur during initial setup; subsequent operations reuse the installed native library and Excel extension. Tool results are sent to the MCP client, whose own model and data policies apply. SQL queries cannot directly read external files, access the network, change configuration, or execute multiple statements; `ingest` and `export` are the file boundaries. Run the server with the permissions needed for your chosen files.

XLSX formulas use their cached values; ACTS Excel does not recalculate formulas. XLSX exports contain data, not the original workbook formatting. Save legacy XLS/XLSB as XLSX first. For preserving exact database types, export Parquet.

## Build from source

Prerequisites: Git, Node.js 22+, and npm. No private registry credentials are needed.

```sh
git clone https://github.com/Applied-Contexts/ACTS-Excel.git
cd ACTS-Excel
npm ci
npm run build
npm run check
npm test
npm start
```

`npm start` runs a stdio MCP server and waits for protocol input; silence in a terminal is normal. For local development, configure your MCP client with `node /absolute/path/ACTS-Excel/dist/server.mjs`. Rebuild and reconnect after source changes.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the code layout, tests, local release process, and fork instructions. All builds and releases run locally or on developer-managed machines. **This repository does not use GitHub CI.**

## Troubleshooting

- **Tools do not appear:** run the setup command in the client's execution environment. Check `node --version`, `npm --version`, and the client's MCP stderr log. A desktop application may use a different PATH or WSL environment from your terminal.
- **Startup timeout:** complete the explicit setup command, then reconnect. The first npm install needs more time on a slow connection. Clients that support a configurable MCP startup timeout can increase it.
- **ChatGPT rejects the upload:** check that the selected file is `ACTS-Excel-VERSION-chatgpt.zip`. Archive import and MCP startup are separate steps; “Couldn't add plugin” alone does not identify a dependency or native-library error. A release's validation notes state which host import paths were tested.
- **Database locked:** stop other ACTS Excel processes or give each client a separate `ACTS_EXCEL_HOME`.
- **File not found:** supply an absolute path readable in the server's environment. A cloud attachment is not automatically a local file, and native Windows and WSL use different paths.

## Packaging design

The plugin is configuration; the server is an ordinary npm package with an `acts-excel` executable. The package is built once and attached to a versioned GitHub release. npm installs the platform dependency from DuckDB's optional dependencies, and DuckDB installs and verifies its own version-matched Excel extension. There is no custom binary downloader or plugin post-install hook.

This follows the npm launch pattern used by the [MCP filesystem reference server](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem) and the [Playwright plugin](https://github.com/anthropics/claude-plugins-official/blob/main/external_plugins/playwright/.mcp.json). Platform selection is implemented by [DuckDB's Node bindings](https://github.com/duckdb/duckdb-node-neo/blob/main/bindings/pkgs/%40duckdb/node-bindings/duckdb.js). MCP itself supplies process transport, not package installation.

npm stores runtime packages in its normal cache; Excel extensions are cached under `ACTS_EXCEL_HOME/extensions` (or the default data directory above). Keep those caches for reuse. Removing or upgrading a plugin does not remove your stored spreadsheets or results.

Public directory submission has separate review requirements; this repository's downloadable plugin is not a claim of directory approval.

## License

[MIT](LICENSE). Bundled JavaScript license notices are included in `dist/notices/`. npm dependencies and DuckDB extensions retain their own licenses.
