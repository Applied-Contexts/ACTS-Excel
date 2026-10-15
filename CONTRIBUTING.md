# Contributing

Follow [source setup](README.md#build-from-source). Changes and pull requests target `main`. Commit dependency changes with `package-lock.json`; use `npm ci` to reproduce development installs. Generated files (`dist/`, `.stage/`, `release/`, `node_modules/`) stay out of Git.

## Code layout

| Path | Responsibility |
| --- | --- |
| `src/server.ts` | MCP schemas, tool registration, stdio transport, MCP App resource, setup check |
| `src/engine.ts` | DuckDB workspace, bundled Excel extension loading, serialized operations, SQL/file boundaries |
| `src/workbook.ts` | XLSX structure and worksheet inspection |
| `src/reply.ts` | Response budgets, previews, recoverable truncation |
| `src/types.ts` | Result shapes |
| `ui/` | MCP App interface |
| `scripts/build.mjs` | JavaScript/UI bundles, native libraries, Excel extensions, license notices, provenance |
| `scripts/targets.mjs` | Supported operating systems/architectures and archive size limits |
| `scripts/package.mjs` | Complete architecture ZIPs and checksums |
| `scripts/release.mjs` | Local release verification and GitHub publication |
| `packaging/acts-excel/` | Plugin and compatibility manifests |
| `tests/` | Engine, protocol, response-budget, UI, archive, and host checks |

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

`bundle` rebuilds all supported targets and creates two complete ZIPs. Native package URLs and integrity hashes come from `package-lock.json`; Excel extensions come from DuckDB's versioned official repository. Downloads are cached in `.stage/downloads` for subsequent builds. The native extension signature is checked when DuckDB loads it. Consumer installation does not run npm, scripts, or downloads.

`test:package` verifies both archives' manifests, hashes, sizes, and native/Excel files for every advertised platform. It extracts the ZIP matching the current Node architecture and exercises all eight tools, CSV and multi-sheet XLSX ingestion, SQL, transformations, full-cell recovery, exact Parquet values, and an XLSX export/import round-trip. It confirms the input workbook is unchanged. The server receives fresh data/cache directories and no executables on PATH; an existing invalid runtime cache must not affect execution.

On a Linux machine supporting unprivileged network namespaces, also run the exact-package test with networking disabled:

```sh
unshare -Urn node --test tests/release.check.mjs
```

The package test uses the absolute path to the current Node executable, so it can prove no npm or system helper is required by the server. Run it separately with native Windows Node and the desktop's Node runtime where available. Proxy/offline environment settings alone are not proof that networking is disabled.

Run `npm run test:host` with the desktop's `codex` executable on PATH, or set `ACTS_TEST_CODEX` to its absolute path. This opt-in check installs the extracted archive through local app-server `plugin/install`, requires all eight tools to initialize, then uninstalls it. It uses an isolated Codex home, local marketplace, and data directory. It does not create an account plugin or change the user's installed plugins.

Before release, test the desktop host's ZIP upload UI where available. Record the exact host and import method; do not label archive validation, local app-server installation, or a direct Node launch as a successful desktop ZIP upload. State unavailable platform tests explicitly.

## Release

Build, test, and publish locally or on developer-managed machines. **Never use GitHub Actions or GitHub-hosted CI.**

1. Update `package.json`, both root versions in `package-lock.json`, both plugin manifests, and download links in README. Packaging rejects inconsistent versions or launch commands.
2. Commit and merge into `main`. From a clean checkout of that commit, run the verification commands above. The artifacts record that exact source commit.
3. Write release notes outside the checkout with changes, actual installation/runtime coverage, and limitations. Do not overwrite published assets to fix a release.
4. Create and push `vVERSION`, then publish:

```sh
git tag vVERSION
git push origin vVERSION
npm run release -- --notes-file /absolute/path/release-notes.md --prerelease
```

The command verifies the clean checkout, tag, checksums, archive size limits, and source provenance. It creates a draft containing the x64 and arm64 plugin ZIPs and their SHA-256 files; verifies uploaded sizes and GitHub digests; and publishes it. A verification failure leaves the draft unpublished. Existing 0.0.x releases are prereleases.

Verify the published ZIP's checksum after downloading it. Only a successful ChatGPT desktop ZIP import verifies that UI path. The local release command needs GitHub CLI authentication. GitHub's generated source ZIP is not the plugin.

When changing DuckDB versions, update the root dependency and regenerate `package-lock.json`. Ensure every target in `scripts/targets.mjs` has both a locked native package and a matching official Excel extension. Build and test again: a missing platform dependency must fail the build, not trigger a runtime download. Keep each archive below 100,000,000 compressed bytes and 512 MiB extracted. If future versions exceed these limits, revise supported targets or packaging before release.

## Forks

MIT permits reuse and modification; preserve the copyright/license notice. Update package/plugin identity, author, repository URLs, and README links. Review the data directory and MCP App metadata namespace before distributing a fork alongside ACTS Excel. MCP configs and packaging checks must agree if you rename `acts-excel`. No private service or registry token is required to build and release a fork.
