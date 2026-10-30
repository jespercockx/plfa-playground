# Third-party notices

The WASI worker, virtual filesystem, CodeMirror Agda highlighting, Agda input
method, and language-server transport began from
[`agda-web/als-demo`](https://github.com/agda-web/als-demo), copyright Andy Pan,
under the MIT license in `LICENSE`.

The compiler is built from
[`agda-web/agda-language-server`](https://github.com/agda-web/agda-language-server)
and [`agda-web/agda`](https://github.com/agda-web/agda). The bundled standard
library is from [`agda/agda-stdlib`](https://github.com/agda/agda-stdlib).
The prebuilt WASM artifacts and their pinned revisions are distributed by
[`jespercockx/agda-als-dist`](https://github.com/jespercockx/agda-als-dist) as
GitHub release assets; `scripts/sync-runtime.mjs` downloads and checksum-verifies
them at build time. Their respective upstream licenses apply to those artifacts.
