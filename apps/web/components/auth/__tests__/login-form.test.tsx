// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
}));

vi.mock("@/lib/auth/actions", () => ({
  signInWithPassword: vi.fn(async () => ({ ok: true })),
  requestEmailOtp: vi.fn(async () => ({ ok: true })),
}));

import { LoginForm } from "../login-form";
import { signInWithPassword } from "@/lib/auth/actions";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LoginForm", () => {
  it("shows email and password together, then signs in with the intended callback", async () => {
    render(<LoginForm callbackUrl="/home" />);

    expect(screen.getByRole("heading", { name: "欢迎回来" })).toBeTruthy();
    expect(screen.getByLabelText("邮箱地址")).toBeTruthy();
    expect(screen.getByLabelText("密码")).toBeTruthy();
    expect(screen.queryByText(/自动选择最合适的登录方式/)).toBeNull();

    fireEvent.change(screen.getByLabelText("邮箱地址"), {
      target: { value: "researcher@example.com" },
    });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "Password1" } });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => {
      expect(signInWithPassword).toHaveBeenCalledWith("researcher@example.com", "Password1");
      expect(replace).toHaveBeenCalledWith("/home");
    });
  });
});
