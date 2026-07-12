/**
 * Interview flow engine contracts.
 *
 * Borrowed shape from typebot.io `packages/bot-engine`:
 * - Steps play the role of typebot's Block (a unit of flow the engine executes)
 * - Edges play the role of typebot's Edge (a directed connection between steps)
 * - Every step carries an optional `outgoingEdgeId` = the DEFAULT next edge,
 *   mirroring typebot's `block.outgoingEdgeId`
 * - Steps with per-option branching (QuestionStep options, ConditionStep items)
 *   also carry per-item `outgoingEdgeId`, mirroring typebot's `ChoiceItem`/
 *   `ConditionItem.outgoingEdgeId`
 *
 * The engine is a pure function of (config, state, event) → (next state, effect).
 * It has NO LiveKit imports; LiveKit is a runtime host that consumes effects
 * yielded by the engine. See `apps/agent/agent/flow_engine/`.
 *
 * Reference:
 *   /tmp/external-repos/typebot.io/packages/bot-engine/src/walkFlowForward.ts
 *   /tmp/external-repos/typebot.io/packages/bot-engine/src/executeLogic.ts
 *   /tmp/external-repos/typebot.io/packages/typebot/src/schemas/edge.ts
 */
import { z } from "zod";
import { QuestionType, StimulusSchema } from "./entities.js";

// -----------------------------------------------------------------------------
// Step base
// -----------------------------------------------------------------------------

/**
 * Every FlowStep carries `stepId` (stable id, used by edges and by the engine's
 * cursor) and `outgoingEdgeId` (the DEFAULT next edge). Sub-shapes may attach
 * additional per-item `outgoingEdgeId`s that OVERRIDE the default.
 *
 * Corresponds to typebot's `blockBaseSchema` = { id, outgoingEdgeId? }.
 */
const FlowStepBaseSchema = z.object({
  stepId: z.string().min(1),
  outgoingEdgeId: z.string().nullable().optional(),
});

// -----------------------------------------------------------------------------
// QuestionStep — asks a question and waits for an answer
// -----------------------------------------------------------------------------

/**
 * One option in a choice-based question. If `outgoingEdgeId` is set, picking
 * this option overrides the question's default `outgoingEdgeId`.
 *
 * Corresponds to typebot's `ChoiceItem` = { id, content, outgoingEdgeId? }.
 */
export const FlowQuestionOptionSchema = z.object({
  optionId: z.string().min(1),
  content: z.string().min(1),
  outgoingEdgeId: z.string().nullable().optional(),
});

export const QuestionStepSchema = FlowStepBaseSchema.extend({
  kind: z.literal("question"),
  questionType: QuestionType,
  content: z.string().min(1),
  options: z.array(FlowQuestionOptionSchema).default([]),
  stimulus: StimulusSchema.optional(),
});

// -----------------------------------------------------------------------------
// ProbeStep — runs a follow-up sequence for a prior QuestionStep
// -----------------------------------------------------------------------------

/**
 * A dedicated probe step. Sits AFTER a QuestionStep in the flow graph and asks
 * follow-up questions about the last answer. The step is a "black box" to the
 * flow engine: the executor runs up to `maxRounds` probe exchanges (LLM
 * self-reports each round via a tool-call gate, same mechanism the current
 * LiveKitQuestionTask uses today), then returns control to the engine which
 * resolves the outgoing edge.
 *
 * Modeled as a first-class step (not folded into QuestionStep) so probes can be:
 * - Skipped entirely (by not inserting a ProbeStep in the flow)
 * - Conditionally routed (a ConditionStep before the ProbeStep can decide
 *   whether the answer needs probing)
 * - Chained (multiple ProbeSteps in sequence for staged deep-dives)
 *
 * There is no typebot equivalent — this is Merism-specific, because typebot is
 * form-based (one input → one answer) and MerismV2 is qualitative-interview-
 * based (one question → multi-turn follow-up).
 */
export const ProbeStepSchema = FlowStepBaseSchema.extend({
  kind: z.literal("probe"),
  /** The QuestionStep whose answer this step probes. Used by the executor to
   *  look up the main-question context (content + last respondent answer) when
   *  instructing the LLM. */
  forQuestionStepId: z.string().min(1),
  /** Free-form guidance the researcher wrote for this probe (tone, angle,
   *  what to dig into). Passed verbatim to the LLM in the step's instructions. */
  instruction: z.string().default(""),
  level: z.enum(["standard", "deep"]).default("standard"),
  /** Hard upper bound on probe rounds. Enforced deterministically by the
   *  executor, not trusted to the LLM. Matches the current `probeConfig.
   *  maxRounds` semantics in `agent.interview.tasks.question`. */
  maxRounds: z.number().int().positive().default(3),
});

// -----------------------------------------------------------------------------
// ConditionStep — branches based on a prior step's answer
// -----------------------------------------------------------------------------

/**
 * Predicate matched against a prior step's collected answer.
 *
 * Single-shape: a natural-language `condition` string that the host evaluates
 * at runtime by asking an LLM "does the source answer satisfy this condition?"
 * (YES/NO). Design borrowed directly from Retell AI's `Prompt` transition
 * condition (`docs.retellai.com/build/conversation-flow/transition-condition`),
 * simplified because MerismV2's first version doesn't yet need Retell's
 * `Equation` type (call-time dynamic variables).
 *
 * The old shape (`operator: "equals"|"contains"|"startsWith"` + `value`) was
 * removed because string-level matching against transcribed voice answers is
 * too brittle for realistic interviews — a user saying "I'm kind of a
 * student, in a masters program while working" won't literally `equals` or
 * `startsWith` any researcher-authored string, but an LLM easily maps it to
 * "is a full-time student?" (NO) or "is both student and worker?" (YES).
 *
 * Evolution path: to add non-LLM comparators later (e.g. equation-mode on
 * pre-injected variables), add a new sibling schema and turn this into a
 * discriminated union — do NOT extend this schema with an operator field
 * (that would recreate the same brittleness).
 */
const FlowConditionPredicateSchema = z.object({
  /** The step whose answer this condition judges. Almost always the
   *  QuestionStep immediately preceding the ConditionStep, but the field is
   *  explicit so future flow shapes (e.g. cross-question condition steps) can
   *  reference an earlier answer. */
  sourceStepId: z.string().min(1),
  /** Natural-language condition, evaluated by an LLM at runtime. Bounded
   *  length prevents unintentional prompt-injection bloat and keeps single
   *  conditions readable in the editor. */
  condition: z.string().trim().min(1).max(500),
});

/**
 * One branch of a ConditionStep. If its predicate matches, its `outgoingEdgeId`
 * is chosen; if no items match, the step's own `outgoingEdgeId` is used (the
 * "else" branch).
 *
 * Corresponds to typebot's `ConditionItem` = { id, content: Condition,
 * outgoingEdgeId? }.
 */
const FlowConditionItemSchema = z.object({
  itemId: z.string().min(1),
  predicate: FlowConditionPredicateSchema,
  outgoingEdgeId: z.string().nullable().optional(),
});

export const ConditionStepSchema = FlowStepBaseSchema.extend({
  kind: z.literal("condition"),
  items: z.array(FlowConditionItemSchema).min(1),
});

// -----------------------------------------------------------------------------
// FlowStep = discriminated union of all step kinds
// -----------------------------------------------------------------------------

/**
 * The engine dispatches by `step.kind`. Adding a new step kind means:
 * 1. Add its schema here to the union
 * 2. Add a Python mirror in `agent/contracts.py`
 * 3. Add an executor in `apps/agent/agent/flow_engine/steps/<kind>.py`
 * 4. Register the executor in the engine's dispatch table
 *
 * Corresponds to typebot's `Block = BubbleBlock | InputBlock | LogicBlock |
 * IntegrationBlock | ForgedBlock` (`packages/blocks/core/src/schemas/schema.ts`).
 */
export const FlowStepSchema = z.discriminatedUnion("kind", [
  QuestionStepSchema,
  ProbeStepSchema,
  ConditionStepSchema,
]);

// -----------------------------------------------------------------------------
// FlowEdge — directed connection between steps
// -----------------------------------------------------------------------------

/**
 * Directed edge from one step (optionally from one of its items/options) to
 * another step.
 *
 * `from.optionId` is set when the edge originates from a specific option of a
 * QuestionStep or a specific item of a ConditionStep, mirroring typebot's
 * `edge.from = { blockId, itemId? }` structure.
 *
 * Corresponds to typebot's `edgeSchema` = { id, from: Source, to: Target }
 * (`packages/typebot/src/schemas/edge.ts`).
 */
export const FlowEdgeSchema = z.object({
  id: z.string().min(1),
  from: z.object({
    stepId: z.string().min(1),
    optionId: z.string().min(1).optional(),
  }),
  to: z.object({
    stepId: z.string().min(1),
  }),
});

// -----------------------------------------------------------------------------
// InterviewFlowConfig — the whole graph handed to the engine
// -----------------------------------------------------------------------------

/**
 * The entire flow definition for one interview session. Produced by the web
 * editor (from Survey rows in Appwrite), serialized as JSON, and threaded
 * through `LiveKit room metadata` to the agent process.
 *
 * `startStepId` is the entry point (analogous to typebot's
 * `events[0].outgoingEdgeId` for V6 bots — the target of the START event).
 *
 * REPLACES the legacy `InterviewWorkflowConfig` (sections + questions linear).
 * The old shape is preserved in `api.ts` as a compat alias until all downstream
 * consumers migrate. New code MUST target this shape.
 */
export const InterviewFlowConfigSchema = z
  .object({
    surveyId: z.string().min(1),
    sessionId: z.string().min(1),
    /** The composed moderator system prompt (researcher-authored persona +
     *  operational rules). Composed on the TS side by the config builder,
     *  consumed verbatim by the Python engine host as the LLM system prompt. */
    moderatorInstruction: z.string().min(1),
    startStepId: z.string().min(1),
    steps: z.array(FlowStepSchema).min(1),
    edges: z.array(FlowEdgeSchema).default([]),
  })
  .superRefine((config, ctx) => {
    // Every stepId must be unique.
    const stepIds = new Set<string>();
    for (const [i, step] of config.steps.entries()) {
      if (stepIds.has(step.stepId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["steps", i, "stepId"],
          message: `duplicate stepId "${step.stepId}"`,
        });
      }
      stepIds.add(step.stepId);
    }
    // startStepId must resolve.
    if (!stepIds.has(config.startStepId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startStepId"],
        message: `startStepId "${config.startStepId}" not found in steps`,
      });
    }
    // Every edge endpoint must resolve.
    for (const [i, edge] of config.edges.entries()) {
      if (!stepIds.has(edge.from.stepId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edges", i, "from", "stepId"],
          message: `edge.from.stepId "${edge.from.stepId}" not found in steps`,
        });
      }
      if (!stepIds.has(edge.to.stepId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edges", i, "to", "stepId"],
          message: `edge.to.stepId "${edge.to.stepId}" not found in steps`,
        });
      }
    }
    // Per-step per-option/per-item edge references must resolve into `edges`.
    // (`outgoingEdgeId` values point BY ID at entries in `config.edges`; a
    //  dangling outgoingEdgeId would make the engine terminate silently.)
    const edgeIds = new Set(config.edges.map((e) => e.id));
    for (const [i, step] of config.steps.entries()) {
      if (step.outgoingEdgeId && !edgeIds.has(step.outgoingEdgeId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["steps", i, "outgoingEdgeId"],
          message: `step.outgoingEdgeId "${step.outgoingEdgeId}" not found in edges`,
        });
      }
      if (step.kind === "question") {
        for (const [j, opt] of step.options.entries()) {
          if (opt.outgoingEdgeId && !edgeIds.has(opt.outgoingEdgeId)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["steps", i, "options", j, "outgoingEdgeId"],
              message: `option.outgoingEdgeId "${opt.outgoingEdgeId}" not found in edges`,
            });
          }
        }
      }
      if (step.kind === "condition") {
        for (const [j, item] of step.items.entries()) {
          if (item.outgoingEdgeId && !edgeIds.has(item.outgoingEdgeId)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["steps", i, "items", j, "outgoingEdgeId"],
              message: `item.outgoingEdgeId "${item.outgoingEdgeId}" not found in edges`,
            });
          }
        }
      }
    }
  });

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type FlowQuestionOption = z.infer<typeof FlowQuestionOptionSchema>;
export type QuestionStep = z.infer<typeof QuestionStepSchema>;
export type ProbeStep = z.infer<typeof ProbeStepSchema>;
export type ConditionStep = z.infer<typeof ConditionStepSchema>;
export type FlowStep = z.infer<typeof FlowStepSchema>;
export type FlowEdge = z.infer<typeof FlowEdgeSchema>;
export type InterviewFlowConfig = z.infer<typeof InterviewFlowConfigSchema>;
