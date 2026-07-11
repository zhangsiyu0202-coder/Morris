import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.fn();
const verify = vi.fn();
const close = vi.fn();
const createTransport = vi.fn(() => ({ sendMail, verify, close }));
const createDocument = vi.fn();
const updateDocument = vi.fn();
const getDocument = vi.fn();

vi.mock("nodemailer", () => ({
  default: {
    createTransport,
  },
}));

vi.mock("@/lib/queries/client", () => ({
  DATABASE_ID: "merism",
  getServerClient: () => ({
    databases: {
      createDocument,
      updateDocument,
      getDocument,
    },
  }),
}));

describe("server email helper", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    createDocument.mockResolvedValue({});
    updateDocument.mockResolvedValue({});
    getDocument.mockResolvedValue({});
  });

  it("returns null when required SMTP env is missing", async () => {
    const { resolveSmtpConfig, isSmtpEmailServiceAvailable } = await import("./email-core");

    expect(resolveSmtpConfig({ SMTP_SERVICE: "QQ" })).toBeNull();
    expect(isSmtpEmailServiceAvailable({ SMTP_SERVICE: "QQ" })).toBe(false);
  });

  it("resolves a QQ SMTP config with secure defaults", async () => {
    const { resolveSmtpConfig } = await import("./email-core");

    expect(
      resolveSmtpConfig({
        SMTP_SERVICE: "QQ",
        SMTP_USER: "mailer@qq.com",
        SMTP_PASSWORD: "secret",
        SMTP_FROM_EMAIL: "mailer@qq.com",
      }),
    ).toEqual({
      service: "QQ",
      host: undefined,
      port: 465,
      secure: true,
      requireTls: false,
      user: "mailer@qq.com",
      password: "secret",
      fromEmail: "mailer@qq.com",
      fromName: "Merism",
      replyTo: undefined,
      proxy: undefined,
      pool: false,
      maxConnections: undefined,
      maxMessages: undefined,
    });
  });

  it("supports pool and proxy config from env", async () => {
    const { resolveSmtpConfig } = await import("./email-core");

    expect(
      resolveSmtpConfig({
        SMTP_HOST: "smtp.qq.com",
        SMTP_PORT: "587",
        SMTP_SECURE: "0",
        SMTP_REQUIRE_TLS: "1",
        SMTP_USER: "mailer@qq.com",
        SMTP_PASSWORD: "secret",
        SMTP_FROM_EMAIL: "mailer@qq.com",
        SMTP_POOL: "1",
        SMTP_MAX_CONNECTIONS: "3",
        SMTP_MAX_MESSAGES: "25",
        HTTP_PROXY: "http://127.0.0.1:57777",
      }),
    ).toEqual({
      service: undefined,
      host: "smtp.qq.com",
      port: 587,
      secure: false,
      requireTls: true,
      user: "mailer@qq.com",
      password: "secret",
      fromEmail: "mailer@qq.com",
      fromName: "Merism",
      replyTo: undefined,
      proxy: "http://127.0.0.1:57777",
      pool: true,
      maxConnections: 3,
      maxMessages: 25,
    });
  });

  it("sanitizes header values by stripping CRLF", async () => {
    const { sanitizeHeaderValue } = await import("./email-core");
    expect(sanitizeHeaderValue("Hello\r\nWorld")).toBe("Hello World");
  });

  it("reports unavailable when absolute urls are required without APP_URL", async () => {
    const { getBusinessEmailAvailability } = await import("./email-core");

    expect(
      getBusinessEmailAvailability(
        { requireAbsoluteUrls: true },
        {
          SMTP_SERVICE: "QQ",
          SMTP_USER: "mailer@qq.com",
          SMTP_PASSWORD: "secret",
          SMTP_FROM_EMAIL: "mailer@qq.com",
        },
      ),
    ).toEqual({
      enabled: false,
      smtpConfigured: true,
      appUrlConfigured: false,
      requiresAbsoluteUrls: true,
      reason: "app_url_not_configured",
    });
  });

  it("returns unavailable without SMTP config", async () => {
    const { sendEmail } = await import("./email-core");

    await expect(
      sendEmail(
        {
          to: [{ email: "to@example.com" }],
          subject: "Hello",
          text: "World",
        },
        {},
      ),
    ).resolves.toEqual({ status: "unavailable", reason: "smtp_not_configured" });
    expect(createTransport).not.toHaveBeenCalled();
  });

  it("sends mail through nodemailer when config is present", async () => {
    sendMail.mockResolvedValue({
      messageId: "mid_1",
      accepted: ["to@example.com"],
      rejected: [],
    });

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
        headers: {
          "X-Custom": "A\r\nB",
        },
        attachments: [
          {
            filename: "summary.txt",
            content: "hello",
          },
        ],
      },
      {
        SMTP_SERVICE: "QQ",
        SMTP_USER: "mailer@qq.com",
        SMTP_PASSWORD: "secret",
        SMTP_FROM_EMAIL: "mailer@qq.com",
        SMTP_FROM_NAME: "Merism Mailer",
      },
    );

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        service: "QQ",
        port: 465,
        secure: true,
        auth: {
          user: "mailer@qq.com",
          pass: "secret",
        },
      }),
      {
        from: { address: "mailer@qq.com", name: "Merism Mailer" },
        replyTo: undefined,
      },
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Test Subject",
        to: [{ address: "to@example.com", name: "Receiver" }],
        cc: [{ address: "cc@example.com", name: "Carbon" }],
        bcc: [{ address: "bcc@example.com", name: undefined }],
        headers: {
          "X-Merism-Campaign-Key": "welcome_1",
          "X-Merism-Template-Name": "researcher_welcome",
          "X-Custom": "A B",
        },
      }),
    );
    expect(createDocument).toHaveBeenCalledWith(
      "merism",
      "email_deliveries",
      expect.stringMatching(/^mail_[a-f0-9]{31}$/),
      expect.objectContaining({
        campaignKey: "welcome_1",
        templateName: "researcher_welcome",
        status: "pending",
      }),
      [],
    );
    expect(updateDocument).toHaveBeenCalledWith(
      "merism",
      "email_deliveries",
      expect.any(String),
      expect.objectContaining({
        status: "sent",
        messageId: "mid_1",
      }),
    );
    expect(close).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      status: "sent",
      messageId: "mid_1",
      accepted: ["to@example.com"],
      rejected: [],
    });
  });

  it("verifies SMTP config via nodemailer", async () => {
    verify.mockResolvedValue(true);

    const { verifySmtpConnection } = await import("./email-core");
    await expect(
      verifySmtpConnection({
        SMTP_SERVICE: "QQ",
        SMTP_USER: "mailer@qq.com",
        SMTP_PASSWORD: "secret",
        SMTP_FROM_EMAIL: "mailer@qq.com",
      }),
    ).resolves.toBe("verified");

    expect(verify).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("treats send as successful when smtp succeeds but delivery status persistence fails", async () => {
    sendMail.mockResolvedValue({
      messageId: "mid_persist_error",
      accepted: ["to@example.com"],
      rejected: [],
    });
    updateDocument.mockRejectedValueOnce(new Error("writeback_failed"));

    const { sendEmail } = await import("./email-core");
    const result = await sendEmail(
      {
        to: [{ email: "to@example.com" }],
        subject: "Hello",
        text: "World",
        campaignKey: "welcome_persist_fail",
        templateName: "researcher_welcome",
      },
      {
        SMTP_SERVICE: "QQ",
        SMTP_USER: "mailer@qq.com",
        SMTP_PASSWORD: "secret",
        SMTP_FROM_EMAIL: "mailer@qq.com",
      },
    );

    expect(result).toEqual({
      status: "sent",
      messageId: "mid_persist_error",
      accepted: ["to@example.com"],
      rejected: [],
    });
  });

  it("reuses a cached transporter for process env sends", async () => {
    sendMail.mockResolvedValue({
      messageId: "mid_cached",
      accepted: ["to@example.com"],
      rejected: [],
    });

    const previousEnv = {
      SMTP_SERVICE: process.env.SMTP_SERVICE,
      SMTP_USER: process.env.SMTP_USER,
      SMTP_PASSWORD: process.env.SMTP_PASSWORD,
      SMTP_FROM_EMAIL: process.env.SMTP_FROM_EMAIL,
      APP_URL: process.env.APP_URL,
    };
    process.env.SMTP_SERVICE = "QQ";
    process.env.SMTP_USER = "mailer@qq.com";
    process.env.SMTP_PASSWORD = "secret";
    process.env.SMTP_FROM_EMAIL = "mailer@qq.com";
    process.env.APP_URL = "http://localhost:3000";

    const { sendResearcherWelcomeEmail, closeCachedSmtpTransport } = await import("./email-core");
    await sendResearcherWelcomeEmail({ email: "to@example.com", name: "First" });
    await sendResearcherWelcomeEmail({ email: "to@example.com", name: "Second" });

    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(0);
    expect(createDocument).toHaveBeenCalledTimes(2);

    closeCachedSmtpTransport();
    expect(close).toHaveBeenCalledTimes(1);

    process.env.SMTP_SERVICE = previousEnv.SMTP_SERVICE;
    process.env.SMTP_USER = previousEnv.SMTP_USER;
    process.env.SMTP_PASSWORD = previousEnv.SMTP_PASSWORD;
    process.env.SMTP_FROM_EMAIL = previousEnv.SMTP_FROM_EMAIL;
    process.env.APP_URL = previousEnv.APP_URL;
  });

  it("builds a welcome email with escaped html content", async () => {
    sendMail.mockResolvedValue({
      messageId: "mid_welcome",
      accepted: ["to@example.com"],
      rejected: [],
    });

    const { sendResearcherWelcomeEmail, closeCachedSmtpTransport } = await import("./email-core");
    const previousEnv = {
      SMTP_SERVICE: process.env.SMTP_SERVICE,
      SMTP_USER: process.env.SMTP_USER,
      SMTP_PASSWORD: process.env.SMTP_PASSWORD,
      SMTP_FROM_EMAIL: process.env.SMTP_FROM_EMAIL,
      APP_URL: process.env.APP_URL,
    };
    process.env.SMTP_SERVICE = "QQ";
    process.env.SMTP_USER = "mailer@qq.com";
    process.env.SMTP_PASSWORD = "secret";
    process.env.SMTP_FROM_EMAIL = "mailer@qq.com";
    process.env.APP_URL = "http://localhost:3000";
    await sendResearcherWelcomeEmail({ email: "to@example.com", name: "<Admin>" });
    closeCachedSmtpTransport();
    process.env.SMTP_SERVICE = previousEnv.SMTP_SERVICE;
    process.env.SMTP_USER = previousEnv.SMTP_USER;
    process.env.SMTP_PASSWORD = previousEnv.SMTP_PASSWORD;
    process.env.SMTP_FROM_EMAIL = previousEnv.SMTP_FROM_EMAIL;
    process.env.APP_URL = previousEnv.APP_URL;

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "欢迎来到 Merism",
        text: expect.stringContaining("进入工作区"),
        html: expect.stringContaining("&lt;Admin&gt;"),
      }),
    );
  });

  it("sanitizes template context in BusinessEmailMessage", async () => {
    sendMail.mockResolvedValue({
      messageId: "mid_template",
      accepted: ["to@example.com"],
      rejected: [],
    });

    const { BusinessEmailMessage } = await import("./email-core");
    const message = new BusinessEmailMessage(
      "campaign_1",
      {
        templateName: "template_1",
        render: (context: { name: string; home_url: string }) => ({
          subject: "Hello",
          html: `<p>${context.name}</p><a href="${context.home_url}">Home</a>`,
        }),
      },
      {
        name: "<script>alert(1)</script>",
        home_url: "http://localhost:3000/home?x=1&y=2",
      },
    );
    message.addRecipient("to@example.com", "Receiver");

    await message.send({
      SMTP_SERVICE: "QQ",
      SMTP_USER: "mailer@qq.com",
      SMTP_PASSWORD: "secret",
      SMTP_FROM_EMAIL: "mailer@qq.com",
    });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining("&lt;script&gt;alert(1)&lt;/script&gt;"),
      }),
    );
  });

  it("deduplicates sends when the same campaign key already exists", async () => {
    createDocument.mockRejectedValueOnce({ code: 409 });
    getDocument.mockResolvedValueOnce({
      campaignKey: "welcome_1",
      templateName: "researcher_welcome",
      status: "sent",
      recipientEmail: "to@example.com",
      messageId: "mid_existing",
      createdAt: "2026-07-06T00:00:00.000Z",
      updatedAt: "2026-07-06T00:00:00.000Z",
      sentAt: "2026-07-06T00:00:00.000Z",
    });

    const { sendEmail } = await import("./email-core");
    const result = await sendEmail(
      {
        to: [{ email: "to@example.com" }],
        subject: "Hello",
        text: "World",
        campaignKey: "welcome_1",
        templateName: "researcher_welcome",
      },
      {
        SMTP_SERVICE: "QQ",
        SMTP_USER: "mailer@qq.com",
        SMTP_PASSWORD: "secret",
        SMTP_FROM_EMAIL: "mailer@qq.com",
      },
    );

    expect(sendMail).not.toHaveBeenCalled();
    expect(updateDocument).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "duplicate",
      reason: "sent",
      messageId: "mid_existing",
    });
  });
});
