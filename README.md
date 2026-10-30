# Agda Playground

A template for building an interactive, type-checkable Agda website that runs
entirely in the browser. Drop `.agda` or `.lagda.md` files into `content/`, and
GitHub Pages serves an editor plus a language server compiled to WebAssembly —
code never leaves the visitor's machine.

This repository is the starter. For a worked example with a full book of
content, see
[`jespercockx/plfa-playground`](https://github.com/jespercockx/plfa-playground).

> The full template documentation (authoring guide, architecture, distribution
> and limitations) is being written; this README will grow into it.

## Quickstart

1. Use this template (or clone it) into a new repository.
2. Add your sources to `content/`. The starter ships with none, so the editor
   opens an empty `Main.agda`.
3. Run it locally:

   ```sh
   npm ci
   npm run dev
   ```

   Open <http://localhost:5173> and press Ctrl/Cmd+Enter to check the module.

4. Enable GitHub Pages: **Settings → Pages → Source = GitHub Actions**, and
   **Settings → Actions → General → Workflow permissions = Read and write**.
   Every push to `master` that passes CI is deployed to
   `https://<owner>.github.io/<repository>/`.

## Content

Sources live in `content/` (`.agda` and `.lagda.md` files) and are described by
`playground.config.json`. The starter's `content/` is empty; add your own files.
Files in the content root belong to no group; files in a subdirectory form a
group named after that directory (for example `content/part1/Foo.agda` is in
group `part1`).

```sh
npm run sync:content
```

regenerates the content archive and index under `static/content/`. `npm run dev`
and `npm run build` run it automatically.

`playgroundSource` in `playground.config.json` sets the text the editor opens
with; the starter sets it to `""` for a blank document. `modulePrefix` sets the
directory the modules are placed under inside the Agda project, which must match
the module names you write: the starter sets it to `""`, so `content/Main.agda`
declares `module Main where`. A larger project whose modules are named, say,
`mylib.Widget` would set `"modulePrefix": "mylib"`.

The optional `importRewrite` feature rewrites a set of standard-library imports
onto narrow adapter modules for faster checking; it is off by default (identity)
and is documented with the worked example.

## Standard-library interfaces

Agda compiles a standard-library module from source unless it finds a
precompiled interface (`.agdai`) for it. A broad import such as `import Data.Nat`
pulls in a large part of the library, which takes minutes the first time. The
`interfaces` setting in `playground.config.json` fetches those files on demand
instead. Agda itself decides which interface it wants, so only the ones a check
needs are downloaded, one request per file.

- `{ "mode": "same-origin" }` (default): serve the tree from this site under
  `/stdlib-interfaces/<agdaVersion>/`. `sync:runtime` downloads the release's
  interface archive at build time and extracts it, so the site has to carry the
  full tree.
- `{ "mode": "none" }`: never fetch; compile from source.
- `{ "mode": "cross-origin", "baseUrl": "https://…" }`: fetch each interface
  from `baseUrl` at runtime. `baseUrl` must be a CORS host serving the tree as
  `<baseUrl>/src/<Module>.agdai`; a GitHub release asset will not work, because
  release downloads carry no `access-control-allow-origin`.

Interfaces are version-specific: the tree must be built by the same Agda version
the site ships. A file that is missing or does not match the sources is ignored
and Agda compiles that module normally, so a partial or stale tree costs time,
never correctness.

## Build and verify

```sh
npm run check
npm test
npm run build
```

The static site is written to `build/`. The Agda/ALS runtime binaries are not
stored in Git; `scripts/sync-runtime.mjs` downloads them from the
[`jespercockx/agda-als-dist`](https://github.com/jespercockx/agda-als-dist)
release pinned under `runtime` in `playground.config.json` before `dev` and
`build`, verifying each file against the release's `dist-manifest.json`. Only
Agda 2.8.0 and later are supported.

## Limitations

- The first visit downloads roughly 16 MB of WebAssembly and needs
  `SharedArrayBuffer`, so the host must send
  `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp`. GitHub Pages cannot set headers,
  so the bundled `static/coi-serviceworker.js` supplies them at the cost of one
  reload on the first visit.
- `vite` is capped below 8.3 on purpose (see the comment in `package.json`).
