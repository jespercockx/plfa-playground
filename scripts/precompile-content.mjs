// Optional: precompile Agda interfaces for the bundled content so the browser
// does not type-check the standard library and every earlier chapter on first
// visit. Not run by default — it needs a native Agda 2.8.0 on PATH (see the
// dist repo's UPDATING.md for the matching binary).
//
// Reads `static/content/{project.zip,manifest.json}` written by
// `sync-content.mjs`, checks every chapter with native Agda, and writes one
// deduplicated lazy archive per chapter under `static/content/interfaces/`
// (including the standard-library interfaces each chapter needs). The main
// standard-library and project archives stay source-only, so nothing here
// mutates them — `sync-runtime` overwrites `static/agda-stdlib-*.zip` on every
// build anyway.
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const buildRoot = path.join(projectRoot, ".build-tmp");
const staticRoot = path.join(projectRoot, "static");
const contentRoot = path.join(staticRoot, "content");
const interfaceRoot = path.join(contentRoot, "interfaces");
const config = JSON.parse(
  await readFile(path.join(projectRoot, "playground.config.json"), "utf8"),
);
const agdaBinary = process.argv[2] ?? process.env.AGDA ?? "agda";

async function extract(zip, destination) {
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const target = path.resolve(destination, name);
    if (!target.startsWith(`${path.resolve(destination)}${path.sep}`)) {
      throw new Error(`Refusing unsafe archive path: ${name}`);
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await entry.async("nodebuffer"));
  }
}

async function findInterfaces(root) {
  const interfaces = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && entry.name.endsWith(".agdai"))
        interfaces.push(file);
    }
  }
  await visit(root);
  return interfaces;
}

function archivePath(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

async function collectRuntimeInterfaces(
  workingDirectory,
  stdlibRoot,
  stdlibBuild,
  projectBuild,
) {
  const [stdlibFiles, projectFiles] = await Promise.all([
    findInterfaces(stdlibBuild),
    findInterfaces(projectBuild),
  ]);
  return [
    ...stdlibFiles.map((file) => ({
      file,
      path: `stdlib/${archivePath(stdlibRoot, file)}`,
      library: "standard-library",
    })),
    ...projectFiles.map((file) => ({
      file,
      path: archivePath(workingDirectory, file),
      library: config.library,
    })),
  ];
}

async function writeInterfaceBundle(chapter, entries) {
  const zip = new JSZip();
  for (const entry of entries) zip.file(entry.path, await readFile(entry.file));
  const output = path.join(interfaceRoot, `${chapter.id}.zip`);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(
    output,
    await zip.generateAsync({
      type: "nodebuffer",
      compression: "STORE",
    }),
  );
}

const version = spawnSync(agdaBinary, ["--version"], { encoding: "utf8" });
if (version.error) throw version.error;
if (version.status !== 0 || !version.stdout.startsWith("Agda version 2.8.0")) {
  throw new Error(
    `Content interfaces require Agda 2.8.0; received ${version.stdout.trim() || "an unknown version"}`,
  );
}

const stdlibZipName = (await readdir(staticRoot)).find(
  (name) => name.startsWith("agda-stdlib-") && name.endsWith(".zip"),
);
if (!stdlibZipName) {
  throw new Error("Could not find static/agda-stdlib-*.zip; run npm run sync:runtime");
}

await mkdir(buildRoot, { recursive: true });
const workingDirectory = await mkdtemp(
  path.join(buildRoot, "content-interface-cache-"),
);

try {
  const [stdlibZip, projectZip] = await Promise.all([
    JSZip.loadAsync(await readFile(path.join(staticRoot, stdlibZipName))),
    JSZip.loadAsync(await readFile(path.join(contentRoot, "project.zip"))),
  ]);
  const sourceManifest = JSON.parse(
    await readFile(path.join(contentRoot, "manifest.json"), "utf8"),
  );
  await Promise.all([
    extract(stdlibZip, workingDirectory),
    extract(projectZip, workingDirectory),
  ]);

  const stdlibDirectory = (await readdir(workingDirectory, {
    withFileTypes: true,
  })).find(
    (entry) => entry.isDirectory() && entry.name.startsWith("agda-stdlib-"),
  );
  if (!stdlibDirectory) {
    throw new Error("Could not find the extracted standard library");
  }
  const stdlibRoot = path.join(workingDirectory, stdlibDirectory.name);
  const stdlibBuild = path.join(stdlibRoot, "_build");
  const projectBuild = path.join(workingDirectory, "_build");
  await Promise.all([
    rm(stdlibBuild, { recursive: true, force: true }),
    rm(projectBuild, { recursive: true, force: true }),
    rm(interfaceRoot, { recursive: true, force: true }),
  ]);

  const chapters = sourceManifest.groups.flatMap((group) => group.chapters);
  const bundledPaths = new Set();
  for (const [index, chapter] of chapters.entries()) {
    console.log(`[${index + 1}/${chapters.length}] ${chapter.id}`);
    const source = path.join(
      workingDirectory,
      chapter.modulePath.replace(/^\//, ""),
    );
    const result = spawnSync(
      agdaBinary,
      [
        "--warning=noUnsupportedIndexedMatch",
        "--no-libraries",
        "-i",
        workingDirectory,
        "-i",
        path.join(stdlibRoot, "src"),
        source,
      ],
      {
        cwd: projectRoot,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
      throw new Error(
        `Agda exited with status ${result.status} while checking ${chapter.id}`,
      );
    }

    const currentInterfaces = await collectRuntimeInterfaces(
      workingDirectory,
      stdlibRoot,
      stdlibBuild,
      projectBuild,
    );
    const newInterfaces = currentInterfaces.filter(
      (entry) => !bundledPaths.has(entry.path),
    );
    await writeInterfaceBundle(chapter, newInterfaces);
    for (const entry of newInterfaces) bundledPaths.add(entry.path);
  }

  const [stdlibInterfaces, projectInterfaces] = await Promise.all([
    findInterfaces(stdlibBuild),
    findInterfaces(projectBuild),
  ]);

  console.log(
    `Bundled ${stdlibInterfaces.length} standard-library interfaces and ${projectInterfaces.length} content interfaces across ${chapters.length} lazy archives.`,
  );
} finally {
  await rm(workingDirectory, { recursive: true, force: true });
}

await import("./index-content-interfaces.mjs");
