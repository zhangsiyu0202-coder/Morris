// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MarketingHome } from "../marketing-home";

afterEach(cleanup);

describe("MarketingHome", () => {
  it("routes researchers to authentication and the protected workspace", () => {
    render(<MarketingHome />);

    expect(screen.getByRole("link", { name: "登录" }).getAttribute("href")).toBe("/login");
    expect(screen.getByRole("link", { name: "注册" }).getAttribute("href")).toBe("/signup");
    expect(screen.getAllByRole("link", { name: "进入产品" })[0]?.getAttribute("href")).toBe("/home");
  });

  it("describes the product workflow without rendering the retired mock preview", () => {
    render(<MarketingHome />);

    expect(screen.getByRole("heading", { name: /让每一次访谈/ })).toBeTruthy();
    expect(screen.getByText("设计研究")).toBeTruthy();
    expect(screen.getByText("进行访谈")).toBeTruthy();
    expect(screen.getByText("理解证据")).toBeTruthy();
    expect(screen.queryByText("预览题型")).toBeNull();
  });
});
