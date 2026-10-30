/**
 * Records for the viewer's tests, as swamp's data query returns them: the
 * draft model's five specs, each valid against its schema.
 *
 * @module
 */
import type { BuildResult } from "../contracts/build_result_v1.ts";
import type {
  DraftRecord,
  PrefillRecord,
  ReadinessRecord,
  VisibilityRecord,
} from "./records.ts";

/** One stored record, as `queryData` gives it. */
export interface FakeRecord {
  specName: string;
  name: string;
  version: number;
  attributes: Record<string, unknown>;
}

export const record = (
  specName: string,
  name: string,
  attributes: Record<string, unknown>,
  version = 1,
): FakeRecord => ({ specName, name, version, attributes });

export function prefill(
  name: string,
  extra: Partial<PrefillRecord> = {},
): PrefillRecord {
  return {
    name,
    specSource: "docs/contracts/outcome-spec.v1.example.json",
    out: `specs/${name}.json`,
    source: { url: "https://capture.example/requests/12", version: 2 },
    toDecide: ["delivery.method: pick how it is run"],
    warnings: [],
    prefilledAt: "2026-10-20T09:00:00.000Z",
    ...extra,
  };
}

export function draft(
  name: string,
  extra: Partial<DraftRecord> = {},
): DraftRecord {
  return {
    name,
    specSource: `specs/${name}.json`,
    targetDir: `/tmp/${name}`,
    repository: `https://github.com/example/${name}`,
    visibility: "private",
    modelType: `@puddleworks/${name}`,
    entryPointRef: `@puddleworks/${name}-run`,
    files: ["manifest.yaml", `extensions/models/${name}.ts`],
    overwrote: [],
    renderedAt: "2026-10-21T09:00:00.000Z",
    ...extra,
  };
}

export function visibility(
  name: string,
  extra: Partial<VisibilityRecord> = {},
): VisibilityRecord {
  return {
    name,
    targetDir: `/tmp/${name}`,
    recommendation: "private",
    canBePublic: false,
    manifestVisibility: "private",
    repoVisibility: "private",
    checks: [
      { id: "licence", role: "required", ok: true, detail: "MIT" },
      { id: "quality", role: "required", ok: false, detail: "Scored 80%" },
    ],
    findings: [
      { file: "README.md", line: 3, kind: "path", text: "/Users/someone" },
    ],
    assessedAt: "2026-10-22T09:00:00.000Z",
    ...extra,
  };
}

export function readiness(
  name: string,
  extra: Partial<ReadinessRecord> = {},
): ReadinessRecord {
  return {
    name,
    targetDir: `/tmp/${name}`,
    ready: true,
    package: `@puddleworks/${name}`,
    version: "2026.10.23.1",
    visibility: "private",
    recommendation: "private",
    reviewFile: "docs/review.md",
    review: {
      file: "docs/review.md",
      reviewedAt: "2026-10-23",
      counts: { pass: 10, na: 2, issue: 0, pending: 0 },
      issues: [],
    },
    criteria: [{
      id: "AC1",
      text: "Lists open tasks",
      tests: ["extensions/models/app_test.ts: lists open tasks"],
      manual: "",
      ok: true,
    }],
    blockers: [],
    summary: `Publish ${name}?`,
    pullRequest: null,
    commit: null,
    assessedAt: "2026-10-23T09:00:00.000Z",
    ...extra,
  };
}

export function buildResult(
  name: string,
  extra: Partial<BuildResult> = {},
): BuildResult {
  return {
    apiVersion: "puddleworks.dev/build-result/v1",
    kind: "BuildResult",
    name,
    extension: `@puddleworks/${name}`,
    entryPointRef: `@puddleworks/${name}-run`,
    repository: `https://github.com/example/${name}`,
    buildRef: `draft/${name}`,
    pullRequest: `https://github.com/example/${name}/pull/1`,
    builtAt: "2026-10-24T09:00:00.000Z",
    ...extra,
  };
}

/** Every record of one app, one per spec, with the instance names the draft model uses. */
export function allRecords(name: string): FakeRecord[] {
  return [
    record("prefill", `prefill-${name}`, { ...prefill(name) }),
    record("draft", name, { ...draft(name) }),
    record("visibility", `visibility-${name}`, { ...visibility(name) }),
    record("readiness", `readiness-${name}`, { ...readiness(name) }),
    record("buildResult", `build-result-${name}`, { ...buildResult(name) }),
  ];
}
