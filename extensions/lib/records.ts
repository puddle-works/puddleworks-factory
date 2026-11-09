/**
 * The records the draft model keeps for each app, one resource each: the
 * prefill, the draft, the plan review, the visibility check and the readiness
 * check. The build
 * result is a puddleworks.dev/build-result/v1 (contracts/build_result_v1.ts).
 *
 * The draft model writes them and the viewer reads them, so both use these
 * schemas.
 *
 * @module
 */
import { z } from "npm:zod@4";
import { SpecSourceSchema } from "../contracts/app_spec_v1.ts";
import { BuildExamplesSchema } from "../contracts/build_result_v1.ts";
import { CandidateSchema, MatchSchema, VERDICTS } from "./assess.ts";

export const DraftSchema = z.object({
  /** The app spec's name. */
  name: z.string(),
  /** `inline`, or the path or URL the spec was read from. */
  specSource: z.string(),
  /** Where the spec was agreed, when it said. */
  source: SpecSourceSchema.optional(),
  targetDir: z.string(),
  /** The app's repository, when the draft was given one. */
  repository: z.string().optional(),
  /** The manifest's visibility, when the draft recorded it. */
  visibility: z.enum(["public", "private"]).optional(),
  modelType: z.string(),
  entryPointRef: z.string(),
  /** Paths written, relative to targetDir. */
  files: z.array(z.string()),
  /** Paths that already existed and were replaced (overwrite=true only). */
  overwrote: z.array(z.string()),
  /** The recipe the spec asked for: what was written, or why it wasn't. */
  recipe: z.object({
    /** The phrases agreed in the spec. */
    examples: z.array(z.string()),
    /** The names of the recipe's pieces. */
    pieces: z.array(z.string()),
    /** The recipe workflow written, relative to targetDir. */
    workflow: z.string().optional(),
    /** Why none was written. */
    reason: z.string().optional(),
  }).optional(),
  renderedAt: z.iso.datetime(),
});

export const PrefillSchema = z.object({
  /** The app name the starter suggests. */
  name: z.string(),
  /** `inline`, or the path or URL the outcome spec was read from. */
  specSource: z.string(),
  /** Where the starter app spec was written. */
  out: z.string(),
  /** Where the outcome spec was agreed. */
  source: SpecSourceSchema,
  /** Fields the builder must check or fill in, `<field>: <why>`. */
  toDecide: z.array(z.string()),
  /** Things in the outcome spec to sort out before building. */
  warnings: z.array(z.string()),
  prefilledAt: z.iso.datetime(),
});

export const FindingSchema = z.object({
  file: z.string(),
  line: z.number().int(),
  kind: z.string(),
  text: z.string(),
});

export const VisibilitySchema = z.object({
  name: z.string(),
  targetDir: z.string(),
  /** `public` only when every required check passes and no signal says otherwise. */
  recommendation: z.enum(["public", "private"]),
  /** Every required check passed, so public is allowed. */
  canBePublic: z.boolean(),
  manifestVisibility: z.enum(["public", "private"]).nullable(),
  repoVisibility: z.enum(["public", "private"]),
  /**
   * The quality it was given, so readiness can check the files again as they
   * are then. Not in records written before 2026.10.30.1.
   */
  quality: z.number().optional(),
  /** The quality with the registry's provisional points; 0 when none were given. */
  provisionalQuality: z.number().optional(),
  checks: z.array(z.object({
    id: z.string(),
    role: z.enum(["required", "signal", "info"]),
    ok: z.boolean(),
    detail: z.string(),
  })),
  findings: z.array(FindingSchema),
  assessedAt: z.iso.datetime(),
});

export const ReadinessSchema = z.object({
  name: z.string(),
  targetDir: z.string(),
  /** No blockers: the review is complete and every acceptance criterion is checked. */
  ready: z.boolean(),
  package: z.string().nullable(),
  version: z.string().nullable(),
  /** The manifest's visibility. */
  visibility: z.enum(["public", "private"]).nullable(),
  /** What the visibility check recommended, or null when it has not run. */
  recommendation: z.enum(["public", "private"]).nullable(),
  reviewFile: z.string(),
  review: z.object({
    file: z.string(),
    reviewedAt: z.string(),
    counts: z.object({
      pass: z.number().int(),
      na: z.number().int(),
      issue: z.number().int(),
      pending: z.number().int(),
    }),
    issues: z.array(z.object({ id: z.string(), note: z.string() })),
  }).nullable(),
  criteria: z.array(z.object({
    id: z.string(),
    text: z.string(),
    tests: z.array(z.string()),
    manual: z.string(),
    ok: z.boolean(),
  })),
  blockers: z.array(z.string()),
  /** How the recipe went, or why there is none; null when no phrase was agreed. */
  recipe: z.string().nullable().optional(),
  /** How each agreed phrase went. Left out when no check could run. */
  examples: BuildExamplesSchema.optional(),
  /** One screen of plain text to confirm publishing against. */
  summary: z.string(),
  pullRequest: z.string().nullable(),
  commit: z.string().nullable(),
  assessedAt: z.iso.datetime(),
});

export const PlanReviewSchema = z.object({
  name: z.string(),
  /** Where the plan was read from. */
  plan: z.string(),
  /** `sha256:` and the hex digest of the plan's text: the version reviewed. */
  planHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  /**
   * `pass`: the plan meets the spec and is a good plan. `concerns`: the
   * reviewer found something to change. `pending`: no review yet. `failed`:
   * the reviewer could not review it. Advisory: none of them stops the build.
   */
  verdict: z.enum(["pass", "concerns", "pending", "failed"]),
  /** What the reviewer replied, or why there is no review. */
  response: z.string(),
  reviewedAt: z.iso.datetime(),
});

export const AssessmentSchema = z.object({
  /** The app name the assessment is filed under. */
  name: z.string(),
  /** `inline`, or the path or URL the outcome spec was read from. */
  specSource: z.string(),
  delivery: z.enum(["packaged_script", "scheduled_workflow"]),
  verdict: z.enum(VERDICTS),
  /** The candidate the verdict uses, when it uses one. */
  chosen: z.object({
    extension: z.string(),
    type: z.string(),
    method: z.string(),
  }).nullable(),
  /** Every candidate looked at, whose it is, and the checks it failed. */
  candidates: z.array(CandidateSchema.extend({
    owner: z.enum(["ours", "external"]),
    fits: z.boolean(),
    failed: z.array(z.string()),
  })),
  /** What `match` picked for each example phrasing. */
  matches: z.array(MatchSchema),
  reason: z.string(),
  assessedAt: z.iso.datetime(),
});

/** An assessment record: what needs building, and the evidence. */
export type AssessmentRecord = z.infer<typeof AssessmentSchema>;

/** A draft record: which files were written where. */
export type DraftRecord = z.infer<typeof DraftSchema>;
/** A prefill record: the starter app spec and what is left to decide. */
export type PrefillRecord = z.infer<typeof PrefillSchema>;
/** A plan review record: the verdict on one version of the build plan. */
export type PlanReviewRecord = z.infer<typeof PlanReviewSchema>;
/** A visibility record: the recommendation and its checks. */
export type VisibilityRecord = z.infer<typeof VisibilitySchema>;
/** A readiness record: the review, the criteria and the blockers. */
export type ReadinessRecord = z.infer<typeof ReadinessSchema>;
