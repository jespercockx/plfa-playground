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

The bundled example content in `content/` is from
[`plfa/plfa.github.io`](https://github.com/plfa/plfa.github.io), *Programming
Language Foundations in Agda*, by Philip Wadler, Wen Kokke, Jeremy G. Siek,
and contributors (revision `870f9bb12d61927cdea3311cedcbbc48ac3fc422`). It is
redistributed under the Creative Commons Attribution 4.0 International license;
the full license text is in `content/LICENSE`.

This project began as a fork of
[`SeungheonOh/plfa-playground`](https://github.com/SeungheonOh/plfa-playground) by
Seungheon Oh, itself built on
[`agda-web/als-demo`](https://github.com/agda-web/als-demo). It has since been
rebased onto the
[`jespercockx/agda-playground`](https://github.com/jespercockx/agda-playground)
template; many thanks to Seungheon Oh for the original in-browser PLFA
playground.
