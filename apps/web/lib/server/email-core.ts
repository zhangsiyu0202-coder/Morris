import { createHash } from "node:crypto";
import nodemailer from "nodemailer";
import { createLogger } from "@merism/observability";
import { DATABASE_ID, getServerClient } from "@/lib/queries/client";

const DEFAULT_FROM_NAME = "Merism";
const DEFAULT_QQ_SMTP_PORT = 465;
const DEFAULT_SUBMISSION_PORT = 587;
const DEFAULT_POOL_MAX_CONNECTIONS = 5;
const DEFAULT_POOL_MAX_MESSAGES = 100;
const SMTP_VERIFY_TIMEOUT_MS = 10_000;
const SMTP_SOCKET_TIMEOUT_MS = 20_000;
const URL_KEY_SUFFIXES = ["_url", "_link", "_href"] as const;
const TRUSTED_URL_KEYS = new Set(["url", "href", "link", "site_url"]);
const PASSTHROUGH_TEMPLATE_KEYS = new Set(["utm_tags"]);
const EMAIL_DELIVERIES_COLLECTION = "email_deliveries";

type EnvMap = Readonly<Record<string, string | undefined>>;
type Transporter = ReturnType<typeof nodemailer.createTransport>;

export interface EmailRecipient {
  email: string;
  name?: string;
}

export interface EmailAttachment {
  filename?: string | false;
  content?: string | Buffer | NodeJS.ReadableStream;
  path?: string;
  href?: string;
  httpHeaders?: Record<string, string>;
  contentType?: string;
  contentDisposition?: string;
  cid?: string;
  encoding?: string;
  contentTransferEncoding?: "base64" | "quoted-printable" | "7bit" | false;
  headers?: Record<string, string>;
  raw?: string;
}

export interface SmtpConfig {
  service?: string;
  host?: string;
  port: number;
  secure: boolean;
  requireTls: boolean;
  user: string;
  password: string;
  fromEmail: string;
  fromName: string;
  replyTo?: string;
  proxy?: string;
  pool: boolean;
  maxConnections?: number;
  maxMessages?: number;
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
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  campaignKey?: string;
  templateName?: string;
  requireAbsoluteUrls?: boolean;
}

export type SendEmailResult =
  | { status: "unavailable"; reason: EmailAvailability["reason"] }
  | { status: "duplicate"; reason: "pending" | "sent" | "failed"; messageId?: string }
  | {
      status: "sent";
      messageId: string;
      accepted: string[];
      rejected: string[];
    };

export interface EmailAvailability {
  enabled: boolean;
  smtpConfigured: boolean;
  appUrlConfigured: boolean;
  requiresAbsoluteUrls: boolean;
  reason: "ready" | "smtp_not_configured" | "app_url_not_configured";
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

let cachedTransport: Transporter | null = null;
let cachedTransportKey: string | null = null;

function trimEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function readBoolEnv(value: string | undefined, fallback = false): boolean {
  const normalized = trimEnv(value)?.toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(normalized);
}

function readNumberEnv(value: string | undefined): number | undefined {
  const trimmed = trimEnv(value);
  if (!trimmed) {
    return undefined;
  }
  const number = Number(trimmed);
  if (!Number.isInteger(number) || number <= 0) {
    throw new EmailTransportError(`invalid numeric env value: ${trimmed}`);
  }
  return number;
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
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replaceAll(/\r?\n/g, " ").trim();
}

function sanitizeHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      sanitizeHeaderValue(key) ?? "",
      sanitizeHeaderValue(value) ?? "",
    ]),
  );
}

function sanitizeAttachmentHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  return sanitizeHeaders(headers);
}

function sanitizeHttpHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  return sanitizeHeaders(headers);
}

function isTrustedUrlKey(key: string): boolean {
  const lower = key.toLowerCase();
  return TRUSTED_URL_KEYS.has(lower) || URL_KEY_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

function sanitizeTemplateValue(value: unknown, key?: string): unknown {
  if (key && PASSTHROUGH_TEMPLATE_KEYS.has(key.toLowerCase())) {
    return value;
  }
  if (typeof value === "string") {
    return escapeHtml(value);
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }
  if (value instanceof Date) {
    return escapeHtml(value.toISOString());
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeTemplateValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
        childKey,
        isTrustedUrlKey(childKey)
          ? typeof childValue === "string"
            ? escapeHtml(childValue)
            : sanitizeTemplateValue(childValue, childKey)
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
      isTrustedUrlKey(key)
        ? typeof value === "string"
          ? escapeHtml(value)
          : sanitizeTemplateValue(value, key)
        : sanitizeTemplateValue(value, key),
    ]),
  ) as SanitizedTemplateContext<TContext>;
}

function defaultPort(service: string | undefined, host: string | undefined): number {
  if (service?.toLowerCase() === "qq" || host?.toLowerCase() === "smtp.qq.com") {
    return DEFAULT_QQ_SMTP_PORT;
  }
  return DEFAULT_SUBMISSION_PORT;
}

function parsePort(
  raw: string | undefined,
  service: string | undefined,
  host: string | undefined,
): number {
  if (!raw) {
    return defaultPort(service, host);
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0) {
    throw new EmailTransportError("invalid SMTP_PORT");
  }
  return port;
}

function resolveProxy(env: EnvMap): string | undefined {
  return (
    trimEnv(env.SMTP_PROXY) ??
    trimEnv(env.HTTPS_PROXY) ??
    trimEnv(env.HTTP_PROXY) ??
    trimEnv(env.https_proxy) ??
    trimEnv(env.http_proxy)
  );
}

function recipientAddress(recipient: EmailRecipient) {
  return {
    address: sanitizeHeaderValue(recipient.email) ?? "",
    name: sanitizeHeaderValue(recipient.name),
  };
}

function recipientList(recipients: EmailRecipient[] | undefined) {
  return recipients?.length ? recipients.map(recipientAddress) : undefined;
}

function senderAddress(config: SmtpConfig) {
  return {
    address: sanitizeHeaderValue(config.fromEmail) ?? "",
    name: sanitizeHeaderValue(config.fromName),
  };
}

function replyToAddress(recipient: EmailRecipient | undefined, fallback: string | undefined) {
  if (recipient) {
    return recipientAddress(recipient);
  }
  const fallbackAddress = sanitizeHeaderValue(fallback);
  return fallbackAddress ? { address: fallbackAddress } : undefined;
}

function attachmentList(attachments: EmailAttachment[] | undefined) {
  return attachments?.map((attachment) => ({
    ...attachment,
    filename: attachment.filename,
    path: attachment.path,
    href: attachment.href,
    cid: sanitizeHeaderValue(attachment.cid),
    contentType: sanitizeHeaderValue(attachment.contentType),
    contentDisposition: sanitizeHeaderValue(attachment.contentDisposition),
    headers: sanitizeAttachmentHeaders(attachment.headers),
    httpHeaders: sanitizeHttpHeaders(attachment.httpHeaders),
  }));
}

function resolveAppUrlBase(env: EnvMap = process.env): string | null {
  const base = trimEnv(env.APP_URL) ?? trimEnv(env.NEXT_PUBLIC_APP_URL);
  return base ? base.replace(/\/$/, "") : null;
}

export function getBusinessEmailAvailability(
  options: { requireAbsoluteUrls?: boolean } = {},
  env: EnvMap = process.env,
): EmailAvailability {
  const smtpConfigured = resolveSmtpConfig(env) !== null;
  const appUrlConfigured = resolveAppUrlBase(env) !== null;
  const requiresAbsoluteUrls = options.requireAbsoluteUrls === true;

  if (!smtpConfigured) {
    return {
      enabled: false,
      smtpConfigured,
      appUrlConfigured,
      requiresAbsoluteUrls,
      reason: "smtp_not_configured",
    };
  }

  if (requiresAbsoluteUrls && !appUrlConfigured) {
    return {
      enabled: false,
      smtpConfigured,
      appUrlConfigured,
      requiresAbsoluteUrls,
      reason: "app_url_not_configured",
    };
  }

  return {
    enabled: true,
    smtpConfigured,
    appUrlConfigured,
    requiresAbsoluteUrls,
    reason: "ready",
  };
}

export function isSmtpEmailServiceAvailable(env: EnvMap = process.env): boolean {
  return resolveSmtpConfig(env) !== null;
}

export function isBusinessEmailAvailable(
  options: { requireAbsoluteUrls?: boolean } = {},
  env: EnvMap = process.env,
): boolean {
  return getBusinessEmailAvailability(options, env).enabled;
}

export function resolveSmtpConfig(env: EnvMap = process.env): SmtpConfig | null {
  const user = trimEnv(env.SMTP_USER);
  const password = trimEnv(env.SMTP_PASSWORD);
  const fromEmail = trimEnv(env.SMTP_FROM_EMAIL);
  const service = trimEnv(env.SMTP_SERVICE);
  const host = trimEnv(env.SMTP_HOST);

  if (!user || !password || !fromEmail) {
    return null;
  }
  if (!service && !host) {
    return null;
  }

  const port = parsePort(trimEnv(env.SMTP_PORT), service, host);
  const secure = trimEnv(env.SMTP_SECURE)
    ? readBoolEnv(env.SMTP_SECURE)
    : port === DEFAULT_QQ_SMTP_PORT;
  const pool = readBoolEnv(env.SMTP_POOL);

  return {
    service,
    host,
    port,
    secure,
    requireTls: readBoolEnv(env.SMTP_REQUIRE_TLS),
    user,
    password,
    fromEmail,
    fromName: sanitizeHeaderValue(env.SMTP_FROM_NAME) ?? DEFAULT_FROM_NAME,
    replyTo: sanitizeHeaderValue(env.SMTP_REPLY_TO),
    proxy: resolveProxy(env),
    pool,
    maxConnections: pool ? readNumberEnv(env.SMTP_MAX_CONNECTIONS) ?? DEFAULT_POOL_MAX_CONNECTIONS : undefined,
    maxMessages: pool ? readNumberEnv(env.SMTP_MAX_MESSAGES) ?? DEFAULT_POOL_MAX_MESSAGES : undefined,
  };
}

function transportCacheKey(config: SmtpConfig): string {
  return JSON.stringify(config);
}

function nowIso(): string {
  return new Date().toISOString();
}

// Appwrite custom document IDs are capped at 36 chars and allow a-z/A-Z/0-9/._-.
// Source: https://appwrite.io/docs/references/cloud/server-nodejs/databases#create-document
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
  if (!input.campaignKey) {
    return { kind: "not_applicable" };
  }

  const documentId = emailDeliveryDocumentId(input.campaignKey);
  const db = getServerClient().databases;
  const timestamp = nowIso();
  try {
    await db.createDocument(
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
    if ((error as { code?: number } | null)?.code !== 409) {
      throw error;
    }
    const existing = await db.getDocument(
      DATABASE_ID,
      EMAIL_DELIVERIES_COLLECTION,
      documentId,
    );
    return {
      kind: "duplicate",
      record: deliveryRecordFromDocument(existing as Record<string, unknown>),
    };
  }
}

async function markEmailDeliverySent(
  documentId: string,
  input: SendEmailInput,
  info: { messageId: string },
): Promise<void> {
  await getServerClient().databases.updateDocument(
    DATABASE_ID,
    EMAIL_DELIVERIES_COLLECTION,
    documentId,
    {
      campaignKey: input.campaignKey ?? "",
      templateName: input.templateName ?? "",
      status: "sent",
      recipientEmail: primaryRecipientEmail(input),
      messageId: info.messageId,
      error: "",
      sentAt: nowIso(),
      updatedAt: nowIso(),
    },
  );
}

async function markEmailDeliveryFailed(
  documentId: string,
  input: SendEmailInput,
  detail: string,
): Promise<void> {
  await getServerClient().databases.updateDocument(
    DATABASE_ID,
    EMAIL_DELIVERIES_COLLECTION,
    documentId,
    {
      campaignKey: input.campaignKey ?? "",
      templateName: input.templateName ?? "",
      status: "failed",
      recipientEmail: primaryRecipientEmail(input),
      error: detail,
      updatedAt: nowIso(),
    },
  );
}

function buildTransportOptions(config: SmtpConfig) {
  return {
    service: config.service,
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.requireTls,
    proxy: config.proxy,
    pool: config.pool,
    maxConnections: config.maxConnections,
    maxMessages: config.maxMessages,
    auth: {
      user: config.user,
      pass: config.password,
    },
    connectionTimeout: SMTP_VERIFY_TIMEOUT_MS,
    greetingTimeout: SMTP_VERIFY_TIMEOUT_MS,
    socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

function buildTransportDefaults(config: SmtpConfig) {
  return {
    from: senderAddress(config),
    replyTo: replyToAddress(undefined, config.replyTo),
  };
}

function createTransport(config: SmtpConfig): Transporter {
  return nodemailer.createTransport(buildTransportOptions(config), buildTransportDefaults(config));
}

function getCachedTransport(config: SmtpConfig): Transporter {
  const nextKey = transportCacheKey(config);
  if (!cachedTransport || cachedTransportKey !== nextKey) {
    cachedTransport?.close();
    cachedTransport = createTransport(config);
    cachedTransportKey = nextKey;
  }
  return cachedTransport;
}

export function closeCachedSmtpTransport(): void {
  cachedTransport?.close();
  cachedTransport = null;
  cachedTransportKey = null;
}

function campaignHeaders(input: SendEmailInput): Record<string, string> | undefined {
  const pairs: Array<readonly [string, string]> = [];
  if (input.campaignKey) {
    pairs.push(["X-Merism-Campaign-Key", sanitizeHeaderValue(input.campaignKey) ?? ""]);
  }
  if (input.templateName) {
    pairs.push(["X-Merism-Template-Name", sanitizeHeaderValue(input.templateName) ?? ""]);
  }

  return pairs.length ? Object.fromEntries(pairs) : undefined;
}

export async function verifySmtpConnection(
  env: EnvMap = process.env,
): Promise<"unavailable" | "verified"> {
  const config = resolveSmtpConfig(env);
  if (!config) {
    return "unavailable";
  }

  const transport = createTransport(config);
  try {
    await transport.verify();
    createLogger("server.email").info("smtp connection verified", {
      service: config.service ?? config.host,
      port: config.port,
      secure: config.secure,
      proxyConfigured: Boolean(config.proxy),
      pooled: config.pool,
    });
    return "verified";
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    createLogger("server.email").error("smtp verify failed", {
      service: config.service ?? config.host,
      port: config.port,
      error: detail,
      proxyConfigured: Boolean(config.proxy),
      pooled: config.pool,
    });
    throw new EmailTransportError(detail);
  } finally {
    transport.close();
  }
}

export async function sendEmail(
  input: SendEmailInput,
  env: EnvMap = process.env,
): Promise<SendEmailResult> {
  const availability = getBusinessEmailAvailability(
    { requireAbsoluteUrls: input.requireAbsoluteUrls },
    env,
  );
  if (!availability.enabled) {
    return { status: "unavailable", reason: availability.reason };
  }
  const config = resolveSmtpConfig(env);
  if (!config) {
    return { status: "unavailable", reason: "smtp_not_configured" };
  }
  if (input.to.length === 0) {
    throw new EmailTransportError("at least one recipient is required");
  }

  const logger = createLogger("server.email");
  const deliveryClaim = await claimEmailDelivery(input);
  if (deliveryClaim.kind === "duplicate") {
    logger.info("smtp email deduplicated by campaign key", {
      campaignKey: input.campaignKey,
      templateName: input.templateName,
      existingStatus: deliveryClaim.record.status,
      existingMessageId: deliveryClaim.record.messageId,
    });
    return {
      status: "duplicate",
      reason: deliveryClaim.record.status,
      messageId: deliveryClaim.record.messageId,
    };
  }

  const transport = env === process.env ? getCachedTransport(config) : createTransport(config);
  try {
    const info = (await transport.sendMail({
      to: recipientList(input.to),
      cc: recipientList(input.cc),
      bcc: recipientList(input.bcc),
      replyTo: replyToAddress(input.replyTo, config.replyTo),
      subject: sanitizeHeaderValue(input.subject) ?? "",
      text: input.text,
      html: input.html,
      headers: sanitizeHeaders({
        ...campaignHeaders(input),
        ...input.headers,
      }),
      attachments: attachmentList(input.attachments),
      messageId: sanitizeHeaderValue(input.messageId),
      inReplyTo: sanitizeHeaderValue(input.inReplyTo),
      references: input.references?.map((value) => sanitizeHeaderValue(value) ?? "").filter(Boolean),
    } as never)) as {
      messageId: string;
      accepted: Array<string | { address: string }>;
      rejected: Array<string | { address: string }>;
    };

    const accepted = info.accepted.map((value: string | { address: string }) => String(value));
    const rejected = info.rejected.map((value: string | { address: string }) => String(value));

    logger.info("smtp email sent", {
      messageId: info.messageId,
      acceptedCount: accepted.length,
      rejectedCount: rejected.length,
      service: config.service ?? config.host,
      proxyConfigured: Boolean(config.proxy),
      pooled: config.pool,
      campaignKey: input.campaignKey,
      templateName: input.templateName,
    });
    if (deliveryClaim.kind === "claimed") {
      await markEmailDeliverySent(deliveryClaim.documentId, input, { messageId: info.messageId }).catch(
        (markError) => {
          logger.error("smtp email failed to persist sent status", {
            campaignKey: input.campaignKey,
            templateName: input.templateName,
            messageId: info.messageId,
            error: markError instanceof Error ? markError.message : String(markError),
          });
        },
      );
    }

    return {
      status: "sent",
      messageId: info.messageId,
      accepted,
      rejected,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (deliveryClaim.kind === "claimed") {
      await markEmailDeliveryFailed(deliveryClaim.documentId, input, detail).catch((markError) => {
        logger.error("smtp email failed to update delivery record", {
          campaignKey: input.campaignKey,
          templateName: input.templateName,
          error: markError instanceof Error ? markError.message : String(markError),
        });
      });
    }
    logger.error("smtp email send failed", {
      service: config.service ?? config.host,
      error: detail,
      proxyConfigured: Boolean(config.proxy),
      pooled: config.pool,
      campaignKey: input.campaignKey,
      templateName: input.templateName,
    });
    throw new EmailTransportError(detail);
  } finally {
    if (env !== process.env) {
      transport.close();
    }
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
    readonly options: {
      headers?: Record<string, string>;
      replyTo?: EmailRecipient;
      attachments?: EmailAttachment[];
      messageId?: string;
      inReplyTo?: string;
      references?: string[];
    } = {},
  ) {
    this.templateContext = sanitizeEmailTemplateContext(templateContext);
  }

  addRecipient(email: string, name?: string): void {
    this.to.push({ email, name });
  }

  addCc(email: string, name?: string): void {
    this.cc.push({ email, name });
  }

  addBcc(email: string, name?: string): void {
    this.bcc.push({ email, name });
  }

  async send(env: EnvMap = process.env): Promise<SendEmailResult> {
    if (this.to.length === 0) {
      throw new EmailTransportError("no recipients provided");
    }

    const rendered = this.template.render(this.templateContext);
    return sendEmail(
      {
        ...rendered,
        to: this.to,
        cc: this.cc.length ? this.cc : undefined,
        bcc: this.bcc.length ? this.bcc : undefined,
        headers: {
          ...this.options.headers,
          ...rendered.headers,
        },
        attachments: [
          ...(this.options.attachments ?? []),
          ...(rendered.attachments ?? []),
        ],
        replyTo: this.options.replyTo,
        messageId: this.options.messageId ?? rendered.messageId,
        inReplyTo: this.options.inReplyTo ?? rendered.inReplyTo,
        references: this.options.references ?? rendered.references,
        campaignKey: this.campaignKey,
        templateName: this.template.templateName,
        requireAbsoluteUrls: this.template.requiresAbsoluteUrls,
      },
      env,
    );
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
      {
        templateName: "ad_hoc",
        render: () => ({
          subject: this.subject,
          text: this.text,
          html: this.html,
          headers: this.headers,
        }),
      },
      {},
      { replyTo },
    );
  }

  addRecipient(email: string, name?: string): void {
    this.message.addRecipient(email, name);
  }

  async send(env: EnvMap = process.env): Promise<SendEmailResult> {
    return this.message.send(env);
  }
}

function resolveAppUrl(path: string, env: EnvMap = process.env): string {
  const base = resolveAppUrlBase(env) ?? "http://localhost:3000";
  return `${base}${path}`;
}

const researcherWelcomeTemplate: BusinessEmailTemplate<{
  name: string;
  homeUrl: string;
  loginUrl: string;
}> = {
  templateName: "researcher_welcome",
  requiresAbsoluteUrls: true,
  render: ({ name, homeUrl, loginUrl }) => ({
    subject: "欢迎来到 Merism",
    text: [`你好，${name}：`, "", "欢迎使用 Merism。", `进入工作区：${homeUrl}`, `登录入口：${loginUrl}`].join(
      "\n",
    ),
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

export async function sendResearcherWelcomeEmail(args: {
  email: string;
  name: string;
}): Promise<SendEmailResult> {
  const plainName = args.name.trim() || "研究员";
  const message = new BusinessEmailMessage(
    `researcher_welcome:${args.email.toLowerCase()}`,
    researcherWelcomeTemplate,
    {
      name: plainName,
      homeUrl: resolveAppUrl("/home"),
      loginUrl: resolveAppUrl("/login"),
    },
  );
  message.addRecipient(args.email, plainName);
  return message.send();
}
