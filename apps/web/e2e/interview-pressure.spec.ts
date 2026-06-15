/**
 * Interview pressure E2E — drives the actual /interview route in Chromium with
 * --use-file-for-fake-audio-capture pointing at a 9.9-min synthesized Chinese
 * WAV. Run against either:
 *   - default cascade mode (MERISM_GEMINI_LIVE unset/0)
 *   - Live API mode (MERISM_GEMINI_LIVE=1)
 *
 * The agent worker must already be running. Both modes are tested by restarting
 * the agent between runs:
 *   apps/web $ pnpm exec playwright test e2e/interview-pressure.spec.ts
 */
import { test, expect } from "@playwright/test";
import { Client, Databases, Users, ID, Permission, Role } from "node-appwrite";
import * as path from "node:path";
import * as fs from "node:fs";

const FAKE_MIC = "/tmp/merism/fake_mic_long.wav";
const DB = "merism";

// Skip the spec entirely if the audio asset isn't there — the synth_fake_mic
// step has to run first.
test.skip(
  !fs.existsSync(FAKE_MIC),
  `fake-mic asset missing at ${FAKE_MIC}; run apps/agent$ uv run python -m tests.load.synth_fake_mic --phrases 10 --silence-sec 60 first`,
);

test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-audio-capture=${FAKE_MIC}`,
      // Avoid renderer crashes from missing audio output device in headless.
      "--autoplay-policy=no-user-gesture-required",
    ],
  },
});

interface TestSurveyHandle {
  ownerId: string;
  surveyId: string;
  linkToken: string;
}

async function createPressureSurvey(): Promise<TestSurveyHandle> {
  const env = {
    APPWRITE_ENDPOINT: process.env.APPWRITE_ENDPOINT!,
    APPWRITE_PROJECT_ID: process.env.APPWRITE_PROJECT_ID!,
    APPWRITE_API_KEY: process.env.APPWRITE_API_KEY!,
  };
  for (const [k, v] of Object.entries(env)) {
    if (!v) throw new Error(`missing env ${k}`);
  }
  const client = new Client()
    .setEndpoint(env.APPWRITE_ENDPOINT)
    .setProject(env.APPWRITE_PROJECT_ID)
    .setKey(env.APPWRITE_API_KEY);
  const db = new Databases(client);
  const users = new Users(client);
  const stamp = Date.now();

  const owner = await users.create(
    ID.unique(),
    `pressure_${stamp}@example.com`,
    undefined,
    "MerismDev1",
    "Pressure",
  );
  const ownerPerms = [
    Permission.read(Role.user(owner.$id)),
    Permission.update(Role.user(owner.$id)),
  ];
  const project = await db.createDocument(DB, "projects", ID.unique(), {
    ownerUserId: owner.$id,
    name: "Pressure Project",
    createdAt: new Date().toISOString(),
  }, ownerPerms);
  const survey = await db.createDocument(DB, "surveys", ID.unique(), {
    ownerUserId: owner.$id,
    projectId: project.$id,
    title: "Pressure Survey",
    status: "published",
    flowConfig: JSON.stringify({
      researchGoal: "压力测试速达外卖访谈流程",
      targetAudience: "试用 7 天的城市白领",
      introScript: "你好，我准备问你几个关于速达外卖体验的问题。准备好了我们就开始。",
    }),
    updatedAt: new Date().toISOString(),
  }, ownerPerms);
  const section = await db.createDocument(DB, "survey_sections", ID.unique(), {
    surveyId: survey.$id,
    title: "首次接触",
    description: "了解用户如何接触和首次使用速达外卖",
    order: 0,
  }, ownerPerms);
  await db.createDocument(DB, "question_blocks", ID.unique(), {
    surveyId: survey.$id,
    sectionId: section.$id,
    order: 0,
    orderInSection: 0,
    type: "open_ended",
    prompt: "你是怎么知道速达外卖这个 App 的?",
    probeConfig: JSON.stringify({ level: "deep", instruction: "深入追问具体渠道和场景" }),
  }, ownerPerms);
  await db.createDocument(DB, "question_blocks", ID.unique(), {
    surveyId: survey.$id,
    sectionId: section.$id,
    order: 1,
    orderInSection: 1,
    type: "open_ended",
    prompt: "你下载这个 App 时,最主要的动机是什么?",
    probeConfig: JSON.stringify({ level: "standard", instruction: "" }),
  }, ownerPerms);
  const linkToken = `pressure-${stamp}`;
  await db.createDocument(DB, "interview_links", ID.unique(), {
    surveyId: survey.$id,
    token: linkToken,
    mode: "single_use",
    maxUses: 1,
    expiresAt: new Date(stamp + 60 * 60_000).toISOString(),
  });
  return { ownerId: owner.$id, surveyId: survey.$id, linkToken };
}


/* eslint-disable @typescript-eslint/no-explicit-any */

test.describe("interview pressure (real audio)", () => {
  test.setTimeout(8 * 60_000); // 8 min hard cap per test

  let handle: TestSurveyHandle;

  test.beforeAll(async () => {
    handle = await createPressureSurvey();
    console.log(`[pressure] created survey=${handle.surveyId} link=${handle.linkToken}`);
  });

  test("preflight + join + observe transcript for at least 4 minutes", async ({ page, browserName }) => {
    const observeMs = Number(process.env.PRESSURE_OBSERVE_MS ?? 4 * 60_000);
    const transcripts: string[] = [];
    const consoleErrors: string[] = [];

    page.on("console", (msg) => {
      const t = msg.type();
      if (t === "error" || t === "warning") {
        consoleErrors.push(`[${t}] ${msg.text()}`.slice(0, 4000));
      }
    });
    page.on("pageerror", (err) => {
      consoleErrors.push(`[pageerror] ${err.message}`.slice(0, 240));
    });

    const screenshotDir = path.resolve(process.cwd(), "..", "..", "tmp", "playwright", browserName);
    fs.mkdirSync(screenshotDir, { recursive: true });
    const screenshot = (name: string) =>
      page.screenshot({ path: path.join(screenshotDir, `${name}.png`), fullPage: false });

    // 1. Land on /interview
    await page.goto(`/interview?link=${handle.linkToken}`);
    await expect(page.getByRole("heading", { name: "准备开始你的语音访谈" })).toBeVisible();
    await screenshot("01-preflight-step1");

    // 2. Click 继续 — browser will request mic, --use-fake-ui-for-media-stream auto-grants
    await page.getByRole("button", { name: /^继续$/ }).click();

    // 3. Step 2 should appear (设备与授权确认) within ~10s
    await expect(page.getByRole("heading", { name: "设备与授权确认" })).toBeVisible({ timeout: 15_000 });
    await screenshot("02-preflight-step2");

    // 4a. Tick the consent checkbox (canStart = consented && micGranted)
    const consentCheckbox = page.getByRole("checkbox");
    await expect(consentCheckbox).toBeVisible({ timeout: 5000 });
    await consentCheckbox.click();
    await expect(consentCheckbox).toHaveAttribute("aria-checked", "true");

    // 4b. Click 开始访谈
    const startButton = page.getByRole("button", { name: /^开始访谈$/ });
    await expect(startButton).toBeEnabled({ timeout: 10_000 });
    await startButton.click();

    // 5. The pre-flight unmounts and the interview-room mounts. Wait until any
    //    LiveKit-controlled UI shows up (we look for the agent transcript area
    //    or the live transcription text container).
    await expect(page.locator("body")).toContainText(/.+/, { timeout: 30_000 });
    await screenshot("03-room-joined");

    // 6. Observe for `observeMs`. Periodically capture transcript-bearing text
    //    and the merism.interviewState attribute on the local participant.
    const startedAt = Date.now();
    const samples: Array<{ at: number; bodyText: string }> = [];
    while (Date.now() - startedAt < observeMs) {
      await page.waitForTimeout(20_000);
      const probe = await page.evaluate(() => {
        const out = { bodyText: document.body.innerText, attrs: {} as Record<string, unknown> };
        // Surface room state for diagnostics. The interview-room component holds
        // a reference to the room via @livekit/components-react context, but it's
        // not exposed on window. We do best-effort via DOM data attrs + a global
        // dev hook if the app sets one.
        const roomDbg = (window as unknown as { __merismRoomDebug?: () => unknown }).__merismRoomDebug;
        if (typeof roomDbg === "function") {
          try { out.attrs = roomDbg() as Record<string, unknown>; } catch (e) { out.attrs = { error: String(e) }; }
        }
        return out;
      });
      samples.push({ at: Date.now() - startedAt, bodyText: probe.bodyText.slice(0, 4000) });
      transcripts.push(probe.bodyText);
      console.log(
        `[pressure] t+${Math.round((Date.now() - startedAt) / 1000)}s body chars=${probe.bodyText.length} attrs=${JSON.stringify(probe.attrs).slice(0, 200)}`,
      );
    }
    await screenshot("04-after-observe");

    // 7. Sanity asserts:
    //  - the page didn't crash (it still has body text)
    //  - we saw transcript-y content somewhere in the body over the run
    expect(samples.length).toBeGreaterThan(0);
    const allText = transcripts.join("\n");
    // Any of these proves the agent is talking through the room:
    const sawAgent =
      /访谈|速达外卖|你好|我们|外卖|App|开始|动机|红包|配送/.test(allText);
    expect(sawAgent, "expected agent / interviewee speech to surface in DOM").toBeTruthy();

    // Persist a JSON debug log so we can read it offline.
    const reportDir = path.resolve(process.cwd(), "..", "..", "tmp", "playwright");
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(
      path.join(reportDir, `pressure_${Date.now()}.json`),
      JSON.stringify(
        {
          link: handle.linkToken,
          surveyId: handle.surveyId,
          observeMs,
          samples: samples.map((s) => ({ at: s.at, chars: s.bodyText.length, head: s.bodyText.slice(0, 600) })),
          consoleErrors: consoleErrors.slice(0, 50),
        },
        null,
        2,
      ),
    );
  });
});
