/**
 * puddleworks.dev/build-result/v1 — what a build produced, and where it is.
 *
 * Factory writes one after a build. Anything can read it as it is: a person,
 * or the tool the spec came from, to record it against the request. Any
 * factory may write one, not only this one.
 *
 * This is Factory's own copy of the contract. Other readers and writers can
 * test against the same example file.
 * docs/contracts/build-result.md describes the shape and how it may change.
 *
 * @module
 */
import { z } from "npm:zod@4";

/** The `apiVersion` every v1 build result carries. */
export const BUILD_RESULT_V1 = "puddleworks.dev/build-result/v1";

const httpsUrl = z.url({ protocol: /^https$/ });

/** A path relative to the repository root that does not climb out of it. */
const repoPath = z.string().min(1).refine(
  (p) => !p.startsWith("/") && !p.split("/").includes(".."),
  "must be relative to the repository root and stay inside it",
);

/** Where the built spec was agreed: the app spec's `source`, copied as it is. */
const SourceSchema = z.object({
  url: z.url({ protocol: /^https?$/ }),
  version: z.number().int().positive().optional(),
  specHash: z.string().min(1).optional(),
});

/** One build of one app spec. */
export const BuildResultSchema = z.object({
  apiVersion: z.literal(BUILD_RESULT_V1),
  kind: z.literal("BuildResult"),
  /** The app spec's `name`: which spec was built. */
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  /** Package name of the built extension, `@<scope>/<name>`. */
  extension: z.string().regex(/^@[a-z0-9-]+\/[a-z0-9-]+$/),
  /** The workflow to run the app with, `@<scope>/<slug>`. */
  entryPointRef: z.string().regex(/^@[a-z0-9-]+\/[a-z0-9-]+$/),
  /** The repository the build was written to. */
  repository: httpsUrl,
  /** Where in the repository the app's docs and manifest are. */
  path: repoPath.optional(),
  /** Branch or commit the build is on. */
  buildRef: z.string().min(1),
  /** The pull request that proposes the build, once there is one. */
  pullRequest: httpsUrl.optional(),
  /** Where the built spec was agreed, when the spec said. */
  source: SourceSchema.optional(),
  builtAt: z.iso.datetime(),
});

/** A parsed `puddleworks.dev/build-result/v1`. */
export type BuildResult = z.infer<typeof BuildResultSchema>;

/** Read a build result from parsed JSON or YAML. Problems are plain language. */
export function parseBuildResult(
  value: unknown,
): { ok: true; result: BuildResult } | { ok: false; problems: string[] } {
  const parsed = BuildResultSchema.safeParse(value);
  if (parsed.success) return { ok: true, result: parsed.data };
  return {
    ok: false,
    problems: parsed.error.issues.map((issue) => {
      const where = issue.path.join(".") || "(top level)";
      return where === "apiVersion"
        ? `apiVersion must be "${BUILD_RESULT_V1}".`
        : `${where}: ${issue.message}`;
    }),
  };
}
