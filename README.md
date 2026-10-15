# ACTS Excel

A local [Model Context Protocol](https://modelcontextprotocol.io/) server for spreadsheet analysis with DuckDB SQL. Import XLSX, CSV, TSV, Parquet, or JSON; query and transform the data; inspect compact previews; recover complete values; and export results. MCP Apps clients also show an interactive table, chart, and export view. Other stdio MCP clients receive the same tools and text results.

ACTS Excel does not require Microsoft Excel, Python, an API key, or a hosted server. It requires **Node.js 22 or newer** in the desktop client's execution environment. The package includes its JavaScript dependencies, DuckDB native library, and Excel extension. No installation script or first-run download is needed.

On Windows, DuckDB also requires the [Microsoft Visual C++ Redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist/) for the selected architecture, as documented by [DuckDB](https://duckdb.org/docs/current/dev/building/windows). Install it if it is not already present.

## Install

1. Open [Releases](https://github.com/Applied-Contexts/ACTS-Excel/releases) and select a platform package from version 0.0.4 or newer. Version 0.0.3's universal archive exceeds ChatGPT's 100 MB upload limit.
2. Choose the target matching the **Node process used by your client**, including its CPU architecture. To check an installed Node runtime, run `node -p "process.platform + '-' + process.arch"` and `node --version`.
3. Download `ACTS-Excel-VERSION-TARGET-chatgpt.zip` for ChatGPT, or `ACTS-Excel-VERSION-TARGET.mcpb` for Claude Desktop or another MCPB host. The ZIP and MCPB are alternative packages of the same application; install one.
4. Verify the download against the adjacent `.sha256` file. On Linux use `sha256sum -c FILE.sha256`; on macOS use `shasum -a 256 -c FILE.sha256`; in PowerShell use `Get-FileHash FILE -Algorithm SHA256` and compare the printed hash.
5. In ChatGPT desktop, use the available plugin ZIP import flow and run the plugin in a local task. In Claude Desktop, open the `.mcpb` file and confirm installation. Local execution must be enabled by the host or workspace. A web/cloud task cannot launch this stdio server on your computer.
6. Ask: **“Use ACTS Excel to import `/absolute/path/sales.xlsx` and summarize revenue by region.”** On Windows, supply a full path such as `C:\Users\you\Documents\sales.xlsx`.

| Computer / runtime | Target |
| --- | --- |
| Windows x64 | `win32-x64` |
| Windows ARM64 with ARM64 Node | `win32-arm64` |
| Apple silicon with ARM64 Node | `darwin-arm64` |
| Intel Mac, or x64 Node under Rosetta | `darwin-x64` |
| Linux x64, glibc (Ubuntu, Debian, Fedora) | `linux-x64` |
| Linux ARM64, glibc | `linux-arm64` |
| Linux x64, musl (Alpine) | `linux-x64-musl` |
| Linux ARM64, musl | `linux-arm64-musl` |

A host may supply its own Node runtime. Its architecture takes precedence over the operating system's architecture. MCPB compatibility metadata distinguishes operating systems, not CPU architectures, so selecting the matching archive matters. Platform assets are built for all eight targets. Builds, tests, and releases run on local or developer-managed machines; this project does not use GitHub CI. Each release states which runtimes were actually execution-tested. An included archive alone does not establish execution coverage.

### Other MCP clients

Extract the matching ChatGPT ZIP into a permanent directory and configure the client's stdio server entry. Replace the sample path with the absolute path on your machine; use an absolute Node executable path if the client cannot find `node` on its PATH.

```json
{
  "mcpServers": {
    "acts-excel": {
      "command": "node",
      "args": ["/absolute/path/acts-excel/dist/server.mjs"]
    }
  }
}
```

On Windows, JSON paths need escaped backslashes, for example `C:\\Tools\\acts-excel\\dist\\server.mjs`. Restart or reconnect the MCP client after configuration. Successful discovery exposes eight tools: `ingest`, `catalog`, `query`, `transform`, `read_result`, `read_cell`, `export`, and `forget`.

## Use and data storage

Start with `ingest` using an absolute file path. Use the returned table name in `query`, for example `SELECT region, sum(revenue) FROM data.sales GROUP BY region`. `catalog` shows actual table and column names. `transform` saves a new table; `export` writes the full result. `read_result` pages through saved results and `read_cell` recovers long values omitted from previews. `forget` removes selected stored tables/results without deleting input files or exports.

Imported data and complete query results persist locally in `workspace.duckdb`. Default exports are stored alongside it in `exports/`.

| OS | Default data directory |
| --- | --- |
| Windows | `%LOCALAPPDATA%\ACTS-Excel` |
| macOS | `~/Library/Application Support/ACTS-Excel` |
| Linux | `$XDG_DATA_HOME/acts-excel`, or `~/.local/share/acts-excel` |

Set `ACTS_EXCEL_HOME` in the MCP server's environment to use another absolute directory. Use a separate directory for each concurrently running server process: DuckDB does not support independent writer processes sharing this database. Upgrades and plugin removal do not delete this data directory. Back it up or remove it explicitly while the server is stopped.

ACTS Excel does not upload spreadsheets or contact a service during analysis. Tool results are sent to the MCP client, whose own model and data policies apply. SQL queries cannot directly read external files, access the network, change configuration, or execute multiple statements; `ingest` and `export` are the file boundaries. Run the server with the permissions needed for your chosen files.

XLSX formulas use their cached values; ACTS Excel does not recalculate formulas. XLSX exports contain data, not the original workbook formatting. Save legacy XLS/XLSB as XLSX first. For preserving exact database types, export Parquet.

## Build from source

Prerequisites: Git, Node.js 22+, npm, and `tar` on PATH. Initial installation/build needs access to npm, the DuckDB extension host, and GitHub for third-party notices. No credentials are required for public dependencies.

```sh
git clone https://github.com/Applied-Contexts/ACTS-Excel.git
cd ACTS-Excel
npm ci
npm run build
npm run check
npm test
npm start
```

`npm run build` builds for the current machine. `npm start` runs a stdio MCP server and waits for protocol input; silence in a terminal is normal. Point your MCP client at the built `dist/server.mjs` using the configuration above. You can edit TypeScript and rebuild without reinstalling the plugin.

```sh
npm run bundle -- --target linux-x64
npm run test:package
```

This produces the two package formats and checksums under `release/`, verifies their contents and sizes, and exercises extracted packages matching the current runtime through an MCP client. To build every release target, use `npm run bundle`. `npm run build -- --all` builds all binaries without packaging.

See [CONTRIBUTING.md](https://github.com/Applied-Contexts/ACTS-Excel/blob/main/CONTRIBUTING.md) for the code layout, extension points, UI tests, and release process.

## Troubleshooting

- **`node` not found or tools do not appear:** check the desktop client's Node runtime and PATH, use Node 22+, and inspect its MCP stderr log. Shell PATH and desktop application PATH can differ.
- **Native module / architecture error:** select the archive matching the client's Node architecture and Linux libc. Re-extract the complete archive; do not move `server.mjs` away from its `native/`, `extensions/`, and `app.html` siblings.
- **ChatGPT rejects a large archive:** use a platform-specific `-chatgpt.zip` from 0.0.4 or later, not the 0.0.3 universal archive, an MCPB file, or GitHub's source-code ZIP.
- **Database locked:** stop other ACTS Excel processes or give each client a separate `ACTS_EXCEL_HOME`.
- **File not found:** supply a local absolute path readable by the server. A cloud attachment is not automatically a local filesystem path.
- **No interactive view:** MCP Apps support is host-specific; the tools remain usable through text results.

## Why platform packages?

Version 0.0.3 bundled eight native DuckDB builds and eight Excel extensions in a single 231 MB ZIP. Each installation needs one pair. Separate platform archives keep the existing runtime self-contained and below a strict **100,000,000-byte** packaging gate. They avoid an additional downloader, mutable “latest” resolution, cache repair, startup timeouts, and first-use network access.

This choice follows OpenAI's [desktop plugin packaging guidance](https://developers.openai.com/plugins/deploy/desktop-only), MCPB's [dependency bundling guidance](https://github.com/modelcontextprotocol/mcpb#bundling-dependencies), and the platform release approach used by [GitHub's MCP server](https://github.com/github/github-mcp-server) and [Grafana's MCP server](https://github.com/grafana/mcp-grafana). [Playwright MCP](https://github.com/microsoft/playwright-mcp) offers another established model using an npm launcher; ACTS Excel currently distributes built archives and does not require runtime npm access. There is no universal post-install hook shared by these hosts.

Public OpenAI directory distribution has additional eligibility and review requirements; a working local package is not a claim of public-directory approval.

## License

[MIT](LICENSE). Bundled third-party components retain their own licenses, included under `dist/notices/` and the native library directory in release packages.
