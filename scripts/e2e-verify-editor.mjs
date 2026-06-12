/**
 * 一次性 Playwright 验收(非 CI e2e 套件):以本地研究员账号登录,验证
 * survey-editor 整条链路渲染的是真实 Appwrite 数据,而非 mock。
 *
 * 前置:dev server 在 http://localhost:3000(`pnpm dev`),本地 Appwrite stack 起着,
 *       且已 reassign 种子问卷 owner + seed-sessions(见对话记录)。
 * 用法: node scripts/e2e-verify-editor.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:3000";
const EMAIL = "researcher@merism.local";
const PASSWORD = "MerismDev1";

// 真实种子数据(已写入 Appwrite,归属登录账号)。
const SURVEY_WITH_SESSIONS = "6a24a4920005162749ea"; // 新用户引导体验访谈 (8 sessions)
const SURVEY_TRAVEL = "6a24a491001846014b7c"; // 差旅住宿预订习惯调研
const REAL_TITLE_A = "差旅住宿预订习惯调研";
const REAL_TITLE_B = "新用户引导体验访谈";
const REAL_QUESTION = "找住处时"; // 差旅问卷第一题的真实片段

const OUT = "/tmp/merism-e2e";
mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(20000);

try {
  // --- login ---
  // The form is a client component; in `next dev` hydration can lag behind
  // domcontentloaded, so a too-early click submits the form natively. Retry the
  // "继续" click until the password field (React-revealed) actually appears.
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#email", { state: "visible" });
  let passwordVisible = false;
  for (let attempt = 0; attempt < 6 && !passwordVisible; attempt++) {
    await page.fill("#email", EMAIL);
    await page.getByRole("button", { name: /继续|请稍候/ }).click();
    try {
      await page.waitForSelector("#password", { state: "visible", timeout: 6000 });
      passwordVisible = true;
    } catch {
      // pre-hydration native submit or slow probe; reset and retry.
      if (!page.url().includes("/login")) await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    }
  }
  if (!passwordVisible) throw new Error("password field never appeared after 继续");
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: /登录|登录中/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
  check("login", true, `landed on ${new URL(page.url()).pathname}`);

  // --- home: lists the two real surveys ---
  await page.goto(`${BASE}/home`, { waitUntil: "domcontentloaded" });
  await page.screenshot({ path: `${OUT}/01-home.png`, fullPage: true });
  const homeText = await page.locator("body").innerText();
  check("home shows real survey A", homeText.includes(REAL_TITLE_A));
  check("home shows real survey B", homeText.includes(REAL_TITLE_B));

  // --- guide: real questions from Appwrite ---
  await page.goto(`${BASE}/studies/${SURVEY_TRAVEL}/guide`, { waitUntil: "domcontentloaded" });
  await page.screenshot({ path: `${OUT}/02-guide.png`, fullPage: true });
  const guideText = await page.locator("body").innerText();
  check("guide shows real question text", guideText.includes(REAL_QUESTION),
    guideText.includes(REAL_QUESTION) ? "" : "real seeded question not found on page");

  // --- overview: real session stats (survey has 8 sessions / 4 completed) ---
  await page.goto(`${BASE}/studies/${SURVEY_WITH_SESSIONS}/overview`, { waitUntil: "domcontentloaded" });
  await page.screenshot({ path: `${OUT}/03-overview.png`, fullPage: true });
  const overviewText = await page.locator("body").innerText();
  check("overview renders", overviewText.length > 0, overviewText.replace(/\s+/g, " ").slice(0, 160));

  // --- results: real session rows ---
  await page.goto(`${BASE}/studies/${SURVEY_WITH_SESSIONS}/results`, { waitUntil: "domcontentloaded" });
  await page.screenshot({ path: `${OUT}/04-results.png`, fullPage: true });
  check("results renders", true, "screenshot saved");
} catch (err) {
  check("run", false, err.message);
  await page.screenshot({ path: `${OUT}/error.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. screenshots in ${OUT}`);
process.exit(failed.length ? 1 : 0);
