# ACTS Excel

A local [Model Context Protocol](https://modelcontextprotocol.io/) server for spreadsheet analysis with DuckDB SQL. Import XLSX, CSV, TSV, Parquet, or JSON; query and transform the data; inspect compact previews; recover complete values; and export results. MCP Apps clients also show an interactive table, chart, and export view. Other stdio MCP clients receive the same tools and text results.

## Install in ChatGPT desktop

1. Make **Node.js 22+** available in the environment where ChatGPT runs local tools. npm is not required to use the release. On Windows, install the [Visual C++ Redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist/) if it is not already present. Restart ChatGPT after installing Node so it sees the updated PATH.
2. Download the ZIP matching your Node architecture:

   | Node architecture | Download | Typical machines |
   | --- | --- | --- |
   | `x64` | [ACTS-Excel-0.0.7-x64-chatgpt.zip](https://github.com/Applied-Contexts/ACTS-Excel/releases/download/v0.0.7/ACTS-Excel-0.0.7-x64-chatgpt.zip) | Intel/AMD Windows PCs, x64 WSL/Linux, Intel Macs |
   | `arm64` | [ACTS-Excel-0.0.7-arm64-chatgpt.zip](https://github.com/Applied-Contexts/ACTS-Excel/releases/download/v0.0.7/ACTS-Excel-0.0.7-arm64-chatgpt.zip) | Apple Silicon, ARM64 Windows or Linux |

   Run `node -p process.arch` if unsure. Each ZIP includes Windows, macOS, and Linux/WSL libraries for that architecture. Linux requires glibc; Alpine/musl is not supported by these archives. See the release notes for platforms actually execution-tested.
3. Import the downloaded ZIP through **ChatGPT desktop's plugin ZIP upload**, then use ACTS Excel in a local task with local execution enabled. Keep the ZIP intact. GitHub's generated source ZIP is not an installable plugin.
4. Ask: **“Use ACTS Excel to import my sales.xlsx file and summarize revenue by region.”** Include its absolute local path.

Each ZIP is below 100 MB and includes the server, interface, JavaScript dependencies, native database libraries, and Excel extensions. There is no first-run npm install, runtime download, or dependency cache to prepare. Spreadsheet operations work offline once the plugin and Node are installed. Microsoft Excel, Python, API keys, and a hosted server are not required.

When ChatGPT runs tools in WSL, Node must be available inside WSL and file paths look like `/mnt/c/Users/you/Documents/sales.xlsx`. Native Windows tools use paths such as `C:\Users\you\Documents\sales.xlsx`. The x64 ZIP handles both native Windows x64 and WSL x64.

Successful discovery exposes eight tools: `ingest`, `catalog`, `query`, `transform`, `read_result`, `read_cell`, `export`, and `forget`.

### Upgrades

Use the app's update flow for your existing plugin when available. If importing a replacement reports that `acts-excel` already exists, remove the old entry from your personal plugins before importing the new ZIP. Disconnecting an installed plugin can leave its owned definition in place. Removing the plugin does not remove ACTS Excel's data directory.

Version 0.0.7 does not use the `runtime/` dependency cache left by 0.0.6. It can read the existing workspace without reinstalling dependencies. The obsolete cache may be deleted while the server is stopped; retain `workspace.duckdb`, any accompanying WAL, and `exports/` to preserve your data.

Each archive has an adjacent `.sha256` file. Verify it with `sha256sum`, `shasum -a 256`, or PowerShell's `Get-FileHash -Algorithm SHA256`.

### Other MCP clients

Download and extract the same architecture ZIP to a permanent folder, then configure the client's stdio server:

```json
{
  "mcpServers": {
    "acts-excel": {
      "command": "node",
      "args": ["/absolute/path/to/acts-excel/dist/server.mjs"]
    }
  }
}
```

Replace the example path with the extracted file's absolute path. In Windows JSON, use forward slashes (`C:/Tools/acts-excel/dist/server.mjs`) or escaped backslashes. Keep the complete extracted folder together: `server.mjs` loads adjacent bundled libraries. Restart or reconnect after configuration. To upgrade, stop the server, replace the extracted folder with the new release, then reconnect. No npm package or registry publication is needed.

## Use and data storage

Start with `ingest` using an absolute file path. Use the returned table name in `query`, for example `SELECT region, sum(revenue) FROM data.sales GROUP BY region`. `catalog` shows actual table and column names. `transform` saves a new table; `export` writes the full result. `read_result` pages through saved results and `read_cell` recovers long values omitted from previews. `forget` removes selected stored tables/results without deleting input files or exports.

Imported data and complete query results persist locally in `workspace.duckdb`. Default exports are stored alongside it in `exports/`.

| OS | Default data directory |
| --- | --- |
| Windows | `%LOCALAPPDATA%\ACTS-Excel` |
| macOS | `~/Library/Application Support/ACTS-Excel` |
| Linux | `$XDG_DATA_HOME/acts-excel`, or `~/.local/share/acts-excel` |

Set `ACTS_EXCEL_HOME` in the MCP server's environment to use another absolute directory. Use a separate directory for each concurrently running server process: DuckDB does not support independent writer processes sharing this database. Upgrades and plugin removal do not delete this data directory. Back it up or remove it explicitly while the server is stopped.

ACTS Excel does not upload spreadsheets or download dependencies at runtime. Tool results are sent to the MCP client, whose own model and data policies apply. SQL queries cannot directly read external files, access the network, change configuration, or execute multiple statements; `ingest` and `export` are the file boundaries. Run the server with the permissions needed for your chosen files.

XLSX formulas use their cached values; ACTS Excel does not recalculate formulas. XLSX exports contain data, not the original workbook formatting. Save legacy XLS/XLSB as XLSX first. For preserving exact database types, export Parquet.

## Build from source

Prerequisites: Git, Node.js 22+, npm, and `tar`. The build downloads the pinned native packages and version-matched Excel extensions. No private registry credentials are needed.

```sh
git clone https://github.com/Applied-Contexts/ACTS-Excel.git
cd ACTS-Excel
npm ci
npm run build
npm run check
npm test
npm start
```

`npm start` runs a stdio MCP server and waits for protocol input; silence in a terminal is normal. For local development, configure your MCP client with `node /absolute/path/ACTS-Excel/dist/server.mjs`. Rebuild and reconnect after source changes. `npm run bundle` creates both installable ZIPs and checksums in `release/`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the code layout, tests, local release process, and fork instructions. All builds and releases run locally or on developer-managed machines. **This repository does not use GitHub CI.**

## Troubleshooting

- **Tools do not appear:** check `node --version` and `node -p process.arch` in the client's execution environment. Confirm the archive architecture matches Node and restart the app after installing Node.
- **Native library cannot load:** use the complete extracted release, not just `server.mjs`. Check the architecture and, on Windows, the Visual C++ runtime. Install a current archive if an older release refers to `ACTS-Excel/runtime` or `acts-excel/runtime`; 0.0.7 does not use that cache.
- **ChatGPT rejects the upload:** select `ACTS-Excel-VERSION-ARCH-chatgpt.zip`. An existing personal plugin with the same name can prevent adding another; see [Upgrades](#upgrades). “Couldn't add plugin” alone does not identify a runtime failure. Release notes distinguish archive/runtime tests from a verified desktop ZIP upload.
- **Database locked:** stop other ACTS Excel processes or give each client a separate `ACTS_EXCEL_HOME`.
- **File not found:** supply an absolute path readable in the server's environment. A cloud attachment is not automatically a local file, and native Windows and WSL use different paths.

## Packaging design

The release follows [OpenAI's desktop plugin guidance](https://developers.openai.com/plugins/deploy/desktop-only): include the server and its dependencies in the package, and launch the bundled entrypoint through stdio. This also follows the dependency-bundling practice described by [MCPB](https://github.com/modelcontextprotocol/mcpb#best-practices) and used by [Grafana's desktop MCP packages](https://github.com/grafana/mcp-grafana/tree/main/mcpb). ACTS Excel uses ChatGPT's plugin ZIP manifest format.

Build-time downloads produce complete packages. JavaScript is bundled with esbuild; native files and signed Excel extensions remain adjacent to the bundle. DuckDB's loader selects the running process's operating system and architecture. Splitting releases by architecture keeps each compressed archive below 100 MB while allowing Windows and WSL to use the same ZIP. Packaging also checks the host's 512 MiB extracted-size limit. `build-info.json` records the source commit, DuckDB version, included targets, and download checksums.

DuckDB supplies the existing analytical SQL engine, typed values, Parquet support, and XLSX reader/writer. Packaging its required files removes runtime installation without changing those behaviors or the workspace format.

Public directory submission has separate review requirements; this repository's downloadable plugin is not a claim of directory approval.

## License

[MIT](LICENSE). Dependency notices are included in `dist/notices/` and alongside the bundled native libraries. Third-party components retain their own licenses.
