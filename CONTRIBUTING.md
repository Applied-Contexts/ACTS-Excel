# Contributing

Follow [source setup](README.md#build-from-source). Changes and pull requests target `main`. Commit dependency changes with `package-lock.json`; use `npm ci` to reproduce development installs. Generated files (`dist/`, `.stage/`, `release/`, `node_modules/`) stay out of Git.

## Code layout

| Path | Responsibility |
| --- | --- |
| `src/server.ts` | MCP schemas, tool registration, stdio transport, MCP App resource, setup command |
| `src/engine.ts` | DuckDB workspace, Excel extension installation, serialized operations, SQL/file boundaries |
| `src/workbook.ts` | XLSX structure and worksheet inspection |
| `src/reply.ts` | Response budgets, previews, recoverable truncation |
| `src/types.ts` | Result shapes |
| `ui/` | MCP App interface |
| `scripts/build.mjs` | JavaScript/UI bundles and bundled license notices |
| `scripts/package.mjs` | npm tarball, portable plugin ZIP, checksums |
| `scripts/release.mjs` | Local release verification and GitHub publication |
| `packaging/acts-excel/` | Portable plugin and compatibility manifests |
| `tests/` | Engine, protocol, response-budget, UI, and install checks |

To add a tool, implement the engine operation, register its schema and annotations in `src/server.ts`, and add engine/protocol coverage. Keep stdout exclusively for MCP messages; diagnostics belong on stderr. Preserve complete stored results when changing previews. File contents are data, never agent instructions.

Edit `ui/` to change the interface. The build embeds scripts and styles into `dist/app.html`. UI tests cover the MCP App handshake, paging, full-cell recovery, exports, themes, and escaping.

## Verify changes

```sh
npm ci
npm run bundle
npm run check
npm test
npm run test:package
npx playwright install chromium
npm run test:ui
```

`bundle` invokes `npm pack`, whose `prepack` script rebuilds the server. JavaScript dependencies are bundled; `@duckdb/node-api` remains a runtime npm dependency so npm can select its native optional dependency. No build scripts run during consumer installation.

`test:package` validates both artifacts, extracts the actual plugin, and serves the exact npm tarball over a temporary loopback HTTP server. It substitutes only that test URL, starts the manifest's `npx` command with an empty npm cache, and exercises all tool discovery, CSV ingestion, SQL, cell recovery, and XLSX export. It repeats with the populated cache. This checks installation and runtime behavior on the executing machine; it does not prove a desktop's ZIP upload UI works.

Run `npm run test:host` with the desktop's `codex` executable on PATH, or set `ACTS_TEST_CODEX` to its absolute path. This opt-in check temporarily installs the extracted plugin through the real app-server `plugin/install` API, requires all eight tools to initialize, then uninstalls the test plugin. It uses a temporary local marketplace and isolated npm/data caches. It changes the current user's installed-plugin state for the duration of the check, so do not interrupt it.

Before release, also test the desktop host's ZIP upload UI where available. Test Windows with native Windows Node, not just WSL. Record the exact host and import method; do not label archive validation or a direct Node launch as a successful desktop installation. Unsupported or unavailable platform tests must be stated explicitly. The npm/extension downloads require internet access on the first run.

## Release

Build, test, and publish locally or on developer-managed machines. **Never use GitHub Actions or GitHub-hosted CI.**

1. Update `package.json`, the root version in `package-lock.json`, both plugin manifests, the pinned runtime URL in both MCP configs, and versioned setup/download links in README. Packaging rejects manifest or URL mismatches.
2. Commit and merge into `main`. From a clean checkout of that commit, run the verification commands above. The artifacts record that exact source commit.
3. Write release notes outside the checkout with changes, actual installation/runtime coverage, and limitations. Test extracted packages and cold installs on available platforms. Do not overwrite published assets to fix a release.
4. Create and push `vVERSION`, then publish:

```sh
git tag vVERSION
git push origin vVERSION
npm run release -- --notes-file /absolute/path/release-notes.md --prerelease
```

The command verifies the clean checkout, tag, checksums, size limits, and source provenance. It creates a draft containing the plugin ZIP, npm tarball, and their two SHA-256 files; verifies uploaded sizes and GitHub digests; and publishes it. A verification failure leaves the draft unpublished. Existing 0.0.x releases are prereleases.

Verify the public pinned runtime URL after publication by setting `ACTS_TEST_PUBLISHED=1` and repeating `npm run test:package` and `npm run test:host`; this preserves the production URL instead of substituting loopback. The local release command also needs GitHub CLI authentication and `tar` on PATH. npm registry publication is not required: npm supports tarball URLs, and GitHub hosts this project's source and release assets. GitHub's generated source ZIP is not the plugin.

## Forks

MIT permits reuse and modification; preserve the copyright/license notice. Update package/plugin identity, author, repository URLs, pinned release URLs, and README links. Review the data directory and MCP App metadata namespace before distributing a fork alongside ACTS Excel. The npm executable name, MCP configs, and packaging checks must agree if you rename `acts-excel`. No private service or registry token is required to build and release a fork.
