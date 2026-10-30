/**
 * Tests for the viewer's pages: the overview, one app, and not found. Every
 * value from swamp data is escaped, and nothing on a page changes data.
 *
 * Run with:
 *   ~/.swamp/deno/deno test -A extensions/lib/viewer_html_test.ts
 *
 * @module
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "jsr:@std/assert@1.0.19";
import { type App, appsFromRecords } from "./viewer_apps.ts";
import { appPage, notFoundPage, overviewPage } from "./viewer_html.ts";
import {
  allRecords,
  buildResult,
  draft,
  prefill,
  readiness,
  record,
  visibility,
} from "./viewer_fixtures.ts";

const READ_AT = "2026-10-29T12:00:00.000Z";
const NAME = "puddle-scanner";

function app(records: unknown[]): App {
  const apps = appsFromRecords(records);
  assertEquals(apps.length, 1);
  return apps[0];
}

/** Checks that hold for every page: no way to change data, nothing inline. */
function assertReadOnly(html: string) {
  assert(html.startsWith("<!doctype html>"));
  assert(!/<form/i.test(html), "no form");
  assert(!/<button/i.test(html), "no button");
  assert(!/<input/i.test(html), "no input");
  // Data can't open a tag (< is escaped), so every tag here is the page's own.
  const tags = html.match(/<[^>]*>/g) ?? [];
  assert(
    !tags.some((t) => /\sstyle=/i.test(t)),
    "no inline style, which the CSP blocks",
  );
  assert(
    !tags.some((t) => /\son[a-z]+=/i.test(t)),
    "no inline event handler",
  );
  assertEquals(
    [...html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]),
    ['<script src="/reload.js" defer>'],
  );
  assertStringIncludes(html, '<link rel="stylesheet" href="/web.css">');
  assertStringIncludes(html, "Read-only");
  assertStringIncludes(html, "Factory");
}

Deno.test("viewer html: the overview lists the groups in Factory order", () => {
  const apps = appsFromRecords([
    record("prefill", "prefill-idea", prefill("idea")),
    record("draft", "built", draft("built")),
    record(
      "buildResult",
      "build-result-built",
      buildResult("built", {
        published: { version: "2026.10.24.1", visibility: "public" },
      }),
    ),
    record("draft", "stuck", draft("stuck")),
    record(
      "readiness",
      "readiness-stuck",
      readiness("stuck", { ready: false, blockers: ["a", "b"] }),
    ),
  ]);
  const html = overviewPage(apps, READ_AT);
  assertReadOnly(html);
  const order = ["To decide", "Blocked", "Released"].map((h) =>
    html.indexOf(`>${h}</h2>`)
  );
  assert(order.every((i) => i > 0), "every group has a heading");
  assertEquals([...order].sort((a, b) => a - b), order);
  assert(!html.includes(">Drafted</h2>"), "an empty group is left out");
  assertStringIncludes(html, 'href="/apps/idea"');
  assertStringIncludes(html, "1 thing to decide");
  assertStringIncludes(html, "2 blockers");
  assertStringIncludes(html, 'class="badge badge-delivered">Released<');
  assertStringIncludes(html, "Read ");
});

Deno.test("viewer html: apps waiting on a person are highlighted", () => {
  const apps = appsFromRecords([
    record("prefill", "prefill-idea", prefill("idea")),
    record("draft", "drafted", draft("drafted")),
  ]);
  const html = overviewPage(apps, READ_AT);
  assertStringIncludes(html, "1 app waiting on you");
  assertEquals(html.match(/class="card waiting"/g)?.length, 1);
});

Deno.test("viewer html: a group shows five apps and rolls the rest into Show all", () => {
  const records = Array.from(
    { length: 7 },
    (_, n) =>
      record(
        "draft",
        `app-${n}`,
        draft(`app-${n}`, {
          renderedAt: `2026-10-2${n}T09:00:00.000Z`,
        }),
      ),
  );
  const html = overviewPage(appsFromRecords(records), READ_AT);
  const details = html.indexOf("<details");
  assert(details > 0);
  assertStringIncludes(html, "Show all 7");
  // Newest first: the two oldest are the ones rolled up.
  assert(html.indexOf("/apps/app-0") > details);
  assert(html.indexOf("/apps/app-1") > details);
  assert(html.indexOf("/apps/app-2") < details);
});

Deno.test("viewer html: with no apps the overview says how to start one", () => {
  const html = overviewPage([], READ_AT);
  assertReadOnly(html);
  assertStringIncludes(html, "No apps yet.");
  assertStringIncludes(
    html,
    "swamp workflow run @puddleworks/puddleworks-factory-prefill",
  );
});

Deno.test("viewer html: hostile values are escaped", () => {
  const hostile = '<img src=x onerror="alert(1)">';
  const one = app([
    record("draft", `x<script>`, draft(`x<script>`, { targetDir: hostile })),
    record(
      "readiness",
      "readiness-x<script>",
      readiness("x<script>", {
        summary: `</pre>${hostile}`,
        blockers: [hostile],
      }),
    ),
  ]);
  for (const html of [appPage(one, READ_AT), overviewPage([one], READ_AT)]) {
    assertReadOnly(html);
    assert(!html.includes("<img"), "no tag from the data");
    assert(!html.includes("x<script>"), "the name is escaped");
  }
  assertStringIncludes(appPage(one, READ_AT), "x&lt;script&gt;");
  assertStringIncludes(
    overviewPage([one], READ_AT),
    'href="/apps/x%3Cscript%3E"',
  );
});

Deno.test("viewer html: only http and https addresses are linked", () => {
  const one = app([
    record(
      "draft",
      NAME,
      draft(NAME, { repository: "javascript:alert(1)" }),
    ),
    record(
      "readiness",
      `readiness-${NAME}`,
      readiness(NAME, { pullRequest: "javascript:alert(2)" }),
    ),
  ]);
  const html = appPage(one, READ_AT);
  assert(!/href="javascript:/i.test(html));
  assertStringIncludes(html, "javascript:alert(1)");
});

Deno.test("viewer html: an app page shows each record in order", () => {
  const html = appPage(app(allRecords(NAME)), READ_AT);
  assertReadOnly(html);
  assertStringIncludes(html, `<h1>${NAME}</h1>`);
  assertStringIncludes(html, 'class="back-link" href="/"');
  const order = [
    "Stages",
    "Prefill",
    "Draft",
    "Visibility",
    "Readiness",
    "Build result",
  ].map((h) => html.indexOf(`>${h}</h2>`));
  assert(order.every((i) => i > 0), "every section has a heading");
  assertEquals([...order].sort((a, b) => a - b), order);
  assertStringIncludes(html, 'href="https://capture.example/requests/12"');
  assertStringIncludes(html, "delivery.method: pick how it is run");
  assertStringIncludes(html, `extensions/models/${NAME}.ts`);
  assertStringIncludes(html, "Scored 80%");
  assertStringIncludes(html, "README.md:3");
  assertStringIncludes(html, "Lists open tasks");
  assertStringIncludes(html, "extensions/models/app_test.ts: lists open tasks");
  assertStringIncludes(html, `<pre class="summary">Publish ${NAME}?</pre>`);
  assertStringIncludes(
    html,
    `href="https://github.com/example/${NAME}/pull/1" rel="noopener noreferrer"`,
  );
  assertStringIncludes(html, `href="https://github.com/example/${NAME}"`);
  assertStringIncludes(html, '<ol class="timeline">');
  assertStringIncludes(html, '<li class="current">');
});

Deno.test("viewer html: the package is linked only once it is published", () => {
  const unpublished = appPage(app(allRecords(NAME)), READ_AT);
  assert(!unpublished.includes("swamp-club.com/extensions"));
  const records = allRecords(NAME);
  records[4] = record(
    "buildResult",
    `build-result-${NAME}`,
    buildResult(NAME, {
      published: { version: "2026.10.24.1", visibility: "public" },
    }),
  );
  const published = appPage(app(records), READ_AT);
  assertStringIncludes(
    published,
    `href="https://swamp-club.com/extensions/@puddleworks/${NAME}"`,
  );
});

Deno.test("viewer html: a record not written yet shows as not started", () => {
  const html = appPage(
    app([record("draft", NAME, draft(NAME))]),
    READ_AT,
  );
  assertEquals(html.match(/<p class="empty">Not started\.<\/p>/g)?.length, 4);
});

Deno.test("viewer html: not found links back to every app", () => {
  const html = notFoundPage();
  assertReadOnly(html);
  assertStringIncludes(html, "<h1>Not found</h1>");
  assertStringIncludes(html, 'href="/"');
});

// Records written before 2026.10.30.1 may hold whole lines and URLs as passed.
Deno.test("viewer html: secrets in older records are not shown", () => {
  const token = ["ghp_", "h".repeat(36)].join("");
  const one = app([
    record(
      "prefill",
      `prefill-${NAME}`,
      prefill(NAME, {
        specSource: "https://bot:pw1@specs.acme.io/a.json?token=SEKRET_S",
      }),
    ),
    record(
      "draft",
      NAME,
      draft(NAME, {
        repository: "https://x-access-token:pw2@github.com/acme/app",
      }),
    ),
    record(
      "visibility",
      `visibility-${NAME}`,
      visibility(NAME, {
        checks: [{
          id: "repository",
          role: "required",
          ok: true,
          detail: `repository: https://x:${token}@github.com/acme/app`,
        }],
        findings: [{
          file: "x.env",
          line: 1,
          kind: "email",
          text: "DB=postgres://app:pw3@db.corp.internal/x bob@acme.io",
        }],
      }),
    ),
    record(
      "readiness",
      `readiness-${NAME}`,
      readiness(NAME, {
        pullRequest: "https://github.com/acme/app/pull/1?token=SEKRET_R",
        summary: "PR: https://github.com/acme/app/pull/1?token=SEKRET_R",
      }),
    ),
  ]);
  const html = appPage(one, READ_AT);
  for (
    const s of ["pw1", "SEKRET_S", "pw2", token, "pw3", "SEKRET_R", "bob@"]
  ) {
    assertEquals(html.includes(s), false, s);
  }
  assertStringIncludes(html, "https://specs.acme.io/a.json");
  assertStringIncludes(html, "…@acme.io");
});
