import { expect, test } from "@playwright/test";

test("public homepage exposes the product and authentication routes", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: /让每一次访谈/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "登录" })).toHaveAttribute("href", "/login");
  await expect(page.getByRole("link", { name: "注册" })).toHaveAttribute("href", "/signup");
  await expect(page.getByRole("link", { name: "进入产品" }).first()).toHaveAttribute("href", "/home");
  await expect(page.getByText("预览题型")).toHaveCount(0);
});

for (const viewport of [
  { name: "mobile", width: 320, height: 720 },
  { name: "tablet", width: 768, height: 900 },
  { name: "desktop", width: 1024, height: 900 },
  { name: "wide", width: 1440, height: 1000 },
]) {
  test(`public homepage remains within the ${viewport.name} viewport`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");

    await expect(page.getByRole("main")).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
