/**
 * Eval harness type contract — surface adapter shape.
 *
 * A "surface" is the boundary at which we measure LLM behavior. Each
 * surface adapter wraps a production code path that takes an input and
 * produces an output the eval scorer can grade.
 *
 * See `.kiro/specs/ai-eval-suite/design.md` § Architecture for the
 * harness's component split (surfaces / scorers / runner / corpus).
 */

/**
 * Generic surface adapter. Surfaces are uniquely named so the runner
 * can route corpus rows to the right adapter.
 *
 * Naming: `<area>.<entity>.<phase>` per
 * `.kiro/steering/errors-and-observability.md` § LLM call observability
 * (e.g. "morris.tool.createStudyDraft", "function.analyzeSession.text-pass").
 */
export interface SurfaceAdapter<Input, Output> {
  /** Unique surface identifier. Routes corpus rows to this adapter. */
  readonly name: string;

  /**
   * Run the surface's production code path against `input` and return
   * the output for scoring. Surfaces MAY call real providers; the runner
   * enforces a per-scenario token cap (see harness/runner.ts).
   */
  invoke(input: Input): Promise<Output>;
}

/** Loose JSON shape — corpus rows are parsed from `.jsonl`. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
