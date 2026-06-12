import { z } from "zod";

// Workspaces & Billing domain (ADR 0006). The workspace is the tenant boundary
// (an Appwrite Team: $id === teamId). Pricing AMOUNTS are NOT defined here —
// they live in Stripe (referenced by Plan.priceRef); see ADR 0006 D4/D5 and
// products/workspaces-billing/spec/prd-pricing.md. This module carries the
// cross-module SHAPES plus the behavioral constants Functions enforce.

// --- Tenancy ---

export const WorkspaceRole = z.enum(["owner", "admin", "member"]);
export type WorkspaceRoleValue = z.infer<typeof WorkspaceRole>;

export const MembershipStatus = z.enum(["active", "invited"]);
export type MembershipStatusValue = z.infer<typeof MembershipStatus>;

export const PlanKey = z.enum(["plus", "pro"]);
export type PlanKeyValue = z.infer<typeof PlanKey>;

/** A workspace == an Appwrite Team (`$id === teamId`). */
export const WorkspaceSchema = z.object({
  $id: z.string(),
  name: z.string().min(1),
  /** The single owner / billing payer (an Appwrite Account `$id`). */
  ownerUserId: z.string(),
  planKey: PlanKey,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

/**
 * Denormalized read view of an Appwrite Team membership (the Team remains the
 * canonical source; this row exists for querying/testing). One row per user per
 * workspace.
 */
export const WorkspaceMembershipSchema = z.object({
  $id: z.string(),
  workspaceId: z.string(),
  userId: z.string(),
  role: WorkspaceRole,
  status: MembershipStatus.default("invited"),
  invitedBy: z.string().optional(),
  createdAt: z.string().datetime(),
});
export type WorkspaceMembership = z.infer<typeof WorkspaceMembershipSchema>;

// --- Plans & subscription ---

export const PlanFeature = z.enum(["core", "visual_analysis", "survey_rollup"]);
export type PlanFeatureValue = z.infer<typeof PlanFeature>;

/**
 * Entitlement bundle. Dollar amounts (seat price, overage unit price) live in
 * Stripe and are referenced by `priceRef`; only entitlements (included usage,
 * feature flags) live in the contract.
 */
export const PlanSchema = z.object({
  key: PlanKey,
  /** Pooled completed-interview allowance per billing period before overage. */
  includedInterviews: z.number().int().nonnegative(),
  features: z.array(PlanFeature).default([]),
  /** Opaque Stripe Price id reference; amounts resolve in Stripe, never here. */
  priceRef: z.string().optional(),
});
export type Plan = z.infer<typeof PlanSchema>;

export const SubscriptionStatus = z.enum(["trialing", "active", "past_due", "canceled"]);
export type SubscriptionStatusValue = z.infer<typeof SubscriptionStatus>;

export const SubscriptionSchema = z
  .object({
    $id: z.string(),
    workspaceId: z.string(),
    planKey: PlanKey,
    status: SubscriptionStatus,
    /** Purchased seat count (>= 1). Members are capped by this. */
    seats: z.number().int().positive(),
    stripeCustomerId: z.string().optional(),
    stripeSubscriptionId: z.string().optional(),
    currentPeriodStart: z.string().datetime(),
    currentPeriodEnd: z.string().datetime(),
  })
  .superRefine((s, ctx) => {
    if (new Date(s.currentPeriodEnd) <= new Date(s.currentPeriodStart)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["currentPeriodEnd"],
        message: "currentPeriodEnd must be after currentPeriodStart",
      });
    }
  });
export type Subscription = z.infer<typeof SubscriptionSchema>;

// --- Usage & quota ---

/** The only billable unit today: a completed interview session. */
export const BillableUnit = z.enum(["completed_interview"]);
export type BillableUnitValue = z.infer<typeof BillableUnit>;

/**
 * Append-only billable event, one per completed interview. Idempotent on
 * `sessionId` via the deterministic `$id` (see `usageEventId`) so retries /
 * concurrency bill a session at most once.
 */
export const UsageEventSchema = z.object({
  $id: z.string(),
  workspaceId: z.string(),
  studyId: z.string(),
  sessionId: z.string(),
  unit: BillableUnit.default("completed_interview"),
  occurredAt: z.string().datetime(),
});
export type UsageEvent = z.infer<typeof UsageEventSchema>;

/** Deterministic id = the billing-idempotency gate (one event per session). */
export function usageEventId(sessionId: string): string {
  return `ue_${sessionId}`;
}

export const UsageCounterSchema = z
  .object({
    $id: z.string(),
    workspaceId: z.string(),
    periodStart: z.string().datetime(),
    periodEnd: z.string().datetime(),
    completedInterviews: z.number().int().nonnegative(),
  })
  .superRefine((c, ctx) => {
    if (new Date(c.periodEnd) <= new Date(c.periodStart)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["periodEnd"],
        message: "periodEnd must be after periodStart",
      });
    }
  });
export type UsageCounter = z.infer<typeof UsageCounterSchema>;

export const QuotaStatus = z.enum(["ok", "over"]);
export type QuotaStatusValue = z.infer<typeof QuotaStatus>;

/** Derived per-workspace-per-period quota snapshot read by issueLivekitToken. */
export const QuotaStateSchema = z
  .object({
    workspaceId: z.string(),
    periodEnd: z.string().datetime(),
    usedInterviews: z.number().int().nonnegative(),
    includedInterviews: z.number().int().nonnegative(),
    hardCeiling: z.number().int().nonnegative(),
    state: QuotaStatus.default("ok"),
  })
  .superRefine((q, ctx) => {
    if (q.hardCeiling < q.includedInterviews) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["hardCeiling"],
        message: "hardCeiling must be >= includedInterviews",
      });
    }
  });
export type QuotaState = z.infer<typeof QuotaStateSchema>;

// --- Behavioral constants (logic, NOT pricing; enforced by Functions) ---
// Locked by products/workspaces-billing/spec/prd-pricing.md (ADR 0006 Update 2026-06-11).

/** Over the included allowance the workspace keeps serving until this multiple. */
export const QUOTA_HARD_CEILING_MULTIPLE = 2;
/** A session is billable only past this duration (guards trivially-short joins). */
export const COMPLETED_INTERVIEW_MIN_DURATION_MS = 60_000;
/** ...and only with at least this many substantive answers. */
export const COMPLETED_INTERVIEW_MIN_ANSWERS = 1;

/**
 * Pure predicate for "is this session a billable completed interview". Mirrors
 * the prd-pricing.md definition; used by the agent finalize emit and tests.
 * No I/O. Kept in contracts per `contracts.md` (invariant not expressible in zod).
 */
export function isBillableInterview(input: {
  state: string;
  durationMs: number;
  answeredCount: number;
}): boolean {
  return (
    input.state === "completed" &&
    input.durationMs >= COMPLETED_INTERVIEW_MIN_DURATION_MS &&
    input.answeredCount >= COMPLETED_INTERVIEW_MIN_ANSWERS
  );
}

/** Hard ceiling from an included allowance (the quota_exceeded trip point). */
export function hardCeilingFor(includedInterviews: number): number {
  return includedInterviews * QUOTA_HARD_CEILING_MULTIPLE;
}

// --- API payloads (M3 Functions) ---
// Request parsing happens in each Function's pure core (architecture.md).

export const CreateWorkspaceRequestSchema = z.object({
  name: z.string().min(1).max(120),
});
export type CreateWorkspaceRequest = z.infer<typeof CreateWorkspaceRequestSchema>;

export const CreateWorkspaceResponseSchema = z.object({
  workspaceId: z.string(),
  ownerUserId: z.string(),
  planKey: PlanKey,
});
export type CreateWorkspaceResponse = z.infer<typeof CreateWorkspaceResponseSchema>;

/** Members can be invited as admin or member only — owner is the creator alone. */
export const InvitableRole = z.enum(["admin", "member"]);
export type InvitableRoleValue = z.infer<typeof InvitableRole>;

export const InviteMemberRequestSchema = z.object({
  workspaceId: z.string().min(1),
  email: z.string().email(),
  role: InvitableRole,
});
export type InviteMemberRequest = z.infer<typeof InviteMemberRequestSchema>;

export const InviteMemberResponseSchema = z.object({
  membershipId: z.string(),
  status: MembershipStatus,
});
export type InviteMemberResponse = z.infer<typeof InviteMemberResponseSchema>;

export const ChangePlanRequestSchema = z.object({
  workspaceId: z.string().min(1),
  targetPlan: PlanKey,
});
export type ChangePlanRequest = z.infer<typeof ChangePlanRequestSchema>;

/** Stripe-hosted Checkout/Portal URL the client redirects to. */
export const ChangePlanResponseSchema = z.object({
  url: z.string().url(),
});
export type ChangePlanResponse = z.infer<typeof ChangePlanResponseSchema>;
