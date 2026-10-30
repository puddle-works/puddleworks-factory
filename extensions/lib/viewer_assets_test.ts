/**
 * Tests for the viewer's files: the stylesheet covers the pages, and the
 * script only reloads.
 *
 * Run with:
 *   ~/.swamp/deno/deno test -A extensions/lib/viewer_assets_test.ts
 *
 * @module
 */
import { assert, assertEquals } from "jsr:@std/assert@1.0.19";
import { VIEWER_ASSETS } from "./viewer_assets.ts";
import { appsFromRecords } from "./viewer_apps.ts";
import { appPage, notFoundPage, overviewPage } from "./viewer_html.ts";
import { allRecords, draft, prefill, record } from "./viewer_fixtures.ts";

const READ_AT = "2026-10-29T12:00:00.000Z";

Deno.test("viewer assets: the stylesheet has a rule for every class the pages use", () => {
  const apps = appsFromRecords([
    ...allRecords("full"),
    record("prefill", "prefill-idea", prefill("idea")),
    ...Array.from(
      { length: 6 },
      (_, n) => record("draft", `d-${n}`, draft(`d-${n}`)),
    ),
  ]);
  const pages = [
    overviewPage(apps, READ_AT),
    overviewPage([], READ_AT),
    ...apps.map((a) => appPage(a, READ_AT)),
    notFoundPage(),
  ].join("\n");
  const used = new Set(
    [...pages.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(" ")),
  );
  const css = VIEWER_ASSETS["web.css"].text;
  const missing = [...used].filter((c) => !css.includes(`.${c}`));
  assertEquals(missing, []);
});

Deno.test("viewer assets: the script only reloads when told something changed", () => {
  const js = VIEWER_ASSETS["reload.js"];
  assertEquals(js.type, "text/javascript; charset=utf-8");
  assert(js.text.includes('new EventSource("/events")'));
  assert(js.text.includes("location.reload()"));
  assert(!/fetch|XMLHttpRequest|innerHTML/.test(js.text));
});

Deno.test("viewer assets: each file has its type", () => {
  assertEquals(
    Object.keys(VIEWER_ASSETS).sort(),
    ["favicon.svg", "reload.js", "web.css"],
  );
  assertEquals(VIEWER_ASSETS["web.css"].type, "text/css; charset=utf-8");
  assertEquals(VIEWER_ASSETS["favicon.svg"].type, "image/svg+xml");
});
