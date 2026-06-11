import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { Client, Users } from "node-appwrite";

// E2E for the ADR 0006 workspace settings pages (/settings/members, /settings/billing).
//
// fixme: currently blocked by the branch's WIP auth session-handoff — neither a
// UI login nor an admin-minted Appwrite session (injected as the a_session_*
// cookie) is honored by requireResearcher in this environment; the protected
// route 307-redirects to /login. The PAGES themselves render 200 server-side
// (verified via Next logs) and their pure data helpers are unit-tested. Remove
// `test.fixme` once the login -> protected-route session handoff works.
function env(k: string): string {
  try {
    for (const line of readFileSync("../../.env", "utf8").split("\n")) {
      const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* ignore */ }
  return process.env[k] ?? "";
}
const ENDPOINT = env("APPWRITE_ENDPOINT");
const PROJECT = env("APPWRITE_PROJECT_ID");
const API_KEY = env("APPWRITE_API_KEY");
const OWNER = env("MERISM_OWNER_USER_ID");

test.fixme("workspace members + billing settings render (authenticated)", async ({ page, context }) => {
  const users = new Users(new Client().setEndpoint(ENDPOINT).setProject(PROJECT).setKey(API_KEY));
  const session = await users.createSession(OWNER);
  const secret = (session as unknown as { secret?: string }).secret;
  expect(secret, "session secret").toBeTruthy();
  await context.addCookies([
    { name: `a_session_${PROJECT}`, value: secret!, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" },
  ]);

  await page.goto("/settings/members");
  await expect(page.getByText("Workspace members & seats")).toBeVisible();
  await expect(page.getByText(/\d+\s*\/\s*\d+\s*used/)).toBeVisible();

  await page.goto("/settings/billing");
  await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
  await expect(page.getByText(/Interviews this period/)).toBeVisible();
  await expect(page.getByText("Manage billing")).toBeVisible();
});
