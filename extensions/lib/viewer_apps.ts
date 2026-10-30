/**
 * The viewer's reading of the draft model's records: one app per name, the
 * stage each app is at, and its timeline. Nothing here does I/O, so the page
 * and its tests share it.
 *
 * Each record is read by its spec, and the app name is its instance name less
 * that spec's prefix (extensions/lib/names.ts). A draft uses the bare name, so
 * a draft named `readiness-foo` is the app `readiness-foo`, never foo's
 * readiness.
 *
 * @module
 */
import {
  type BuildResult,
  BuildResultSchema,
} from "../contracts/build_result_v1.ts";
import { RESOURCE_PREFIX } from "./names.ts";
import {
  type DraftRecord,
  DraftSchema,
  type PrefillRecord,
  PrefillSchema,
  type ReadinessRecord,
  ReadinessSchema,
  type VisibilityRecord,
  VisibilitySchema,
} from "./records.ts";

/** One app and its latest record of each kind, where there is one. */
export interface App {
  name: string;
  prefill?: PrefillRecord;
  draft?: DraftRecord;
  visibility?: VisibilityRecord;
  readiness?: ReadinessRecord;
  buildResult?: BuildResult;
}

type RecordKey = Exclude<keyof App, "name">;

/** Each spec the draft model writes: which field it fills, its prefix and schema. */
const SPECS: Readonly<
  Record<string, {
    key: RecordKey;
    prefix: string;
    schema: { safeParse(v: unknown): { success: boolean; data?: unknown } };
  }>
> = {
  prefill: {
    key: "prefill",
    prefix: RESOURCE_PREFIX.prefill,
    schema: PrefillSchema,
  },
  draft: { key: "draft", prefix: "", schema: DraftSchema },
  visibility: {
    key: "visibility",
    prefix: RESOURCE_PREFIX.visibility,
    schema: VisibilitySchema,
  },
  readiness: {
    key: "readiness",
    prefix: RESOURCE_PREFIX.readiness,
    schema: ReadinessSchema,
  },
  buildResult: {
    key: "buildResult",
    prefix: RESOURCE_PREFIX.buildResult,
    schema: BuildResultSchema,
  },
};

/** A record's attributes, whether stored as an object or as JSON text. */
function attributesOf(record: Record<string, unknown>): unknown {
  const value = record.attributes ?? record.content;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * The apps in swamp's records. A record of another spec, one whose name lacks
 * its spec's prefix, and one that fails its schema are left out.
 */
export function appsFromRecords(records: unknown[]): App[] {
  const apps = new Map<string, App>();
  const versions = new Map<string, number>();
  for (const record of records) {
    if (record === null || typeof record !== "object") continue;
    const r = record as Record<string, unknown>;
    const spec =
      typeof r.specName === "string" && Object.hasOwn(SPECS, r.specName)
        ? SPECS[r.specName]
        : undefined;
    if (!spec || typeof r.name !== "string") continue;
    if (!r.name.startsWith(spec.prefix)) continue;
    const name = r.name.slice(spec.prefix.length);
    if (name === "") continue;
    const parsed = spec.schema.safeParse(attributesOf(r));
    if (!parsed.success) continue;
    const version = typeof r.version === "number" ? r.version : 0;
    const seen = `${spec.key}/${name}`;
    if ((versions.get(seen) ?? -1) > version) continue;
    versions.set(seen, version);
    const app = apps.get(name) ?? { name };
    (app as unknown as Record<string, unknown>)[spec.key] = parsed.data;
    apps.set(name, app);
  }
  return [...apps.values()];
}

/** Where an app is, from the first step of the Factory to the last. */
export type Stage =
  | "to_decide"
  | "drafted"
  | "visibility_checked"
  | "blocked"
  | "ready"
  | "released";

/** The stages in Factory order, with the overview's heading and badge for each. */
export const STAGES: ReadonlyArray<
  { stage: Stage; heading: string; badge: string }
> = [
  { stage: "to_decide", heading: "To decide", badge: "review" },
  { stage: "drafted", heading: "Drafted", badge: "draft" },
  {
    stage: "visibility_checked",
    heading: "Visibility checked",
    badge: "review",
  },
  { stage: "blocked", heading: "Blocked", badge: "closed" },
  { stage: "ready", heading: "Ready to publish", badge: "active" },
  { stage: "released", heading: "Released", badge: "delivered" },
];

/**
 * The last stage an app has a record for. Released means the build result
 * records what was published: `result` is first run when the build is pushed,
 * before it is published.
 */
export function stageOf(app: App): Stage {
  if (app.buildResult?.published) return "released";
  if (app.readiness) return app.readiness.ready ? "ready" : "blocked";
  if (app.visibility) return "visibility_checked";
  // A build result is only written for a draft, even one since deleted.
  if (app.draft || app.buildResult) return "drafted";
  return "to_decide";
}

/** Whether an app at this stage waits on a person to move on. */
export function waitingOnPerson(stage: Stage): boolean {
  return stage === "to_decide" || stage === "blocked";
}

/** When each of an app's records was written. */
function times(app: App): string[] {
  return [
    app.prefill?.prefilledAt,
    app.draft?.renderedAt,
    app.visibility?.assessedAt,
    app.readiness?.assessedAt,
    app.buildResult?.builtAt,
  ].filter((t): t is string => t !== undefined);
}

/** When the app's newest record was written. */
export function updatedAt(app: App): string {
  return times(app).reduce((a, b) => (b > a ? b : a), "");
}

/** One group of the overview: a stage and its apps, newest first. */
export interface Group {
  stage: Stage;
  heading: string;
  badge: string;
  apps: App[];
}

/** The apps by stage in Factory order. A stage with no apps is left out. */
export function grouped(apps: App[]): Group[] {
  const newest = [...apps].sort((a, b) =>
    updatedAt(b).localeCompare(updatedAt(a)) || a.name.localeCompare(b.name)
  );
  return STAGES
    .map((s) => ({ ...s, apps: newest.filter((a) => stageOf(a) === s.stage) }))
    .filter((g) => g.apps.length > 0);
}

/** One step of an app's timeline. */
export interface Step {
  label: string;
  /** Done; current, the last one done; or not started. */
  state: "done" | "current" | "not_started";
  at?: string;
  note?: string;
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * The six recorded steps: prefill, draft, visibility, readiness, pull request
 * and published. Build and review leave no record, so they aren't steps.
 */
export function timeline(app: App): Step[] {
  const { prefill, draft, visibility, readiness, buildResult } = app;
  const pullRequest = buildResult?.pullRequest
    ? { at: buildResult.builtAt }
    : readiness?.pullRequest
    ? { at: readiness.assessedAt }
    : undefined;
  const steps: Array<Omit<Step, "state"> & { done: boolean }> = [
    {
      label: "Prefill",
      done: !!prefill,
      at: prefill?.prefilledAt,
      note: prefill && prefill.toDecide.length > 0
        ? `${plural(prefill.toDecide.length, "thing")} to decide`
        : undefined,
    },
    {
      label: "Draft",
      done: !!draft,
      at: draft?.renderedAt,
      note: draft ? plural(draft.files.length, "file") : undefined,
    },
    {
      label: "Visibility",
      done: !!visibility,
      at: visibility?.assessedAt,
      note: visibility ? `Recommends ${visibility.recommendation}` : undefined,
    },
    {
      label: "Readiness",
      done: !!readiness,
      at: readiness?.assessedAt,
      note: readiness
        ? readiness.ready
          ? "Ready to publish"
          : plural(readiness.blockers.length, "blocker")
        : undefined,
    },
    { label: "Pull request", done: !!pullRequest, at: pullRequest?.at },
    {
      label: "Published",
      done: !!buildResult?.published,
      at: buildResult?.published ? buildResult.builtAt : undefined,
      note: buildResult?.published
        ? `${buildResult.published.version}, ${buildResult.published.visibility}`
        : undefined,
    },
  ];
  const last = steps.findLastIndex((s) => s.done);
  return steps.map(({ done, ...step }, n) => ({
    ...step,
    state: n === last ? "current" : done ? "done" : "not_started",
  }));
}
