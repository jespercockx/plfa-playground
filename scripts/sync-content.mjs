// Content pipeline for the site.
//
// Reads `playground.config.json` and every `.agda` / `.lagda.md` file under
// `content/`, then writes the browser-facing artifacts:
//
//   static/content/<group>/<file>       raw display sources
//   static/content/project.zip          Agda modules at library paths + adapters
//   static/content/manifest.json        index consumed by the UI and controller
//
// The precompiled interface archives under `static/content/interfaces/` are
// produced separately by `precompile-content.mjs` and are preserved here.
import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { browserAgdaSource } from "../src/lib/agda/browser-source.js";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const contentRoot = path.join(projectRoot, "content");
const outputRoot = path.join(projectRoot, "static", "content");
const config = JSON.parse(
  await readFile(path.join(projectRoot, "playground.config.json"), "utf8"),
);

// Directory prefix under which content modules are placed in the project
// archive. Agda derives a module's name from its path relative to the include
// root, so this must match what the sources declare (PLFA declares
// `module plfa.part1.Naturals where`, hence the `plfa` prefix). Defaults to the
// library name; set it to "" so a `content/Hello.agda` that says
// `module Hello where` lives at the include root.
const modulePrefix = config.modulePrefix ?? config.library;

// Where the browser gets Agda's precompiled standard-library interfaces from:
//   none         - never fetch them; Agda compiles anything it needs from source
//   same-origin  - serve them from this site under /stdlib-interfaces
//   cross-origin - fetch them from `baseUrl` (e.g. the dist repo's published tree)
const interfaceModes = ["none", "same-origin", "cross-origin"];
const interfaces = config.interfaces ?? { mode: "none" };
if (!interfaceModes.includes(interfaces.mode)) {
  throw new Error(
    `interfaces.mode must be one of ${interfaceModes.join(", ")}; ` +
      `got ${JSON.stringify(interfaces.mode)}`,
  );
}
if (interfaces.mode === "cross-origin" && !interfaces.baseUrl) {
  throw new Error(
    'interfaces.baseUrl is required when interfaces.mode is "cross-origin"',
  );
}

const chapterExtensions = [".lagda.md", ".lagda", ".agda"];
// Root-level files belong to a synthetic group with this id. The UI renders it
// without a group header, so a content root with a single ungrouped file looks
// like a plain list of chapters.
const rootGroupId = "content";
// Fixed timestamp so repeated runs produce byte-identical archives.
const archiveDate = new Date(Date.UTC(2020, 0, 1));

function chapterFileInfo(fileName) {
  const extension = chapterExtensions.find((candidate) =>
    fileName.endsWith(candidate),
  );
  return extension
    ? { extension, name: fileName.slice(0, -extension.length) }
    : null;
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function extractFrontmatter(source) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n?/);
  const title = match?.[1].match(/^title\s*:\s*["']?(.+?)["']?\s*$/m)?.[1];
  return title;
}

// A content root with no chapters is allowed: a blank starter has none, and
// the site simply shows no content tree.
let chapterFiles = [];
try {
  chapterFiles = (await walk(contentRoot))
    .filter((file) => chapterFileInfo(path.basename(file)))
    .map((file) => ({
      file,
      relative: path.relative(contentRoot, file).split(path.sep).join("/"),
    }));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (!chapterFiles.length) {
  console.warn(
    `No .agda or .lagda.md files found under ${contentRoot}; the site will have no content.`,
  );
}

const groups = new Map();
for (const { file, relative } of chapterFiles) {
  const segments = relative.split("/");
  const info = chapterFileInfo(segments.at(-1));
  const groupId = segments.length === 1 ? rootGroupId : segments[0];
  const chapterId =
    segments.length === 1
      ? info.name
      : segments.join("/").slice(0, -info.extension.length);
  const source = await readFile(file, "utf8");
  const title = extractFrontmatter(source);
  const chapter = {
    id: chapterId,
    name: info.name,
    fileName: segments.at(-1),
    title: title ?? info.name,
    sourcePath: `/content/${relative}`,
    modulePath: `/${modulePrefix ? `${modulePrefix}/` : ""}${relative}`,
    relative,
    source,
  };
  if (!groups.has(groupId)) groups.set(groupId, []);
  groups.get(groupId).push(chapter);
}

// Order groups by the config's key order, then any extras alphabetically.
const orderedGroupIds = [
  ...Object.keys(config.groups ?? {}).filter((id) => groups.has(id)),
  ...[...groups.keys()].filter((id) => !config.groups?.[id]).sort(),
];

for (const groupId of orderedGroupIds) {
  const chapters = groups.get(groupId);
  const order = config.order?.[groupId];
  chapters.sort((left, right) => {
    const leftIndex = order ? order.indexOf(left.name) : -1;
    const rightIndex = order ? order.indexOf(right.name) : -1;
    if (leftIndex !== -1 || rightIndex !== -1) {
      if (leftIndex === -1) return 1;
      if (rightIndex === -1) return -1;
      if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    }
    return left.id.localeCompare(right.id);
  });
}

// Keep the precompiled interface archives; everything else here is generated.
await mkdir(outputRoot, { recursive: true });
for (const entry of await readdir(outputRoot)) {
  if (entry === "interfaces") continue;
  await rm(path.join(outputRoot, entry), { recursive: true, force: true });
}

// The precompiled interface index is optional: it only exists after
// `precompile:content` has run. Advertising its presence lets the app skip a
// request that would 404 on a site without any precompiled interfaces.
const hasInterfaces = await stat(
  path.join(outputRoot, "interfaces", "manifest.json"),
).then(
  () => true,
  () => false,
);

const zip = new JSZip();
const rewrite = config.importRewrite ?? null;
const zipEntries = [];

zipEntries.push({
  path: `${config.library}.agda-lib`,
  content: `name: ${config.library}\ndepend: ${(config.dependencies ?? ["standard-library"]).join(", ")}\ninclude: .\n`,
});
for (const [zipPath, source] of Object.entries(rewrite?.modules ?? {})) {
  zipEntries.push({ path: zipPath, content: source });
}
for (const groupId of orderedGroupIds) {
  for (const chapter of groups.get(groupId)) {
    const displayPath = path.join(outputRoot, chapter.relative);
    await mkdir(path.dirname(displayPath), { recursive: true });
    await writeFile(displayPath, chapter.source);
    zipEntries.push({
      path: chapter.modulePath.replace(/^\//, ""),
      content: browserAgdaSource(chapter.modulePath, chapter.source, rewrite),
    });
  }
}

for (const entry of zipEntries) {
  zip.file(entry.path, entry.content, {
    date: archiveDate,
    createFolders: false,
  });
}
const projectZip = await zip.generateAsync({
  type: "nodebuffer",
  compression: "DEFLATE",
  compressionOptions: { level: 9 },
});

const hash = createHash("sha256");
for (const entry of [...zipEntries].sort((left, right) =>
  left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
)) {
  hash.update(entry.path);
  hash.update("\0");
  hash.update(entry.content);
  hash.update("\0");
}

const manifest = {
  title: config.title,
  source: config.source,
  license: config.license,
  library: config.library,
  hash: hash.digest("hex").slice(0, 16),
  contentInterfaces: hasInterfaces,
  // Where the browser fetches precompiled standard-library interfaces.
  interfaces: {
    mode: interfaces.mode,
    baseUrl: interfaces.baseUrl ?? null,
  },
  // Seeds the built-in playground document when set; absent means the app's
  // own default sample.
  playgroundSource: config.playgroundSource,
  importRewrite: rewrite
    ? {
        moduleRoot: rewrite.moduleRoot,
        imports: rewrite.imports ?? [],
        conditionalImports: rewrite.conditionalImports ?? [],
        stripSections: rewrite.stripSections ?? [],
      }
    : null,
  groups: orderedGroupIds.map((groupId) => ({
    id: groupId,
    title: config.groups?.[groupId] ?? groupId,
    flat: groupId === rootGroupId,
    chapters: groups.get(groupId).map((chapter) => ({
      id: chapter.id,
      name: chapter.name,
      fileName: chapter.fileName,
      title: chapter.title,
      sourcePath: chapter.sourcePath,
      modulePath: chapter.modulePath,
    })),
  })),
};

const writes = [
  writeFile(path.join(outputRoot, "project.zip"), projectZip),
  writeFile(
    path.join(outputRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  ),
];

if (config.licenseFile) {
  const licensePath = path.join(contentRoot, config.licenseFile);
  try {
    await stat(licensePath);
    writes.push(copyFile(licensePath, path.join(outputRoot, config.licenseFile)));
  } catch {
    // Optional.
  }
}
await Promise.all(writes);

const chapterCount = manifest.groups.reduce(
  (total, group) => total + group.chapters.length,
  0,
);
console.log(
  `Synced ${chapterCount} chapter(s) across ${manifest.groups.length} group(s) ` +
    `(content hash ${manifest.hash}).`,
);
