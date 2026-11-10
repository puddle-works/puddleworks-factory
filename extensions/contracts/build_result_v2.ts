/**
 * puddleworks.dev/build-result/v2 — what a build produced, where it is, and
 * the recipe it published.
 *
 * v2 differs from v1 in two ways. Each example no longer carries `recipeId` or
 * `router`: the request's outcome owner tests the phrases through puddlerouter
 * and records that where the request lives, so a builder doesn't report it.
 * And the result carries the published `recipe`, so the reader can compare its
 * phrases and empty answer with the agreed spec, exactly.
 *
 * Writers move to v2 once every reader accepts it; readers accept v1 and v2
 * until then. docs/contracts/build-result-v2.md describes the shape.
 *
 * @module
 */
import { z } from "npm:zod@4";
import { BuildResultSchema as V1 } from "./build_result_v1.ts";

/** The `apiVersion` every v2 build result carries. */
export const BUILD_RESULT_V2 = "puddleworks.dev/build-result/v2";

/** How the build answered each agreed phrase, by the builder's own check. */
export const BuildExamplesV2Schema = z.array(z.object({
  /** The example's phrase, exactly as in the spec. */
  phrase: z.string().trim().min(1).max(500),
  /** Whether the builder's check found the build answers it as agreed. */
  passed: z.boolean(),
  /** What was checked or seen, in plain words. */
  detail: z.string().max(2_000).optional(),
})).max(50);

/** The puddlerouter recipe the build published, as its tag says. */
export const BuildRecipeSchema = z.object({
  /** The recipe's `id`. */
  id: z.string().min(1).max(200),
  /** The agreed phrases the recipe answers, each exactly as in the spec. */
  phrases: z.array(z.string().trim().min(1).max(500)).min(1).max(50),
  /** What the recipe answers when there is nothing to show. Never blank. */
  empty: z.string().trim().min(1).max(2_000),
});

/** One build of one app spec. */
export const BuildResultV2Schema = V1.omit({ examples: true }).extend({
  apiVersion: z.literal(BUILD_RESULT_V2),
  /** How each agreed phrase went, by the builder's own check. */
  examples: BuildExamplesV2Schema.optional(),
  /** The recipe that was published, once there is one. */
  recipe: BuildRecipeSchema.optional(),
});

/** A parsed `puddleworks.dev/build-result/v2`. */
export type BuildResultV2 = z.infer<typeof BuildResultV2Schema>;

/** A build result of either version, as one recorded before v2 may be. */
export const AnyBuildResultSchema = z.union([V1, BuildResultV2Schema]);

/** Read a v2 build result from parsed JSON or YAML. Problems are plain language. */
export function parseBuildResultV2(
  value: unknown,
): { ok: true; result: BuildResultV2 } | { ok: false; problems: string[] } {
  const parsed = BuildResultV2Schema.safeParse(value);
  if (parsed.success) return { ok: true, result: parsed.data };
  return {
    ok: false,
    problems: parsed.error.issues.map((issue) => {
      const where = issue.path.join(".") || "(top level)";
      return where === "apiVersion"
        ? `apiVersion must be "${BUILD_RESULT_V2}".`
        : `${where}: ${issue.message}`;
    }),
  };
}
