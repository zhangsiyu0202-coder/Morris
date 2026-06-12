import { test, expect } from "@playwright/test";

// E2E for the ADR 0006 workspace settings pages. Real UI login with the local
// researcher account (docs/dev/local-researcher-account.md) against the running
// stack, then asserts the members + billing settings render.
test("workspace members + billing settings render after login", async ({ page }) => {
  await page.goto("/login?callbackUrl=" + encodeURIComponent("/settings/members"));
  await page.locator("#email").fill("researcher@merism.local");
  await page.getByRole("button", { name: "继续" }).click();
  await page.locator("#password").fill("MerismDev1");
  await page.getByRole("button", { name: "登录" }).click();

  await page.waitForURL("**/settings/members", { timeout: 25_000 });
  await expect(page.getByText("Workspace members & seats")).toBeVisible();
  await expect(page.getByText(/\d+\s*\/\s*\d+\s*used/)).toBeVisible();

  await page.goto("/settings/billing");
  await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
  await expect(page.getByText(/Interviews this period/)).toBeVisible();
  await expect(page.getByText("Manage billing")).toBeVisible();
});
