import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
const Resend = vi.fn(() => ({ emails: { send } }));
const createDocument = vi.fn();
const updateDocument = vi.fn();
const getDocument = vi.fn();

vi.mock("resend", () => ({ Resend }));

vi.mock("@/lib/queries/client", () => ({
  DATABASE_ID: "merism",
  getServerClient: () => ({
    databases: { createDocument, updateDocument, getDocument },
  }),
}));

const resendEnv = {
  RESEND_API_KEY: "re_test_key",
  RESEND_FROM_EMAIL: "mailer@example.com",
  RESEND_FROM_NAME: "Merism Mailer",
  APP_URL: "http://localhost:3000",
};

describe("server email helper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createDocument.mockResolvedValue({});
    updateDocument.mockResolvedValue({});
    getDocument.mockResolvedValue({});
  });

  it("returns null when the Resend key or sender is missing", async () => {
    const { resolveResendConfig, isResendEmailServiceAvailable } = await import("./email-core");

    expect(resolveResendConfig({ RESEND_API_KEY: "re_test_key" })).toBeNull();
    expect(isResendEmailServiceAvailable({ RESEND_API_KEY: "re_test_key" })).toBe(false);
  });

  it("resolves a Resend config without exposing it in the result", async () => {
    const { resolveResendConfig } = await import("./email-core");

    expect(resolveResendConfig(resendEnv)).toEqual({
      apiKey: "re_test_key",
      fromEmail: "mailer@example.com",
      fromName: "Merism Mailer",
      replyTo: undefined,
    });
  });

  it("reports unavailable without Resend configuration", async () => {
    const { sendEmail } = await import("./email-core");

    await expect(
      sendEmail({ to: [{ email: "to@example.com" }], subject: "Hello", text: "World" }, {}),
    ).resolves.toEqual({ status: "unavailable", reason: "resend_not_configured" });
    expect(Resend).not.toHaveBeenCalled();
  });

  it("sends a sanitized Resend payload with provider and ledger idempotency", async () => {
    send.mockResolvedValue({ data: { id: "resend_1" }, error: null });
    const { sendEmail } = await import("./email-core");

    const result = await sendEmail(
      {
        to: [{ email: "to@example.com", name: "Receiver" }],
        cc: [{ email: "cc@example.com", name: "Carbon" }],
        bcc: [{ email: "bcc@example.com" }],
        subject: "Test\r\nSubject",
        text: "Plain text",
        html: "<b>html</b>",
        campaignKey: "welcome_1",
        templateName: "researcher_welcome",
        headers: { "X-Custom": "A\r\nB" },
      },
      resendEnv,
    );

    expect(Resend).toHaveBeenCalledWith("re_test_key");
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Merism Mailer <mailer@example.com>",
        to: ["Receiver <to@example.com>"],
        cc: ["Carbon <cc@example.com>"],
        bcc: ["bcc@example.com"],
        subject: "Test Subject",
        headers: expect.objectContaining({
          "X-Merism-Campaign-Key": "welcome_1",
          "X-Merism-Template-Name": "researcher_welcome",
          "X-Custom": "A B",
        }),
      }),
      { idempotencyKey: expect.stringMatching(/^mail_[a-f0-9]{31}$/) },
    );
    expect(createDocument).toHaveBeenCalledWith(
      "merism",
      "email_deliveries",
      expect.stringMatching(/^mail_[a-f0-9]{31}$/),
      expect.objectContaining({ campaignKey: "welcome_1", status: "pending" }),
      [],
    );
    expect(updateDocument).toHaveBeenCalledWith(
      "merism",
      "email_deliveries",
      expect.any(String),
      expect.objectContaining({ status: "sent", messageId: "resend_1" }),
    );
    expect(result).toEqual({
      status: "sent",
      messageId: "resend_1",
      accepted: ["to@example.com"],
      rejected: [],
    });
  });

  it("deduplicates a campaign before calling Resend", async () => {
    createDocument.mockRejectedValueOnce({ code: 409 });
    getDocument.mockResolvedValueOnce({ status: "sent", messageId: "resend_existing" });
    const { sendEmail } = await import("./email-core");

    await expect(
      sendEmail(
        {
          to: [{ email: "to@example.com" }],
          subject: "Hello",
          text: "World",
          campaignKey: "welcome_1",
          templateName: "researcher_welcome",
        },
        resendEnv,
      ),
    ).resolves.toEqual({ status: "duplicate", reason: "sent", messageId: "resend_existing" });
    expect(send).not.toHaveBeenCalled();
  });

  it("marks a claimed delivery failed when Resend rejects the request", async () => {
    send.mockResolvedValue({ data: null, error: { message: "sender domain is not verified" } });
    const { EmailTransportError, sendEmail } = await import("./email-core");

    await expect(
      sendEmail(
        {
          to: [{ email: "to@example.com" }],
          subject: "Hello",
          text: "World",
          campaignKey: "welcome_1",
          templateName: "researcher_welcome",
        },
        resendEnv,
      ),
    ).rejects.toBeInstanceOf(EmailTransportError);
    expect(updateDocument).toHaveBeenCalledWith(
      "merism",
      "email_deliveries",
      expect.any(String),
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("builds a welcome email with escaped HTML content", async () => {
    const previousEnv = {
      RESEND_API_KEY: process.env.RESEND_API_KEY,
      RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
      RESEND_FROM_NAME: process.env.RESEND_FROM_NAME,
      APP_URL: process.env.APP_URL,
    };
    Object.assign(process.env, resendEnv);
    send.mockResolvedValue({ data: { id: "resend_welcome" }, error: null });

    const { sendResearcherWelcomeEmail } = await import("./email-core");
    await sendResearcherWelcomeEmail({ email: "to@example.com", name: "<Admin>" });

    Object.assign(process.env, previousEnv);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "欢迎来到 Merism",
        text: expect.stringContaining("进入工作区"),
        html: expect.stringContaining("&lt;Admin&gt;"),
      }),
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });
});
