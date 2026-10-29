// Copies the Agda/ALS runtime artifacts out of the `vendor/` submodule(s) into
// `static/`, and regenerates `src/lib/runtime-manifest.ts` from the dist repo's
// `dist-manifest.json`.
//
// The distribution repository (jespercockx/agda-als-dist) uses one branch per
// Agda release, so this template checks out one submodule per supported
// version under `vendor/`. Every submodule carries its own `dist-manifest.json`;
// this script discovers them (depth-first, ignoring `.git`) so adding a version
// needs no changes here.
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const vendorRoot = path.join(projectRoot, "vendor");
const staticRoot = path.join(projectRoot, "static");
const manifestOutput = path.join(
  projectRoot,
  "src",
  "lib",
  "runtime-manifest.ts",
);

const maxDiscoveryDepth = 3;

/** Recursively locate `dist-manifest.json` files under `vendor/`. */
async function findDistManifests(directory, depth) {
  if (depth > maxDiscoveryDepth) return [];

  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === ".git") continue;
    const child = path.join(directory, entry.name);
    const candidate = path.join(child, "dist-manifest.json");
    try {
      await stat(candidate);
      found.push(candidate);
    } catch {
      found.push(...(await findDistManifests(child, depth + 1)));
    }
  }
  return found;
}

function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

/** Copy `source` to `static/<basename>` unless an equally sized copy is present. */
async function syncArtifact(source, expectedByteLength, label) {
  let actualByteLength;
  try {
    actualByteLength = (await stat(source)).size;
  } catch {
    throw new Error(
      `missing ${label} at ${path.relative(projectRoot, source)}; ` +
        `run \`git submodule update --init --recursive\``,
    );
  }
  if (expectedByteLength != null && actualByteLength !== expectedByteLength) {
    throw new Error(
      `${label} is ${actualByteLength} bytes but dist-manifest.json expects ` +
        `${expectedByteLength}; the submodule checkout is incomplete`,
    );
  }

  const destination = path.join(staticRoot, path.basename(source));
  try {
    const existing = await stat(destination);
    if (existing.size === actualByteLength) return { destination, copied: false };
  } catch {
    // Not present yet.
  }

  await copyFile(source, destination);
  return { destination, copied: true };
}

async function readVersion(manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const directory = path.dirname(manifestPath);

  const wasm = await syncArtifact(
    path.join(directory, manifest.wasm.path),
    manifest.wasm.byteLength,
    "ALS wasm",
  );
  const compressed = await syncArtifact(
    path.join(directory, manifest.wasm.compressedPath),
    manifest.wasm.compressedByteLength,
    "compressed ALS wasm",
  );
  const data = await syncArtifact(
    path.join(directory, manifest.data.path),
    manifest.data.byteLength,
    "Agda data archive",
  );
  const stdlib = await syncArtifact(
    path.join(directory, manifest.stdlib.path),
    manifest.stdlib.byteLength,
    "Agda standard library archive",
  );

  return {
    manifest,
    copied: [wasm, compressed, data, stdlib].filter((entry) => entry.copied)
      .length,
    entry: {
      agdaVersion: manifest.agdaVersion,
      stdlibVersion: manifest.stdlibVersion,
      path: `/${path.basename(manifest.wasm.path)}`,
      compressedPath: `/${path.basename(manifest.wasm.compressedPath)}`,
      byteLength: manifest.wasm.byteLength,
      cacheBust: manifest.wasm.cacheBust,
      stdlibCandidates: [manifest.stdlibVersion],
      data: {
        path: `/${path.basename(manifest.data.path)}`,
        byteLength: manifest.data.byteLength,
        interfaceDir: manifest.data.interfaceDir,
      },
      stdlib: {
        path: `/${path.basename(manifest.stdlib.path)}`,
        byteLength: manifest.stdlib.byteLength,
      },
    },
  };
}

function renderManifest(entries) {
  const versions = entries
    .map(
      (entry) => `  {
    agdaVersion: ${JSON.stringify(entry.agdaVersion)},
    stdlibVersion: ${JSON.stringify(entry.stdlibVersion)},
    path: ${JSON.stringify(entry.path)},
    compressedPath: ${JSON.stringify(entry.compressedPath)},
    byteLength: ${entry.byteLength},
    cacheBust: ${JSON.stringify(entry.cacheBust)},
    stdlibCandidates: [${entry.stdlibCandidates.map((value) => JSON.stringify(value)).join(", ")}],
    data: {
      path: ${JSON.stringify(entry.data.path)},
      byteLength: ${entry.data.byteLength},
      interfaceDir: ${JSON.stringify(entry.data.interfaceDir)},
    },
    stdlib: {
      path: ${JSON.stringify(entry.stdlib.path)},
      byteLength: ${entry.stdlib.byteLength},
    },
  },`,
    )
    .join("\n");

  return `// Generated by scripts/sync-runtime.mjs. Do not edit by hand.
//
// One entry per Agda version shipped under \`vendor/\` (agda-als-dist, one
// submodule per version branch). \`path\` values are root-relative static asset
// URLs; the controller applies SvelteKit's base path and a cache-bust suffix.

export interface RuntimeDataSpec {
  path: string;
  byteLength: number;
  /** Virtual location of Agda's primitive interfaces inside \`path\`. */
  interfaceDir: string;
}

export interface RuntimeStdlibSpec {
  path: string;
  byteLength: number;
}

export interface RuntimeVersionSpec {
  agdaVersion: string;
  stdlibVersion: string;
  path: string;
  compressedPath: string;
  /** Uncompressed wasm length, used as \`Content-Length\` when inflating the gzip copy. */
  byteLength: number;
  /** Artifact-derived token appended to asset URLs to defeat stale caches. */
  cacheBust: string;
  /** Acceptable standard-library versions, most recent first. */
  stdlibCandidates: readonly string[];
  data: RuntimeDataSpec;
  stdlib: RuntimeStdlibSpec;
}

export const runtimeManifest = [
${versions}
] as const satisfies readonly RuntimeVersionSpec[];
`;
}

await mkdir(staticRoot, { recursive: true });

const manifestPaths = await findDistManifests(vendorRoot, 0);
if (manifestPaths.length === 0) {
  console.error(
    "No vendor/*/dist-manifest.json found. Initialize the runtime submodules " +
      "with:\n  git submodule update --init --recursive",
  );
  process.exit(1);
}

const versions = [];
let copied = 0;
for (const manifestPath of manifestPaths.sort()) {
  const version = await readVersion(manifestPath);
  versions.push(version.entry);
  copied += version.copied;
}
versions.sort((left, right) =>
  compareVersions(left.agdaVersion, right.agdaVersion),
);

await writeFile(manifestOutput, renderManifest(versions));

console.log(
  `Synced ${versions.length} Agda runtime version(s) ` +
    `(${versions.map((version) => version.agdaVersion).join(", ")}); ` +
    `${copied} artifact(s) copied to static/.`,
);
