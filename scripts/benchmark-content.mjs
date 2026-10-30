import { execFileSync } from "node:child_process";
import { chromium } from "playwright-core";

const baseUrl = process.env.PLAYGROUND_URL ?? "http://127.0.0.1:5173/";
const selectedChapters = new Set(
  (process.env.CHAPTERS ?? "")
    .split(",")
    .map((chapter) => chapter.trim())
    .filter(Boolean),
);

function findChrome() {
  if (process.env.CHROME_EXECUTABLE) return process.env.CHROME_EXECUTABLE;
  for (const command of ["google-chrome", "chromium", "chromium-browser"]) {
    try {
      return execFileSync("which", [command], { encoding: "utf8" }).trim();
    } catch {
      // Try the next common executable name.
    }
  }
}

const executablePath = findChrome();
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const browserErrors = [];

page.on("pageerror", (error) =>
  browserErrors.push(`pageerror: ${error.message}`),
);
page.on("console", (message) => {
  if (message.type() === "error")
    browserErrors.push(`console: ${message.text()}`);
});

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(
    '.command-strip button[title^="Normalize"]:not([disabled])',
    { timeout: 180_000 },
  );
  await page.waitForSelector(".cm-content", { timeout: 10_000 });

  // Expand any collapsed groups; a flat content root has none.
  for (const button of await page.locator(".tree-part").all()) {
    if ((await button.getAttribute("aria-expanded")) === "false") {
      await button.click();
    }
  }

  async function checkCurrentChapter() {
    const startedAt = performance.now();
    await page.locator(".cm-content").click();
    await page.keyboard.press("Meta+Enter");
    await page.waitForTimeout(100);
    if (await page.locator(".abort-action").count()) {
      await page.waitForSelector(".abort-action", {
        state: "detached",
        timeout: 300_000,
      });
    } else {
      await page.waitForFunction(
        () =>
          document
            .querySelector(".statusbar")
            ?.textContent?.includes("Checked"),
        undefined,
        { timeout: 300_000 },
      );
    }
    return {
      milliseconds: Math.round(performance.now() - startedAt),
      status: await page.locator(".inspector-status").innerText(),
      problems: await page.locator(".problem-card.error").allInnerTexts(),
    };
  }

  const chapterLabels = (await page.locator(".chapter-row").allInnerTexts())
    .map((text) => text.trim())
    .filter(Boolean)
    .map((label) => ({
      label,
      name: label.replace(/\.(?:lagda\.md|agda)$/, ""),
    }))
    .filter(
      (chapter) =>
        selectedChapters.size === 0 || selectedChapters.has(chapter.name),
    );
  // A blank site has no chapters; check whatever the editor currently shows.
  const targets = chapterLabels.length
    ? chapterLabels.map((chapter) => ({
        ...chapter,
        literate: !chapter.label.endsWith(".agda"),
      }))
    : [{ label: null, name: "Main.agda", literate: false }];
  const results = [];

  for (const { label, name, literate } of targets) {
    if (label) {
      await page.locator(".chapter-row").filter({ hasText: label }).click();
      await page.waitForFunction(
        (expected) =>
          document
            .querySelector(".editor-tab")
            ?.textContent?.includes(expected),
        label,
        { timeout: 10_000 },
      );
      await page.waitForTimeout(300);
    }

    const initial = await checkCurrentChapter();
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+End");
    // A literate file needs a fenced block; a plain .agda file does not.
    const snippet = literate
      ? "\n\n```agda\nprivate\n  browserBenchmarkIdentity : ∀ {A : Set} → A → A\n  browserBenchmarkIdentity x = x\n```\n"
      : "\n\nprivate\n  browserBenchmarkIdentity : ∀ {A : Set} → A → A\n  browserBenchmarkIdentity x = x\n";
    await page.keyboard.insertText(snippet);
    const edited = await checkCurrentChapter();
    const result = { chapter: name, initial, edited };
    results.push(result);
    process.stderr.write(`${JSON.stringify(result)}\n`);
  }

  const failed =
    browserErrors.length > 0 ||
    results.length === 0 ||
    results.some(
      (result) =>
        result.initial.problems.length > 0 || result.edited.problems.length > 0,
    );
  console.log(JSON.stringify({ baseUrl, results, browserErrors }, null, 2));
  if (failed) process.exitCode = 1;
} finally {
  await browser.close();
}
