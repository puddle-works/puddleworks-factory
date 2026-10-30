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
      apiVersion: "puddleworks.dev/build-result/v2",
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

Deno.test("viewer apps: each combination of records is in the right stage", () => {
  const cases: Array<[string, unknown[], string]> = [
    [
      "prefill only",
      [record("prefill", `prefill-${NAME}`, prefill(NAME))],
      "to_decide",
    ],
    [
      "prefill with nothing left to decide",
      [record("prefill", `prefill-${NAME}`, prefill(NAME, { toDecide: [] }))],
      "to_decide",
    ],
    ["draft only", [record("draft", NAME, draft(NAME))], "drafted"],
    [
      "prefill and draft",
      [
        record("prefill", `prefill-${NAME}`, prefill(NAME)),
        record("draft", NAME, draft(NAME)),
      ],
      "drafted",
    ],
    [
      "visibility",
      [
        record("draft", NAME, draft(NAME)),
        record("visibility", `visibility-${NAME}`, visibility(NAME)),
      ],
      "visibility_checked",
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
      "blocked",
    ],
    [
      "readiness passed",
      [
        record("draft", NAME, draft(NAME)),
        record("readiness", `readiness-${NAME}`, readiness(NAME)),
      ],
      "ready",
    ],
    [
      "a build result that isn't published",
      [
        record("draft", NAME, draft(NAME)),
        record("readiness", `readiness-${NAME}`, readiness(NAME)),
        record("buildResult", `build-result-${NAME}`, buildResult(NAME)),
      ],
      "ready",
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
      "released",
    ],
    [
      "an unpublished build result and nothing else",
      [record("buildResult", `build-result-${NAME}`, buildResult(NAME))],
      "drafted",
    ],
  ];
  for (const [label, records, stage] of cases) {
    assertEquals(stageOf(only(records)), stage, label);
  }
});

Deno.test("viewer apps: to decide and blocked are waiting on a person", () => {
  assertEquals(waitingOnPerson("to_decide"), true);
  assertEquals(waitingOnPerson("blocked"), true);
  assertEquals(waitingOnPerson("drafted"), false);
  assertEquals(waitingOnPerson("ready"), false);
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
    "to_decide",
    "drafted",
    "released",
  ]);
  assertEquals(groups[1].apps.map((a) => a.name), ["new", "old"]);
  assertEquals(groups[0].heading, "To decide");
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
