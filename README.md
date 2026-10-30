# PLFA Playground

An interactive, type-checkable edition of *Programming Language Foundations in
Agda* that runs entirely in the browser. The Agda 2.8 compiler and language
server are a 33 MB WASI executable (about 10 MB over the wire with gzip); code
does not need to be sent to a server.

This repository is the **worked example** of the
[`jespercockx/agda-playground`](https://github.com/jespercockx/agda-playground)
template: the app is the template's, and the content is the PLFA book. For the
template itself — content authoring, configuration, runtime distribution, and
interfaces — see that repository's README.

## What works

- Agda type checking, compiler highlighting, goals, errors, and warnings
- Language-server hover types plus buffer/import-aware name completion
- Agda/Emacs-style Unicode composition (`\to` → `→`, `\all` → `∀`, etc.)
- Goal type and context inspection
- Give, Refine, and case-split interactions that edit and re-check the source
- Top-level type inference and normalization
- Bundled Agda 2.8.0 and standard library 2.3
- The 25 PLFA chapters, each native `.lagda.md` rendered beside its editable,
  type-checkable literate source, with browser-local progress
- Autosave in browser storage, keyboard checking, responsive layout, and a
  resizable goal inspector
- Persistent, versioned source and interface caches in IndexedDB
- The standard Emacs `agda2-mode` interaction chords (`C-c C-l`, `C-c C-f`,
  `C-c C-SPC`, `C-c C-r`, `C-c C-c`, `C-c C-t`, `C-c C-e`, `C-c C-d`, and
  `C-c C-n`)

## Run locally

```sh
npm ci
npm run dev
```

The Agda/ALS runtime binaries are not stored in Git; `npm run dev` (and
`npm run build`) download them from the pinned
[`jespercockx/agda-als-dist`](https://github.com/jespercockx/agda-als-dist)
release into `static/` before starting Vite, caching the verified downloads and
the standard-library interface tree under `.runtime-cache/` and `static/`.

Open <http://localhost:5173>. Press Ctrl/Cmd+Enter to check the chapter. The
first visit downloads and initializes the compiler; subsequent visits use the
browser cache.

The app requires `SharedArrayBuffer`, so the page must be cross-origin isolated
with:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

GitHub Pages cannot set response headers, so the bundled
`static/coi-serviceworker.js` supplies them, at the cost of one automatic reload
on the first visit. Any static host that sends the two headers works too.

## Build and verify

```sh
npm run check
npm test
npm run build
```

The static site is written to `build/`. The runtime is downloaded from the
release pinned under `runtime` in `playground.config.json` by
`scripts/sync-runtime.mjs` (run automatically by `npm run dev` and
`npm run build`), which verifies every file against the release's
`dist-manifest.json`. See the dist repository's
[`UPDATING.md`](https://github.com/jespercockx/agda-als-dist/blob/main/UPDATING.md)
to rebuild the WASM executable from pinned sources.

With a local Chromium/Chrome executable available, run the browser regression
benchmark against every PLFA chapter with:

```sh
npm run dev   # in another terminal
PLAYGROUND_URL=http://127.0.0.1:5173 npm run benchmark:content
```

Set `CHROME_EXECUTABLE` when Chrome is not on `PATH`. `CHAPTERS=Naturals,Lambda`
can narrow a diagnostic run; an unset `CHAPTERS` always covers the complete
book.

## Architecture

The main thread hosts CodeMirror and an LSP client. A dedicated worker runs the
Agda Language Server under WASI, while a second worker owns its in-memory
filesystem and the bundled standard library and content. Shared
single-producer/single-consumer buffers connect the workers without a remote
backend; file contents cross that bridge as binary data rather than JSON/Base64.
See the template README for the full diagram.

The compiler is unmodified, stock Agda. Checks reuse Agda's own interfaces and
one long-lived interaction process. A single edit inside an existing goal uses
Agda's standard `Cmd_give` path; declaration, import, multi-goal, and ambiguous
edits always fall back to a complete `Cmd_load`, so changed code is never
silently accepted from a stale result.

## PLFA responsiveness

All 25 bundled PLFA chapters are compiled and exercised by the browser
benchmark, not just `Naturals`. On the reference development machine, a real
warm declaration edit averaged 3.01 s across the complete book (median 3.08 s,
95th percentile 4.35 s, maximum 4.59 s), down from a 9.37 s baseline. Editing
and checking an existing goal normally takes about 20–60 ms.

The browser archive includes position-compatible PLFA adapters for a small set
of broad standard-library imports. The displayed `.lagda.md` text remains the
book's original source, while each replacement module name occupies exactly the
same UTF-8 width so Agda ranges, highlighting, errors, goals, and document/code
scroll synchronization stay aligned. These adapters are ordinary checked Agda
modules, not compiler patches, and are described by the `importRewrite` block in
`playground.config.json` (see the template README for the format).

## Content pipeline

Site content lives in `content/` (the 25 PLFA chapters under `part1/`, `part2/`,
and `part3/`) and is described by `playground.config.json`. The pipeline runs
automatically before `npm run dev` / `npm run build`, and can be run directly:

```sh
npm run sync:content
```

It writes the raw display sources, the Agda project archive, and the content
index under `static/content/` (generated, not committed). With a native Agda
2.8.0 on `PATH`, the optional fast path precompiles interfaces so first visits
do not type-check the standard library and earlier chapters:

```sh
npm run precompile:content -- /path/to/agda-2.8.0
```

That refreshes the deduplicated per-chapter archives under
`static/content/interfaces/` and the generated dependency index, so the browser
mounts only the archives in the selected chapter's transitive import closure.
The source-only standard-library archive therefore stays small for users who
never open a chapter.

## Bundling another local Agda library

The browser drive can mount any ZIP containing sources, Agda interfaces, or
both. Preserve the library's virtual paths in the archive: sources belong under
their library root and generated interfaces under that root's
`_build/2.8.0/agda/` directory. Use stored ZIP entries rather than deflate;
Agda interfaces compress only slightly and are much faster to mount this way.

Interfaces must be generated by Agda 2.8.0 with the same source files, include
paths, library versions, and relevant flags used in the browser. Agda checks
the hashes and safely ignores a stale or incompatible interface. The public
`mountDriveArchives()` controller method is the runtime hook for future local
library bundles. Browser-created source and newly generated interfaces are
persisted in a versioned IndexedDB cache, and changed sources receive newer
virtual modification times so Agda will reject stale interfaces normally.

## License and notices

The app is MIT (see [`LICENSE`](LICENSE)). The bundled PLFA content is
redistributed under CC BY 4.0 (see `content/LICENSE` and [`NOTICE.md`](NOTICE.md));
the runtime artifacts and standard library retain their upstream licenses.
