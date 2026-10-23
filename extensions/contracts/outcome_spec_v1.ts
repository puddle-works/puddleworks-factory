/**
 * puddleworks.dev/outcome-spec/v1 — what was agreed, by whom.
 *
 * An outcome spec records a request once its specification is agreed. It
 * says what success looks like, not how to build it: it has no app name, typed inputs, settings or delivery method.
 * Factory reads it to prefill an app-spec/v1, and the builder adds the rest.
 *
 * This is Factory's own copy of the contract. docs/contracts/outcome-spec.md
 * describes the shape. Factory only reads it, so this copy checks less than a
 * writer should.
 *
 * @module
 */
import { z } from "npm:zod@4";

/** The `format` every v1 outcome spec carries. */
export const OUTCOME_SPEC_V1 = "puddleworks.dev/outcome-spec/v1";

const PersonSchema = z.object({ name: z.string(), email: z.string() });

/** One agreed outcome spec, as exported. */
export const OutcomeSpecSchema = z.object({
  format: z.literal(OUTCOME_SPEC_V1),
  request: z.object({
    id: z.string(),
    title: z.string(),
    initialDescription: z.string(),
    currentProcess: z.string(),
    /** The request's page, where the discussion and agreement are. */
    url: z.url(),
  }),
  specification: z.object({
    /** Which agreed version of the specification this is. */
    version: z.number().int().positive(),
    problemStatement: z.string(),
    desiredOutcome: z.string(),
    scope: z.object({ in: z.array(z.string()), out: z.array(z.string()) }),
    constraints: z.array(z.string()),
    assumptions: z.array(z.string()),
    acceptanceCriteria: z.array(z.object({ id: z.string(), text: z.string() })),
  }),
  agreement: z.object({
    agreedBy: PersonSchema,
    agreedAt: z.string(),
    specHash: z.string(),
  }),
  participants: z.array(PersonSchema.extend({ role: z.string() })),
  openQuestions: z.array(
    z.object({
      question: z.string(),
      askedBy: z.string(),
      askedAt: z.string(),
    }),
  ),
  exportedAt: z.string(),
});

/** A parsed `puddleworks.dev/outcome-spec/v1`. */
export type OutcomeSpec = z.infer<typeof OutcomeSpecSchema>;

/** Read an outcome spec from parsed JSON or YAML. Problems are plain language. */
export function parseOutcomeSpec(
  value: unknown,
): { ok: true; spec: OutcomeSpec } | { ok: false; problems: string[] } {
  const parsed = OutcomeSpecSchema.safeParse(value);
  if (parsed.success) return { ok: true, spec: parsed.data };
  const wrongFormat = parsed.error.issues.some((i) => i.path[0] === "format");
  if (wrongFormat) {
    return { ok: false, problems: [`format must be "${OUTCOME_SPEC_V1}".`] };
  }
  return {
    ok: false,
    problems: parsed.error.issues.map((issue) =>
      `${issue.path.join(".") || "(top level)"}: ${issue.message}`
    ),
  };
}
