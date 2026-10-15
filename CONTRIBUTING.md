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

Replace `linux-x64` with your own target. On Linux, browser installation may also need `npx playwright install --with-deps chromium`. `test:package` inspects both archive formats for each target in `dist/build-info.json`, verifies checksums, manifests, native payload selection and the size gate, then runs the MCP integration suite against extracted packages for the host target. Foreign architectures receive archive inspection only; do not describe that as execution testing.

Normal source builds download only the host target. Cross-packaging is supported with `--target TARGET` or `npm run bundle` for all targets. Downloads are cached in `.stage/downloads/`; deleting that directory forces a fresh download. Native npm archives are checked against lockfile integrity; DuckDB verifies the signed Excel extension when loading it.

## Release

Build, test, and publish from a local or developer-managed machine. Never use GitHub Actions or GitHub-hosted CI for this project.

1. Update the version in `package.json`, the root entry in `package-lock.json`, `manifest.json`, `packaging/acts-excel/plugin.json`, and `packaging/acts-excel/.codex-plugin/plugin.json`. The server takes its version from `package.json`; packaging rejects mismatched manifest versions.
2. Commit and merge the release changes into `main`, then use a clean checkout of that exact commit. Run `npm ci`, `npm run bundle`, `npm run check`, `npm test`, `npm run test:package`, and `npm run test:ui`. Install the Playwright browser first if needed. The bundle command builds every target; package checks execute the host target and inspect every archive.
3. Write release notes outside the checkout, stating the changes, platform selection instructions, and actual execution coverage. Test extracted packages on other available developer-managed machines; do not claim untested platforms passed.
4. Create and push the version tag, then publish locally:

```sh
git tag vVERSION
git push origin vVERSION
npm run release -- --notes-file /absolute/path/release-notes.md --prerelease
```

Replace `VERSION` with the package version. The existing 0.0.x releases are prereleases; omit `--prerelease` only when intentionally publishing a stable release. The release command checks the clean checkout, local and remote tag, all 16 archive sizes and checksums, and each archive's source commit/version/target. It uploads to a temporary draft, verifies the uploaded asset inventory, sizes and available GitHub SHA-256 digests, and publishes it. An upload verification failure leaves the draft unpublished for inspection. Do not overwrite already published assets; corrections get a new version.

Each release contains `ACTS-Excel-VERSION-TARGET-chatgpt.zip`, `ACTS-Excel-VERSION-TARGET.mcpb`, and an adjacent `.sha256` for each archive. Never upload GitHub's generated source archive as an installable plugin. The release command selects exact versioned target filenames, so old files left in a local `release/` directory cannot become release assets accidentally.

Release archives include the MIT license, third-party notices, and `dist/build-info.json` recording version, DuckDB version, source commit, and target. Changing a binary dependency or adding a platform requires checking its license and running an extracted-package smoke test on that target before claiming support has been verified.

## Forks

MIT permits reuse and modification; preserve its copyright and license notice. Update package/plugin names, repository URLs, author details, and release links to identify your fork. Review the persistent data directory and MCP App metadata namespace before distributing a fork alongside ACTS Excel, so the two applications do not share data unintentionally. No private npm registry, API token, or proprietary build service is required to build the project.
