// Optional, config-driven source rewriting for bundled content.
//
// A content manifest may carry an `importRewrite` spec (built from
// `playground.config.json`) that maps wide standard-library modules onto narrow
// browser adapters. Every replacement is padded to the visible module name's
// exact width and only the first two ASCII bytes of a stripped line are
// touched, so all UTF-8 source offsets — and therefore highlighting, errors,
// and interaction points — stay aligned with the displayed literate source.
//
// Playground files (anything outside the spec's `moduleRoot`) are returned
// unchanged; with no spec the whole function is the identity.

/** @param {string} value */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Rewrite one import of `moduleName` to a position-compatible `replacement`.
 * The replacement must not be longer than the module name it replaces.
 * @param {string} source
 * @param {string} moduleName
 * @param {string} replacement
 */
export function replaceImport(source, moduleName, replacement) {
  if (replacement.length > moduleName.length) {
    throw new Error(`Browser module alias ${replacement} is too long`);
  }
  const positionCompatible = replacement.padEnd(moduleName.length, " ");
  const escaped = moduleName.replaceAll(".", "\\.");
  return source.replace(
    new RegExp(`(^\\s*(?:open\\s+)?import\\s+)${escaped}(?=\\s|$)`, "gm"),
    `$1${positionCompatible}`,
  );
}

/**
 * Comment out fenced `agda` blocks that only cross-reference modules in the
 * markdown section introduced by `heading`. These blocks are never opened or
 * used by a proof, and commenting the first two ASCII bytes on every non-empty
 * line leaves every later UTF-8 position intact.
 * @param {string} source
 * @param {string} heading
 */
export function stripSection(source, heading) {
  const headingPattern = new RegExp(
    `^#\\s+${escapeRegExp(heading)}\\s*$`,
    "im",
  );
  const headingMatch = headingPattern.exec(source);
  if (!headingMatch) return source;

  const sectionStart = headingMatch.index + headingMatch[0].length;
  const nextHeading = /^# /gm;
  nextHeading.lastIndex = sectionStart;
  const sectionEnd = nextHeading.exec(source)?.index ?? source.length;

  const section = source
    .slice(sectionStart, sectionEnd)
    .replace(
      /(```agda[^\n]*\n)([\s\S]*?)(```)/g,
      (block, opening, code, closing) => {
        const meaningful = code.replace(/--.*$/gm, "").trim();
        if (!meaningful.startsWith("import ") || code.length < 4) return block;
        const commented = code.replace(/^(.{2})/gm, "--");
        return `${opening}${commented}${closing}`;
      },
    );
  return source.slice(0, sectionStart) + section + source.slice(sectionEnd);
}

/**
 * Apply a content manifest's `importRewrite` spec to an editor's source. The
 * spec is opt-in: without one (or outside its `moduleRoot`) the source is
 * returned unchanged.
 * @param {string} filePath
 * @param {string} source
 * @param {{ moduleRoot?: string; stripSections?: readonly string[];
 *   imports?: ReadonlyArray<readonly [string, string]>;
 *   conditionalImports?: ReadonlyArray<{ from: string; when: string;
 *     then: string; otherwise: string }> } | null | undefined} [rewrite]
 */
export function browserAgdaSource(filePath, source, rewrite) {
  if (!rewrite?.moduleRoot || !filePath.startsWith(rewrite.moduleRoot)) {
    return source;
  }

  let result = source;
  for (const heading of rewrite.stripSections ?? []) {
    result = stripSection(result, heading);
  }
  for (const [moduleName, replacement] of rewrite.imports ?? []) {
    result = replaceImport(result, moduleName, replacement);
  }
  for (const rule of rewrite.conditionalImports ?? []) {
    const replacement = source.includes(rule.when) ? rule.then : rule.otherwise;
    result = replaceImport(result, rule.from, replacement);
  }
  return result;
}
