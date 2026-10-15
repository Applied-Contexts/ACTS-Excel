# Contributing

Follow the [source setup](README.md#build-from-source) first. Changes and pull requests target `main`. Keep generated files (`dist/`, `.stage/`, `release/`, `node_modules/`) out of Git. Commit dependency changes with `package-lock.json` and use `npm ci` to reproduce installs.

## Code layout

| Path | Responsibility |
| --- | --- |
| `src/server.ts` | MCP tool schemas, registration, stdio transport, MCP App resource |
| `src/engine.ts` | Persistent DuckDB workspace, serialized operations, SQL/file boundaries |
| `src/workbook.ts` | XLSX structure inspection and sheet handling |
| `src/reply.ts` | Response budgets, previews, recoverable truncation |
| `src/types.ts` | Shared result shapes |
| `ui/` | MCP App browser interface |
| `scripts/build.mjs` | JavaScript/UI bundles, locked native dependencies, Excel extensions, notices |
| `scripts/targets.mjs` | Supported native targets and archive size limit |
| `scripts/package.mjs` | Platform archives, manifest checks, provenance, checksums |
| `packaging/acts-excel/` | Portable plugin and compatibility manifests |
| `manifest.json` | MCPB manifest template |
| `tests/` | Engine, protocol, response-budget, UI, and extracted-package checks |

To add a tool, implement the operation in the engine, register its input schema and annotations in `src/server.ts`, and add engine and protocol coverage. Keep stdout exclusively for MCP messages; diagnostics belong on stderr. Preserve full stored results when changing previews, with stable pagination and exact-value recovery. File content must remain data, never agent instructions.

To change the interface, edit `ui/` and rebuild. The build embeds scripts and styles into `dist/app.html`; the server serves it as an MCP App resource. UI tests cover the host handshake, paging, long cells, exports, themes, and escaping.

## Verify changes

```sh
npm run build
npm run check
npm test
npx playwright install chromium
npm run test:ui
npm run bundle -- --target linux-x64
npm run test:package
```

Replace `linux-x64` with your own target. On a Linux CI machine, browser installation may also need `npx playwright install --with-deps chromium`. `test:package` inspects both archive formats for each target in `dist/build-info.json`, verifies checksums, manifests, native payload selection and the size gate, then runs the MCP integration suite against extracted packages for the host target. Foreign architectures receive archive inspection only; do not describe that as execution testing.

Normal source builds download only the host target. Cross-packaging is supported with `--target TARGET` or `npm run bundle` for all targets. Downloads are cached in `.stage/downloads/`; deleting that directory forces a fresh download. Native npm archives are checked against lockfile integrity; DuckDB verifies the signed Excel extension when loading it.

## Release

1. Update the version in `package.json`, the root entry in `package-lock.json`, `manifest.json`, `packaging/acts-excel/plugin.json`, and `packaging/acts-excel/.codex-plugin/plugin.json`. The server takes its version from `package.json`; packaging rejects mismatched manifest versions.
2. Run the checks above. Commit the release changes and open a pull request against `main`.
3. After merge, create and push the matching `vVERSION` tag. The release workflow checks that the tag matches the package version, builds all platform archives, runs the package checks, and creates a **draft** GitHub release with checksums. It also executes extracted packages on the configured Windows/macOS/Linux runners.
4. Review the draft and CI results, state which runtimes were actually tested, and publish the release. Do not replace an already published version's bytes: corrections get a new version.

Each release contains `ACTS-Excel-VERSION-TARGET-chatgpt.zip`, `ACTS-Excel-VERSION-TARGET.mcpb`, and an adjacent `.sha256` for each archive. Never upload GitHub's generated source archive as an installable plugin. The upload workflow selects exact versioned target filenames, so old files left in a local `release/` directory cannot become release assets accidentally.

Release archives include the MIT license, third-party notices, and `dist/build-info.json` recording version, DuckDB version, source commit, and target. Build release artifacts from committed source so this provenance is meaningful. Changing a binary dependency or adding a platform requires checking its license and running an extracted-package smoke test on that target before claiming support has been verified.

## Forks

MIT permits reuse and modification; preserve its copyright and license notice. Update package/plugin names, repository URLs, author details, and release links to identify your fork. Review the persistent data directory and MCP App metadata namespace before distributing a fork alongside ACTS Excel, so the two applications do not share data unintentionally. No private npm registry, API token, or proprietary build service is required to build the project.
