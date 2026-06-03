import { test, expect } from "@playwright/test";

test("home page loads with 200 and no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "MerismV2" })).toBeVisible();
  expect(errors).toEqual([]);
});
