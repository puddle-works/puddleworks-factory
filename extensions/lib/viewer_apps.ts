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
import type { BuildResult } from "../contracts/build_result_v1.ts";
import {
  AnyBuildResultSchema,
  type BuildResultV2,
} from "../contracts/build_result_v2.ts";
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
  buildResult?: BuildResult | BuildResultV2;
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
    schema: AnyBuildResultSchema,
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

/**
 * Where an app is: the stages of docs/factory-quality-and-gates-plan.md that
 * leave a record. Intake and Validate leave none, so no app is shown at them.
 */
export type Stage =
  | "agree"
  | "implement"
  | "visibility"
  | "review"
  | "publish"
  | "record";

/**
 * The stages in Factory order: the overview's heading, and the label and badge
 * a card shows for what its records say.
 */
export const STAGES: ReadonlyArray<
  { stage: Stage; heading: string; label: string; badge: string }
> = [
  {
    stage: "agree",
    heading: "Agree and select target",
    label: "To decide",
    badge: "review",
  },
  {
    stage: "implement",
    heading: "Generate and implement",
    label: "Drafted",
    badge: "draft",
  },
  {
    stage: "visibility",
    heading: "Decide visibility",
    label: "Visibility checked",
    badge: "review",
  },
  {
    stage: "review",
    heading: "Independent review",
    label: "Blocked",
    badge: "closed",
  },
  {
    stage: "publish",
    heading: "PR and publication",
    label: "Ready to publish",
    badge: "active",
  },
  {
    stage: "record",
    heading: "Record",
    label: "Published",
    badge: "delivered",
  },
];

/**
 * The stage an app's records put it at, in Factory order. A record older than
 * the newest draft is about code since replaced, so it doesn't count, and a
 * readiness check older than the visibility check is out of date too. A later
 * check doesn't undo a release: what was published stays published until a new
 * draft starts again. Record means the build result records what was
 * published: `result` is first run when the build is pushed, before it is
 * published.
 */
export function stageOf(app: App): Stage {
  const drafted = app.draft?.renderedAt ?? "";
  const { buildResult, readiness } = app;
  if (buildResult?.published && buildResult.builtAt >= drafted) {
    return "record";
  }
  const visibility = app.visibility && app.visibility.assessedAt >= drafted
    ? app.visibility
    : undefined;
  if (
    readiness && readiness.assessedAt >= (visibility?.assessedAt ?? drafted)
  ) {
    return readiness.ready ? "publish" : "review";
  }
  if (visibility) return "visibility";
  // A build result is only written for a draft, even one since deleted.
  if (app.draft || app.buildResult) return "implement";
  return "agree";
}

/**
 * Whether an app at this stage waits on a person to move on: to agree the
 * spec, or to confirm publishing. A blocked readiness check is the builder's
 * to fix and run again.
 */
export function waitingOnPerson(stage: Stage): boolean {
  return stage === "agree" || stage === "publish";
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
  /** Done; current, the one done most recently; or not started. */
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
  // By time, not position: a new draft is current even with later steps done.
  const latest = steps.reduce(
    (best, s, n) =>
      s.done && (best < 0 || (s.at ?? "") >= (steps[best].at ?? "")) ? n : best,
    -1,
  );
  return steps.map(({ done, ...step }, n) => ({
    ...step,
    state: n === latest ? "current" : done ? "done" : "not_started",
  }));
}
