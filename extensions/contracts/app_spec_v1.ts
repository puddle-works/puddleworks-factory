/**
 * puddleworks.dev/app-spec/v1 — the portable app spec.
 *
 * What Factory builds from. Anything can write one: a person or another
 * tool can write it by hand, and Factory prefills one from an outcome spec.
 * Factory reads no other data, only this shape.
 *
 * This is Factory's own copy of the contract. Other readers and writers can
 * test against the same example file.
 * docs/contracts/app-spec.md describes the shape and how it may change.
 *
 * @module
 */
import { z } from "npm:zod@4";

export const APP_SPEC_V1 = "puddleworks.dev/app-spec/v1";

/**
 * How the app reaches the person who asked for it. `workflow_form` is
 * deprecated: nothing gives the user a form, so Factory drafts it as
 * `packaged_script`. It still parses in v1 and goes in app-spec/v2.
 */
export const DeliveryMethodSchema = z.enum([
  "workflow_form",
  "packaged_script",
  "scheduled_workflow",
  "external_app",
  "manual_process",
]);

export type DeliveryMethod = z.infer<typeof DeliveryMethodSchema>;

/** Value types a specification input can take. */
const SpecInputTypeSchema = z.enum(["string", "number", "integer", "boolean"]);

/**
 * One requester-facing input. It becomes a workflow input (a form field) and
 * a method argument in the drafted extension. Every input is either required
 * or has a default, so the workflow can always pass it on.
 */
const SpecInputSchema = z.object({
  /** camelCase identifier, used as the workflow input and argument name. */
  name: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
  type: SpecInputTypeSchema,
  /** Plain-language label the requester sees. */
  description: z.string().min(1),
  required: z.boolean(),
  /** Required when `required` is false; forbidden when it is true. */
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

/**
 * Per-instance configuration the builder sets once, not the requester
 * (a path on the host, an API token). Becomes a global argument.
 */
const SpecSettingSchema = z.object({
  name: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
  description: z.string().min(1),
  /** True for secrets; the drafted argument then needs a vault.get() value. */
  sensitive: z.boolean(),
});

/**
 * The agreed bounded behaviour of the app. The draft generator builds from
 * it.
 */
export const SpecificationSchema = z.object({
  /** One bounded purpose, in a sentence. */
  purpose: z.string().min(1),
  inputs: z.array(SpecInputSchema),
  /** What one run produces. */
  output: z.string().min(1),
  /** What the app deliberately does not do. */
  outOfScope: z.array(z.string().min(1)),
  settings: z.array(SpecSettingSchema).optional(),
  recordedBy: z.string().email(),
  recordedAt: z.iso.datetime(),
});

export type Specification = z.infer<typeof SpecificationSchema>;
export type SpecInput = z.infer<typeof SpecInputSchema>;

function defaultMatches(input: SpecInput): boolean {
  const v = input.default;
  switch (input.type) {
    case "string":
      return typeof v === "string";
    case "boolean":
      return typeof v === "boolean";
    case "number":
      return typeof v === "number";
    case "integer":
      return typeof v === "number" && Number.isInteger(v);
  }
}

/**
 * Rules the argument schema cannot express. Returns one plain-language problem
 * per broken rule; an empty list means the specification is usable.
 */
export function specificationProblems(
  spec: Pick<Specification, "inputs" | "settings">,
): string[] {
  const problems: string[] = [];
  for (const input of spec.inputs) {
    if (input.required && input.default !== undefined) {
      problems.push(
        `Input "${input.name}" is required, so it must not have a default.`,
      );
    } else if (!input.required && input.default === undefined) {
      problems.push(
        `Input "${input.name}" is optional, so it needs a default.`,
      );
    } else if (!input.required && !defaultMatches(input)) {
      problems.push(
        `Input "${input.name}" is ${input.type}, but its default ${
          JSON.stringify(input.default)
        } is not.`,
      );
    }
  }
  const seen = new Set<string>();
  for (
    const name of [
      ...spec.inputs.map((i) => i.name),
      ...(spec.settings ?? []).map((s) => s.name),
    ]
  ) {
    if (seen.has(name)) {
      problems.push(
        `"${name}" is used more than once across inputs and settings.`,
      );
    }
    seen.add(name);
  }
  return problems;
}

/**
 * Where the spec was agreed, for a link back to the discussion behind it: a
 * request page, an issue, or any other web page. Optional.
 */
export const SpecSourceSchema = z.object({
  /** Web page where the spec was agreed. http is allowed: it may be a local server. */
  url: z.url({ protocol: /^https?$/ }),
  /** Version of the agreed spec there, so a later revision is visibly different. */
  version: z.number().int().positive().optional(),
  /** Hash of the agreed spec there, as that system worked it out. */
  specHash: z.string().min(1).optional(),
});

export type SpecSource = z.infer<typeof SpecSourceSchema>;

/** The portable spec: what to build, and how it will be delivered. */
export const AppSpecSchema = z.object({
  apiVersion: z.literal(APP_SPEC_V1),
  kind: z.literal("AppSpec"),
  /** Slug; becomes the app name, the model type suffix and the instance name. */
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  title: z.string().min(1),
  specification: SpecificationSchema,
  delivery: z.object({
    method: DeliveryMethodSchema,
    /** Workflow name, or `<scope>/<slug>`. Defaults to `name` when absent. */
    entryPointRef: z.string().optional(),
  }),
  /** Why the result is reusable beyond the one case that asked for it. */
  reusabilityNote: z.string().optional(),
  /** Where the spec was agreed. */
  source: SpecSourceSchema.optional(),
});

export type AppSpec = z.infer<typeof AppSpecSchema>;

/** Read an app spec from parsed JSON or YAML. Problems are plain language. */
export function parseAppSpec(
  value: unknown,
): { ok: true; spec: AppSpec } | { ok: false; problems: string[] } {
  const parsed = AppSpecSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((issue) => {
        const where = issue.path.join(".") || "(top level)";
        return where === "apiVersion"
          ? `apiVersion must be "${APP_SPEC_V1}".`
          : `${where}: ${issue.message}`;
      }),
    };
  }
  const problems = specificationProblems(parsed.data.specification);
  return problems.length > 0
    ? { ok: false, problems }
    : { ok: true, spec: parsed.data };
}
