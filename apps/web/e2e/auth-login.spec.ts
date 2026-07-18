import { expect, test } from "@playwright/test";

test("researcher login keeps email and password in one form", async ({ page }) => {
  await page.goto("/login");

  await expect(page).toHaveTitle("登录 · Merism");
  await expect(page.getByRole("heading", { name: "欢迎回来" })).toBeVisible();
  await expect(page.getByLabel("邮箱地址")).toBeVisible();
  await expect(page.getByLabel("密码")).toBeVisible();
  await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
  await expect(page.getByText(/自动选择最合适的登录方式/)).toHaveCount(0);
});
