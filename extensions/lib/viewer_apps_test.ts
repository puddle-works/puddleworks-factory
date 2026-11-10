/**
 * Tests for how the viewer reads the draft model's records into apps, which
 * group each app is in, and its timeline.
 *
 * Run with:
 *   ~/.swamp/deno/deno test -A extensions/lib/viewer_apps_test.ts
 *
 * @module
 */
import { assertEquals } from "jsr:@std/assert@1.0.19";
import {
  appsFromRecords,
  grouped,
  stageOf,
  STAGES,
  timeline,
  updatedAt,
  waitingOnPerson,
} from "./viewer_apps.ts";
import {
  allRecords,
  buildResult,
  draft,
  prefill,
  readiness,
  record,
  visibility,
} from "./viewer_fixtures.ts";

const NAME = "puddle-scanner";

/** The one app read from these records. */
function only(records: unknown[]) {
  const apps = appsFromRecords(records);
  assertEquals(apps.length, 1);
  return apps[0];
}

Deno.test("viewer apps: each record joins the app its instance name belongs to", () => {
  const app = only(allRecords(NAME));
  assertEquals(app.name, NAME);
  assertEquals(app.prefill?.name, NAME);
  assertEquals(app.draft?.name, NAME);
  assertEquals(app.visibility?.name, NAME);
  assertEquals(app.readiness?.name, NAME);
  assertEquals(app.buildResult?.name, NAME);
});

Deno.test("viewer apps: a draft named like another app's record is its own app", () => {
  const apps = appsFromRecords([
    record("draft", "foo", { ...draft("foo") }),
    record("draft", "readiness-foo", { ...draft("readiness-foo") }),
    record("readiness", "readiness-foo", { ...readiness("foo") }),
  ]);
  assertEquals(apps.map((a) => a.name).sort(), ["foo", "readiness-foo"]);
  const foo = apps.find((a) => a.name === "foo")!;
  const other = apps.find((a) => a.name === "readiness-foo")!;
  assertEquals(foo.readiness?.name, "foo");
  assertEquals(other.draft?.name, "readiness-foo");
  assertEquals(other.readiness, undefined);
});

Deno.test("viewer apps: a record without its spec's prefix, or of another spec, is left out", () => {
  const apps = appsFromRecords([
    record("visibility", NAME, { ...visibility(NAME) }),
    record("result", "result", { ok: true }),
    record("draft", NAME, { ...draft(NAME) }),
  ]);
  assertEquals(apps.length, 1);
  assertEquals(apps[0].visibility, undefined);
});

Deno.test("viewer apps: a record that fails its schema is left out, not an error", () => {
  const apps = appsFromRecords([
    record("draft", NAME, { ...draft(NAME) }),
    record("readiness", `readiness-${NAME}`, { name: NAME, ready: "yes" }),
    record("buildResult", `build-result-${NAME}`, {
      ...buildResult(NAME),
      apiVersion: "puddleworks.dev/build-result/v3",
    }),
    { name: "no-spec" },
    null,
    "text",
  ]);
  assertEquals(apps.length, 1);
  assertEquals(apps[0].readiness, undefined);
  assertEquals(apps[0].buildResult, undefined);
});

Deno.test("viewer apps: attributes stored as JSON text are read", () => {
  const app = only([{
    specName: "draft",
    name: NAME,
    version: 1,
    content: JSON.stringify(draft(NAME)),
  }]);
  assertEquals(app.draft?.name, NAME);
});

Deno.test("viewer apps: the latest version of a record wins", () => {
  const app = only([
    record("draft", NAME, { ...draft(NAME, { files: ["new.ts"] }) }, 3),
    record("draft", NAME, { ...draft(NAME, { files: ["old.ts"] }) }, 2),
  ]);
  assertEquals(app.draft?.files, ["new.ts"]);
});

const LATER = "2026-10-25T09:00:00.000Z";
const LATEST = "2026-10-26T09:00:00.000Z";
const PUBLISHED = {
  published: { version: "2026.10.24.1", visibility: "public" as const },
};

Deno.test("viewer apps: an app is placed by its newest record, not its furthest", () => {
  const redraft = record("draft", NAME, draft(NAME, { renderedAt: LATER }));
  const checked = record("visibility", `visibility-${NAME}`, visibility(NAME));
  const passed = record("readiness", `readiness-${NAME}`, readiness(NAME));
  const blocked = record(
    "readiness",
    `readiness-${NAME}`,
    readiness(NAME, { ready: false, blockers: ["AC1 has no test"] }),
  );
  const released = record(
    "buildResult",
    `build-result-${NAME}`,
    buildResult(NAME, PUBLISHED),
  );
  const cases: Array<[string, unknown[], string]> = [
    ["drafted again after readiness", [redraft, passed], "implement"],
    ["drafted again after visibility", [redraft, checked], "implement"],
    ["drafted again after being blocked", [redraft, blocked], "implement"],
    [
      "drafted again after all the checks",
      [redraft, checked, passed],
      "implement",
    ],
    ["drafted again after release", [redraft, released], "implement"],
    [
      "checked again after the new draft",
      [
        redraft,
        record(
          "visibility",
          `visibility-${NAME}`,
          visibility(NAME, { assessedAt: LATEST }),
        ),
        passed,
      ],
      "visibility",
    ],
    [
      "ready again after the new draft",
      [
        redraft,
        checked,
        record(
          "readiness",
          `readiness-${NAME}`,
          readiness(NAME, { assessedAt: LATEST }),
        ),
      ],
      "publish",
    ],
    [
      "released again after the new draft",
      [
        redraft,
        record(
          "buildResult",
          `build-result-${NAME}`,
          buildResult(NAME, { ...PUBLISHED, builtAt: LATEST }),
        ),
      ],
      "record",
    ],
    [
      "visibility checked again after readiness",
      [
        record("draft", NAME, draft(NAME)),
        record(
          "visibility",
          `visibility-${NAME}`,
          visibility(NAME, { assessedAt: LATER }),
        ),
        passed,
      ],
      "visibility",
    ],
    [
      "visibility checked again after release",
      [
        record("draft", NAME, draft(NAME)),
        record(
          "visibility",
          `visibility-${NAME}`,
          visibility(NAME, { assessedAt: LATER }),
        ),
        released,
      ],
      "record",
    ],
    [
      "records written at the same moment, in Factory order",
      [
        record("draft", NAME, draft(NAME, { renderedAt: LATER })),
        record(
          "visibility",
          `visibility-${NAME}`,
          visibility(NAME, { assessedAt: LATER }),
        ),
        record(
          "readiness",
          `readiness-${NAME}`,
          readiness(NAME, { assessedAt: LATER }),
        ),
      ],
      "publish",
    ],
  ];
  for (const [label, records, stage] of cases) {
    assertEquals(stageOf(only(records)), stage, label);
  }
});

Deno.test("viewer apps: a new draft is the current step, and the timeline keeps every record", () => {
  const steps = timeline(only([
    ...allRecords(NAME).filter((r) => r.specName !== "draft"),
    record("draft", NAME, draft(NAME, { renderedAt: LATEST })),
  ]));
  assertEquals(steps.map((s) => [s.label, s.state]), [
    ["Prefill", "done"],
    ["Draft", "current"],
    ["Visibility", "done"],
    ["Readiness", "done"],
    ["Pull request", "done"],
    ["Published", "not_started"],
  ]);
  assertEquals(steps[2].at, visibility(NAME).assessedAt);
  assertEquals(steps[3].at, readiness(NAME).assessedAt);
});

Deno.test("viewer apps: each combination of records is in the right stage", () => {
  const cases: Array<[string, unknown[], string]> = [
    [
      "prefill only",
      [record("prefill", `prefill-${NAME}`, prefill(NAME))],
      "agree",
    ],
    [
      "prefill with nothing left to decide",
      [record("prefill", `prefill-${NAME}`, prefill(NAME, { toDecide: [] }))],
      "agree",
    ],
    ["draft only", [record("draft", NAME, draft(NAME))], "implement"],
    [
      "prefill and draft",
      [
        record("prefill", `prefill-${NAME}`, prefill(NAME)),
        record("draft", NAME, draft(NAME)),
      ],
      "implement",
    ],
    [
      "visibility",
      [
        record("draft", NAME, draft(NAME)),
        record("visibility", `visibility-${NAME}`, visibility(NAME)),
      ],
      "visibility",
    ],
    [
      "readiness with blockers",
      [
        record("draft", NAME, draft(NAME)),
        record(
          "readiness",
          `readiness-${NAME}`,
          readiness(NAME, { ready: false, blockers: ["AC1 has no test"] }),
        ),
      ],
      "review",
    ],
    [
      "readiness passed",
      [
        record("draft", NAME, draft(NAME)),
        record("readiness", `readiness-${NAME}`, readiness(NAME)),
      ],
      "publish",
    ],
    [
      "a build result that isn't published",
      [
        record("draft", NAME, draft(NAME)),
        record("readiness", `readiness-${NAME}`, readiness(NAME)),
        record("buildResult", `build-result-${NAME}`, buildResult(NAME)),
      ],
      "publish",
    ],
    [
      "a published build result",
      [
        record("draft", NAME, draft(NAME)),
        record(
          "buildResult",
          `build-result-${NAME}`,
          buildResult(NAME, {
            published: { version: "2026.10.24.1", visibility: "public" },
          }),
        ),
      ],
      "record",
    ],
    [
      "an unpublished build result and nothing else",
      [record("buildResult", `build-result-${NAME}`, buildResult(NAME))],
      "implement",
    ],
  ];
  for (const [label, records, stage] of cases) {
    assertEquals(stageOf(only(records)), stage, label);
  }
});

// A blocked readiness check is the builder's to fix; publishing needs a person.
Deno.test("viewer apps: agreeing and publishing are waiting on a person", () => {
  for (const { stage } of STAGES) {
    assertEquals(
      waitingOnPerson(stage),
      stage === "agree" || stage === "publish",
      stage,
    );
  }
});

Deno.test("viewer apps: the groups are the plan's stages that leave a record", () => {
  assertEquals(STAGES.map((s) => s.heading), [
    "Agree and select target",
    "Generate and implement",
    "Decide visibility",
    "Independent review",
    "PR and publication",
    "Record",
  ]);
});

Deno.test("viewer apps: an app is updated at its newest record", () => {
  const app = only([
    record("prefill", `prefill-${NAME}`, prefill(NAME)),
    record("draft", NAME, draft(NAME)),
  ]);
  assertEquals(updatedAt(app), "2026-10-21T09:00:00.000Z");
});

Deno.test("viewer apps: groups come in Factory order, newest first, and empty ones are left out", () => {
  const apps = appsFromRecords([
    record("draft", "old", draft("old")),
    record(
      "draft",
      "new",
      draft("new", { renderedAt: "2026-10-25T09:00:00.000Z" }),
    ),
    record("prefill", "prefill-idea", prefill("idea")),
    record("draft", "done", draft("done")),
    record(
      "buildResult",
      "build-result-done",
      buildResult("done", {
        published: { version: "1", visibility: "private" },
      }),
    ),
  ]);
  const groups = grouped(apps);
  assertEquals(groups.map((g) => g.stage), [
    "agree",
    "implement",
    "record",
  ]);
  assertEquals(groups[1].apps.map((a) => a.name), ["new", "old"]);
  assertEquals(groups[0].heading, "Agree and select target");
});

Deno.test("viewer apps: the timeline shows every stage, done up to the last record", () => {
  const steps = timeline(only([
    record("draft", NAME, draft(NAME)),
    record("visibility", `visibility-${NAME}`, visibility(NAME)),
  ]));
  assertEquals(steps.map((s) => s.label), [
    "Prefill",
    "Draft",
    "Visibility",
    "Readiness",
    "Pull request",
    "Published",
  ]);
  assertEquals(steps.map((s) => s.state), [
    "not_started",
    "done",
    "current",
    "not_started",
    "not_started",
    "not_started",
  ]);
  assertEquals(steps[1].at, "2026-10-21T09:00:00.000Z");
  assertEquals(steps[0].at, undefined);
});

Deno.test("viewer apps: a released app's timeline ends at Published", () => {
  const records = allRecords(NAME);
  records[4] = record(
    "buildResult",
    `build-result-${NAME}`,
    buildResult(NAME, {
      published: { version: "2026.10.24.1", visibility: "public" },
    }),
  );
  const steps = timeline(only(records));
  assertEquals(steps.map((s) => s.state), [
    "done",
    "done",
    "done",
    "done",
    "done",
    "current",
  ]);
});

Deno.test("viewer apps: no records at all gives no apps", () => {
  assertEquals(appsFromRecords([]), []);
  assertEquals(grouped([]), []);
});
