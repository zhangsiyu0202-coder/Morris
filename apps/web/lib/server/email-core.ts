import { createHash } from "node:crypto";
import { Resend, type CreateEmailOptions } from "resend";
import { createLogger } from "@merism/observability";
import { DATABASE_ID, getServerClient } from "@/lib/queries/client";

const DEFAULT_FROM_NAME = "Merism";
const URL_KEY_SUFFIXES = ["_url", "_link", "_href"] as const;
const TRUSTED_URL_KEYS = new Set(["url", "href", "link", "site_url"]);
const PASSTHROUGH_TEMPLATE_KEYS = new Set(["utm_tags"]);
const EMAIL_DELIVERIES_COLLECTION = "email_deliveries";

type EnvMap = Readonly<Record<string, string | undefined>>;

export interface EmailRecipient {
  email: string;
  name?: string;
}

/** Resend supports content buffers/strings or a hosted path for attachments. */
export interface EmailAttachment {
  filename?: string | false;
  content?: string | Buffer;
  path?: string;
}

export interface ResendConfig {
  apiKey: string;
  fromEmail: string;
  fromName: string;
  replyTo?: string;
}

export interface SendEmailInput {
  to: EmailRecipient[];
  cc?: EmailRecipient[];
  bcc?: EmailRecipient[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: EmailRecipient;
  headers?: Record<string, string>;
  attachments?: EmailAttachment[];
  campaignKey?: string;
  templateName?: string;
  requireAbsoluteUrls?: boolean;
}

export type SendEmailResult =
  | { status: "unavailable"; reason: EmailAvailability["reason"] }
  | { status: "duplicate"; reason: "pending" | "sent" | "failed"; messageId?: string }
  | { status: "sent"; messageId: string; accepted: string[]; rejected: string[] };

export interface EmailAvailability {
  enabled: boolean;
  resendConfigured: boolean;
  appUrlConfigured: boolean;
  requiresAbsoluteUrls: boolean;
  reason: "ready" | "resend_not_configured" | "app_url_not_configured";
}

export interface BusinessEmailTemplate<
  TContext extends Record<string, unknown> = Record<string, unknown>,
> {
  templateName: string;
  requiresAbsoluteUrls?: boolean;
  render: (
    context: SanitizedTemplateContext<TContext>,
  ) => Omit<SendEmailInput, "to" | "cc" | "bcc" | "replyTo" | "campaignKey" | "templateName">;
}

export type TemplatePrimitive = string | number | boolean | null;
export type TemplateValue =
  | TemplatePrimitive
  | Date
  | readonly TemplateValue[]
  | { readonly [key: string]: TemplateValue };
export type SanitizedTemplateContext<TContext extends Record<string, unknown>> = {
  readonly [K in keyof TContext]: TContext[K];
};

export class EmailTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailTransportError";
  }
}

interface EmailDeliveryRecord {
  campaignKey: string;
  templateName: string;
  status: "pending" | "sent" | "failed";
  recipientEmail: string;
  messageId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
}

function trimEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function sanitizeHeaderValue(value: string | undefined): string | undefined {
  const trimmed = trimEnv(value);
  if (!trimmed) return undefined;
  return trimmed.replaceAll(/\r?\n/g, " ").trim();
}

function sanitizeHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) return undefined;
  const sanitized = Object.entries(headers).flatMap(([key, value]) => {
    const cleanKey = sanitizeHeaderValue(key);
    const cleanValue = sanitizeHeaderValue(value);
    return cleanKey && cleanValue ? [[cleanKey, cleanValue] as const] : [];
  });
  return sanitized.length ? Object.fromEntries(sanitized) : undefined;
}

function isTrustedUrlKey(key: string): boolean {
  const lower = key.toLowerCase();
  return TRUSTED_URL_KEYS.has(lower) || URL_KEY_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

function sanitizeTemplateValue(value: unknown, key?: string): unknown {
  if (key && PASSTHROUGH_TEMPLATE_KEYS.has(key.toLowerCase())) return value;
  if (typeof value === "string") return escapeHtml(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (value instanceof Date) return escapeHtml(value.toISOString());
  if (Array.isArray(value)) return value.map((item) => sanitizeTemplateValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
        childKey,
        isTrustedUrlKey(childKey) && typeof childValue === "string"
          ? escapeHtml(childValue)
          : sanitizeTemplateValue(childValue, childKey),
      ]),
    );
  }
  throw new TypeError(`Unsupported template context type: ${typeof value}`);
}

export function sanitizeEmailTemplateContext<TContext extends Record<string, unknown>>(
  context: TContext,
): SanitizedTemplateContext<TContext> {
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => [
      key,
      isTrustedUrlKey(key) && typeof value === "string"
        ? escapeHtml(value)
        : sanitizeTemplateValue(value, key),
    ]),
  ) as SanitizedTemplateContext<TContext>;
}

function formatRecipient(recipient: EmailRecipient): string {
  const email = sanitizeHeaderValue(recipient.email);
  if (!email) throw new EmailTransportError("recipient email is required");
  const name = sanitizeHeaderValue(recipient.name);
  return name ? `${name} <${email}>` : email;
}

function formatRecipients(recipients: EmailRecipient[] | undefined): string[] | undefined {
  return recipients?.length ? recipients.map(formatRecipient) : undefined;
}

function formatSender(config: ResendConfig): string {
  const email = sanitizeHeaderValue(config.fromEmail);
  if (!email) throw new EmailTransportError("sender email is required");
  const name = sanitizeHeaderValue(config.fromName);
  return name ? `${name} <${email}>` : email;
}

function resolveAppUrlBase(env: EnvMap = process.env): string | null {
  const base = trimEnv(env.APP_URL) ?? trimEnv(env.NEXT_PUBLIC_APP_URL);
  return base ? base.replace(/\/$/, "") : null;
}

export function resolveResendConfig(env: EnvMap = process.env): ResendConfig | null {
  const apiKey = trimEnv(env.RESEND_API_KEY);
  const fromEmail = sanitizeHeaderValue(env.RESEND_FROM_EMAIL);
  if (!apiKey || !fromEmail) return null;
  return {
    apiKey,
    fromEmail,
    fromName: sanitizeHeaderValue(env.RESEND_FROM_NAME) ?? DEFAULT_FROM_NAME,
    replyTo: sanitizeHeaderValue(env.RESEND_REPLY_TO),
  };
}

export function getBusinessEmailAvailability(
  options: { requireAbsoluteUrls?: boolean } = {},
  env: EnvMap = process.env,
): EmailAvailability {
  const resendConfigured = resolveResendConfig(env) !== null;
  const appUrlConfigured = resolveAppUrlBase(env) !== null;
  const requiresAbsoluteUrls = options.requireAbsoluteUrls === true;
  if (!resendConfigured) {
    return { enabled: false, resendConfigured, appUrlConfigured, requiresAbsoluteUrls, reason: "resend_not_configured" };
  }
  if (requiresAbsoluteUrls && !appUrlConfigured) {
    return { enabled: false, resendConfigured, appUrlConfigured, requiresAbsoluteUrls, reason: "app_url_not_configured" };
  }
  return { enabled: true, resendConfigured, appUrlConfigured, requiresAbsoluteUrls, reason: "ready" };
}

export function isResendEmailServiceAvailable(env: EnvMap = process.env): boolean {
  return resolveResendConfig(env) !== null;
}

export function isBusinessEmailAvailable(
  options: { requireAbsoluteUrls?: boolean } = {},
  env: EnvMap = process.env,
): boolean {
  return getBusinessEmailAvailability(options, env).enabled;
}

function nowIso(): string {
  return new Date().toISOString();
}

// Appwrite custom document IDs are capped at 36 chars and allow a-z/A-Z/0-9/._-.
function emailDeliveryDocumentId(campaignKey: string): string {
  return `mail_${createHash("sha256").update(campaignKey).digest("hex").slice(0, 31)}`;
}

function primaryRecipientEmail(input: SendEmailInput): string {
  return input.to[0]?.email ?? "";
}

function deliveryRecordFromDocument(document: Record<string, unknown>): EmailDeliveryRecord {
  return {
    campaignKey: String(document.campaignKey ?? ""),
    templateName: String(document.templateName ?? ""),
    status: (document.status as EmailDeliveryRecord["status"]) ?? "pending",
    recipientEmail: String(document.recipientEmail ?? ""),
    messageId: typeof document.messageId === "string" ? document.messageId : undefined,
    error: typeof document.error === "string" ? document.error : undefined,
    createdAt: String(document.createdAt ?? ""),
    updatedAt: String(document.updatedAt ?? ""),
    sentAt: typeof document.sentAt === "string" ? document.sentAt : undefined,
  };
}

async function claimEmailDelivery(input: SendEmailInput): Promise<
  | { kind: "not_applicable" }
  | { kind: "claimed"; documentId: string }
  | { kind: "duplicate"; record: EmailDeliveryRecord }
> {
  if (!input.campaignKey) return { kind: "not_applicable" };
  const documentId = emailDeliveryDocumentId(input.campaignKey);
  const timestamp = nowIso();
  try {
    await getServerClient().databases.createDocument(
      DATABASE_ID,
      EMAIL_DELIVERIES_COLLECTION,
      documentId,
      {
        campaignKey: input.campaignKey,
        templateName: input.templateName ?? "",
        status: "pending",
        recipientEmail: primaryRecipientEmail(input),
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      [],
    );
    return { kind: "claimed", documentId };
  } catch (error) {
    if ((error as { code?: number } | null)?.code !== 409) throw error;
    const existing = await getServerClient().databases.getDocument(
      DATABASE_ID,
      EMAIL_DELIVERIES_COLLECTION,
      documentId,
    );
    return { kind: "duplicate", record: deliveryRecordFromDocument(existing as Record<string, unknown>) };
  }
}

async function markEmailDeliverySent(
  documentId: string,
  input: SendEmailInput,
  messageId: string,
): Promise<void> {
  await getServerClient().databases.updateDocument(DATABASE_ID, EMAIL_DELIVERIES_COLLECTION, documentId, {
    campaignKey: input.campaignKey ?? "",
    templateName: input.templateName ?? "",
    status: "sent",
    recipientEmail: primaryRecipientEmail(input),
    messageId,
    error: "",
    sentAt: nowIso(),
    updatedAt: nowIso(),
  });
}

async function markEmailDeliveryFailed(documentId: string, input: SendEmailInput): Promise<void> {
  await getServerClient().databases.updateDocument(DATABASE_ID, EMAIL_DELIVERIES_COLLECTION, documentId, {
    campaignKey: input.campaignKey ?? "",
    templateName: input.templateName ?? "",
    status: "failed",
    recipientEmail: primaryRecipientEmail(input),
    error: "provider_rejected",
    updatedAt: nowIso(),
  });
}

function campaignHeaders(input: SendEmailInput): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  if (input.campaignKey) headers["X-Merism-Campaign-Key"] = sanitizeHeaderValue(input.campaignKey) ?? "";
  if (input.templateName) headers["X-Merism-Template-Name"] = sanitizeHeaderValue(input.templateName) ?? "";
  return Object.keys(headers).length ? headers : undefined;
}

export async function sendEmail(
  input: SendEmailInput,
  env: EnvMap = process.env,
): Promise<SendEmailResult> {
  const availability = getBusinessEmailAvailability({ requireAbsoluteUrls: input.requireAbsoluteUrls }, env);
  if (!availability.enabled) return { status: "unavailable", reason: availability.reason };
  const config = resolveResendConfig(env);
  if (!config) return { status: "unavailable", reason: "resend_not_configured" };
  if (!input.to.length) throw new EmailTransportError("at least one recipient is required");
  if (input.text === undefined && input.html === undefined) {
    throw new EmailTransportError("email text or html is required");
  }

  const logger = createLogger("server.email");
  const deliveryClaim = await claimEmailDelivery(input);
  if (deliveryClaim.kind === "duplicate") {
    logger.info("email deduplicated by campaign key", {
      campaignKey: input.campaignKey,
      templateName: input.templateName,
      existingStatus: deliveryClaim.record.status,
      existingMessageId: deliveryClaim.record.messageId,
    });
    return { status: "duplicate", reason: deliveryClaim.record.status, messageId: deliveryClaim.record.messageId };
  }

  try {
    const resend = new Resend(config.apiKey);
    const basePayload = {
      from: formatSender(config),
      to: formatRecipients(input.to) ?? [],
      cc: formatRecipients(input.cc),
      bcc: formatRecipients(input.bcc),
      replyTo: input.replyTo ? formatRecipient(input.replyTo) : config.replyTo,
      subject: sanitizeHeaderValue(input.subject) ?? "",
      headers: sanitizeHeaders({ ...campaignHeaders(input), ...input.headers }),
      attachments: input.attachments?.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content,
        path: attachment.path,
      })),
    };
    const payload: CreateEmailOptions =
      input.html !== undefined
        ? { ...basePayload, html: input.html, ...(input.text !== undefined ? { text: input.text } : {}) }
        : { ...basePayload, text: input.text ?? "" };
    const response = await resend.emails.send(
      payload,
      input.campaignKey ? { idempotencyKey: emailDeliveryDocumentId(input.campaignKey) } : undefined,
    );
    if (response.error || !response.data?.id) {
      throw new EmailTransportError(response.error?.message ?? "Resend rejected the email request");
    }

    const messageId = response.data.id;
    logger.info("resend email accepted", {
      messageId,
      recipientCount: input.to.length,
      campaignKey: input.campaignKey,
      templateName: input.templateName,
    });
    if (deliveryClaim.kind === "claimed") {
      await markEmailDeliverySent(deliveryClaim.documentId, input, messageId).catch(() => {
        // The provider has accepted the message; persisting this status is best-effort only.
        logger.error("resend email sent status writeback failed", {
          messageId,
          campaignKey: input.campaignKey,
          templateName: input.templateName,
        });
      });
    }
    return {
      status: "sent",
      messageId,
      accepted: input.to.map((recipient) => recipient.email),
      rejected: [],
    };
  } catch (error) {
    if (deliveryClaim.kind === "claimed") {
      await markEmailDeliveryFailed(deliveryClaim.documentId, input).catch(() => {
        // The original provider failure is more useful than a best-effort status writeback failure.
        logger.error("resend email failed status writeback failed", {
          campaignKey: input.campaignKey,
          templateName: input.templateName,
        });
      });
    }
    logger.error("resend email send failed", {
      campaignKey: input.campaignKey,
      templateName: input.templateName,
    });
    if (error instanceof EmailTransportError) throw error;
    throw new EmailTransportError("Resend email request failed");
  }
}

export class BusinessEmailMessage<
  TContext extends Record<string, unknown> = Record<string, unknown>,
> {
  private readonly to: EmailRecipient[] = [];
  private readonly cc: EmailRecipient[] = [];
  private readonly bcc: EmailRecipient[] = [];
  readonly templateContext: SanitizedTemplateContext<TContext>;

  constructor(
    readonly campaignKey: string | undefined,
    readonly template: BusinessEmailTemplate<TContext>,
    templateContext: TContext,
    readonly options: { headers?: Record<string, string>; replyTo?: EmailRecipient; attachments?: EmailAttachment[] } = {},
  ) {
    this.templateContext = sanitizeEmailTemplateContext(templateContext);
  }

  addRecipient(email: string, name?: string): void { this.to.push({ email, name }); }
  addCc(email: string, name?: string): void { this.cc.push({ email, name }); }
  addBcc(email: string, name?: string): void { this.bcc.push({ email, name }); }

  async send(env: EnvMap = process.env): Promise<SendEmailResult> {
    if (!this.to.length) throw new EmailTransportError("no recipients provided");
    const rendered = this.template.render(this.templateContext);
    return sendEmail({
      ...rendered,
      to: this.to,
      cc: this.cc.length ? this.cc : undefined,
      bcc: this.bcc.length ? this.bcc : undefined,
      headers: { ...this.options.headers, ...rendered.headers },
      attachments: [...(this.options.attachments ?? []), ...(rendered.attachments ?? [])],
      replyTo: this.options.replyTo,
      campaignKey: this.campaignKey,
      templateName: this.template.templateName,
      requireAbsoluteUrls: this.template.requiresAbsoluteUrls,
    }, env);
  }
}

export class EmailMessage {
  private readonly message: BusinessEmailMessage<Record<string, never>>;

  constructor(
    readonly subject: string,
    readonly text: string,
    readonly html?: string,
    readonly headers?: Record<string, string>,
    readonly replyTo?: EmailRecipient,
  ) {
    this.message = new BusinessEmailMessage(
      undefined,
      { templateName: "ad_hoc", render: () => ({ subject, text, html, headers }) },
      {},
      { replyTo },
    );
  }

  addRecipient(email: string, name?: string): void { this.message.addRecipient(email, name); }
  async send(env: EnvMap = process.env): Promise<SendEmailResult> { return this.message.send(env); }
}

function resolveAppUrl(path: string, env: EnvMap = process.env): string {
  return `${resolveAppUrlBase(env) ?? "http://localhost:3000"}${path}`;
}

const researcherWelcomeTemplate: BusinessEmailTemplate<{ name: string; homeUrl: string; loginUrl: string }> = {
  templateName: "researcher_welcome",
  requiresAbsoluteUrls: true,
  render: ({ name, homeUrl, loginUrl }) => ({
    subject: "欢迎来到 Merism",
    text: [`你好，${name}：`, "", "欢迎使用 Merism。", `进入工作区：${homeUrl}`, `登录入口：${loginUrl}`].join("\n"),
    html: [
      "<!DOCTYPE html>",
      "<html><body style=\"font-family: Arial, sans-serif; color: #241e2a;\">",
      `<p>你好，${name}：</p>`,
      "<p>欢迎使用 Merism。</p>",
      `<p><a href=\"${homeUrl}\">进入工作区</a></p>`,
      `<p>如果上面的按钮不可用，也可以复制这个地址：${homeUrl}</p>`,
      `<p>登录入口：<a href=\"${loginUrl}\">${loginUrl}</a></p>`,
      "</body></html>",
    ].join(""),
  }),
};

export async function sendResearcherWelcomeEmail(args: { email: string; name: string }): Promise<SendEmailResult> {
  const plainName = args.name.trim() || "研究员";
  const message = new BusinessEmailMessage(
    `researcher_welcome:${args.email.toLowerCase()}`,
    researcherWelcomeTemplate,
    { name: plainName, homeUrl: resolveAppUrl("/home"), loginUrl: resolveAppUrl("/login") },
  );
  message.addRecipient(args.email, plainName);
  return message.send();
}
