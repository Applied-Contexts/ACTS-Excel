# ACTS Excel

A local [Model Context Protocol](https://modelcontextprotocol.io/) server for spreadsheet analysis with DuckDB SQL. Import XLSX, CSV, TSV, Parquet, or JSON; query and transform the data; inspect compact previews; recover complete values; and export results. MCP Apps clients also show an interactive table, chart, and export view. Other stdio MCP clients receive the same tools and text results.

ACTS Excel requires **Node.js 22+ and npm** in the environment where your MCP client runs commands. It does not require Microsoft Excel, Python, an API key, or a hosted server. On Windows, install the [Visual C++ Redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist/) if it is not already present.

## Install in ChatGPT desktop

Download **[ACTS-Excel-0.0.6-chatgpt.zip](https://github.com/Applied-Contexts/ACTS-Excel/releases/download/v0.0.6/ACTS-Excel-0.0.6-chatgpt.zip)** and import it using ChatGPT's plugin ZIP import. Use the plugin in a local task with local execution enabled. The same ZIP works with Windows, macOS, Linux, and WSL; there is no architecture selection.

The ZIP contains the bundled JavaScript server and interface (under 1 MB compressed). ChatGPT starts it with `node`; it answers MCP initialization and lists its tools without downloading anything. The first data operation uses `npm ci` with the included lockfile to install DuckDB's native dependency into the local ACTS Excel data directory. npm selects the platform package and verifies its recorded integrity. No dependency install scripts run.

First use needs internet access to the npm registry and, for XLSX, DuckDB's signed extension repository. Later launches reuse the installed dependency without contacting GitHub or npm. Keep the data directory to preserve the native runtime, Excel extension, imported tables, and results. Spreadsheet contents are not sent to the dependency services.

If setup fails, the tool returns the npm error with retry instructions; the plugin stays connected. Install Node.js 22+ **with npm** before importing the ZIP, then restart ChatGPT so its process sees Node on PATH. If ChatGPT uses WSL for a task, that environment also needs Node and npm; use paths such as `/mnt/c/Users/you/Documents/sales.xlsx`. Native Windows tools use paths such as `C:\Users\you\Documents\sales.xlsx`.

Ask: **“Use ACTS Excel to import my sales.xlsx file and summarize revenue by region.”** Include its absolute local path. Successful discovery exposes eight tools: `ingest`, `catalog`, `query`, `transform`, `read_result`, `read_cell`, `export`, and `forget`.

### Other MCP clients

Other stdio clients can install the separately published npm runtime with a pinned command:

```json
{
  "mcpServers": {
    "acts-excel": {
      "command": "npx",
      "args": [
        "--yes",
        "--package=https://github.com/Applied-Contexts/ACTS-Excel/releases/download/v0.0.6/acts-excel-0.0.6.tgz",
        "acts-excel"
      ]
    }
  }
}
```

On Windows, a client that cannot resolve npm's `.cmd` launcher needs `"command": "cmd"` and `"/c", "npx"` prepended to the argument list. ChatGPT/Codex's Windows resolver handles `npx` itself. Restart or reconnect after configuration. MCP Apps support adds interactive tables and charts; other clients receive the same tools and text results.

### Release files and upgrades

Each release contains one small ChatGPT plugin ZIP, one npm `.tgz` runtime package, and their SHA-256 files. Import the **plugin ZIP** into ChatGPT. The `.tgz` is for the npm command used by other MCP clients; GitHub's generated source ZIP is for source development. Starting with 0.0.5, use standard stdio configuration for other clients instead of the old platform-specific MCPB packages.

To upgrade, import the new plugin ZIP or update the versioned URL in another client’s MCP configuration. There is no mutable `latest` dependency. Downloads can be checked against the adjacent `.sha256` file with `sha256sum`, `shasum -a 256`, or PowerShell's `Get-FileHash -Algorithm SHA256`.

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

- **Tools do not appear:** check `node --version` in the client’s execution environment and restart ChatGPT after installing Node. The plugin ZIP requires Node on PATH; native dependency setup happens only when a data tool is called.
- **First data tool reports setup failure:** check `npm --version` and access to `registry.npmjs.org`, then retry the tool. Setup failures do not prevent tool discovery. Other clients using the `npx` command can preinstall with the same command plus `--setup` or increase their MCP startup timeout.
- **ChatGPT rejects the upload:** check that the selected file is `ACTS-Excel-VERSION-chatgpt.zip`. Archive import and MCP startup are separate steps; “Couldn't add plugin” alone does not identify a dependency or native-library error. A release's validation notes state which host import paths were tested.
- **Database locked:** stop other ACTS Excel processes or give each client a separate `ACTS_EXCEL_HOME`.
- **File not found:** supply an absolute path readable in the server's environment. A cloud attachment is not automatically a local file, and native Windows and WSL use different paths.

## Packaging design

The ChatGPT plugin bundles the small MCP server, tool schemas, interface, and license notices. Native code is excluded. MCP initialization never waits for a package download or native-library load. The first data call installs the exact dependency lockfile with standard `npm ci --omit=dev --ignore-scripts`, then loads DuckDB. Setup is staged in a temporary directory and published atomically, so interrupted or concurrent setup cannot expose a partial runtime. A failed attempt can be retried.

The runtime cache is keyed by the lockfile hash, operating system, and architecture under `ACTS_EXCEL_HOME/runtime`. `ACTS_EXCEL_RUNTIME_HOME` can select a separate runtime-cache directory. DuckDB verifies and caches its signed Excel extension under `ACTS_EXCEL_HOME/extensions`. These paths use the default data directory above when `ACTS_EXCEL_HOME` is unset. Plugin upgrades and removal do not delete stored data.

For other MCP clients, the separate npm package follows the launch pattern used by the [MCP filesystem reference server](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem). Platform selection comes from [DuckDB's Node bindings](https://github.com/duckdb/duckdb-node-neo/blob/main/bindings/pkgs/%40duckdb/node-bindings/duckdb.js). MCP supplies process transport, not dependency installation. The ChatGPT ZIP keeps npm setup outside the desktop's MCP startup deadline.

Public directory submission has separate review requirements; this repository's downloadable plugin is not a claim of directory approval.

## License

[MIT](LICENSE). Bundled JavaScript license notices are included in `dist/notices/`. npm dependencies and DuckDB extensions retain their own licenses.
