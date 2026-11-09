/**
 * Tests for running the viewer: one data query for the draft behavior's
 * records, served on 127.0.0.1, and a change event when they change.
 *
 * Run with:
 *   ~/.swamp/deno/deno test -A extensions/lib/viewer_serve_test.ts
 *
 * @module
 */
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "jsr:@std/assert@1.0.19";
import { predicate, serveViewer } from "./viewer_serve.ts";
import { draft, prefill, record } from "./viewer_fixtures.ts";

Deno.test("viewer serve: reads the named draft behavior's records that aren't deleted", () => {
  assertEquals(
    predicate("puddleworks-factory"),
    'modelType == "@puddleworks/puddleworks-factory/draft" && modelName == "puddleworks-factory" && lifecycle != "deleted"',
  );
});

Deno.test("viewer serve: a name that would change the query is refused", () => {
  for (const name of ['x" || true || "', "", "-x", "a b"]) {
    assertThrows(() => predicate(name), Error, "isn't a behavior name");
  }
});

Deno.test("viewer serve: without a data query it says why", async () => {
  await assertRejects(
    () =>
      serveViewer({ logger: { info: () => {}, warning: () => {} } }, {
        port: 0,
        draft: "puddleworks-factory",
      }),
    Error,
    "data query",
  );
});

Deno.test("viewer serve: serves the pages and says when the data changed", async () => {
  let records: unknown[] = [record("prefill", "prefill-idea", prefill("idea"))];
  const asked: string[] = [];
  const abort = new AbortController();
  const listening = Promise.withResolvers<number>();
  const logged: string[] = [];
  const running = serveViewer({
    queryData: (p) => {
      asked.push(p);
      return Promise.resolve(records);
    },
    logger: { info: (msg) => logged.push(msg), warning: () => {} },
    signal: abort.signal,
  }, {
    port: 0,
    draft: "puddleworks-factory",
    pollSeconds: 0.02,
    onListen: (port) => listening.resolve(port),
  });
  const port = await listening.promise;
  const base = `http://127.0.0.1:${port}`;
  assertEquals(logged, ["Factory viewer: http://127.0.0.1:{port}/"]);
  assertEquals(new Set(asked), new Set([predicate("puddleworks-factory")]));

  const overview = await (await fetch(`${base}/`)).text();
  assertStringIncludes(overview, ">Agree and select target</h2>");
  assertStringIncludes(overview, 'href="/apps/idea"');
  const one = await fetch(`${base}/apps/idea`);
  assertEquals(one.status, 200);
  await one.body?.cancel();
  const none = await fetch(`${base}/apps/nope`);
  assertEquals(none.status, 404);
  await none.body?.cancel();

  const events = await fetch(`${base}/events`);
  const reader = events.body!.getReader();
  const decoder = new TextDecoder();
  assertStringIncludes(
    decoder.decode((await reader.read()).value),
    ": connected",
  );
  records = [...records, record("draft", "idea", draft("idea"), 2)];
  assertEquals(
    decoder.decode((await reader.read()).value),
    "data: changed\n\n",
  );
  const after = await (await fetch(`${base}/`)).text();
  assertStringIncludes(after, ">Generate and implement</h2>");

  // The stream's own close on abort is covered in viewer_server_test.
  await reader.cancel();
  abort.abort();
  assertEquals(await running, { dataHandles: [] });
});

Deno.test("viewer serve: says when the records keep failing to read, and when they read again", async () => {
  let failing = false;
  const abort = new AbortController();
  const logged: string[] = [];
  const recovered = Promise.withResolvers<void>();
  const failed = Promise.withResolvers<void>();
  const running = serveViewer({
    queryData: () =>
      failing
        ? Promise.reject(new Error("datastore locked"))
        : Promise.resolve([]),
    logger: {
      info: (msg) => {
        logged.push(`info ${msg}`);
        if (/read again/i.test(msg)) recovered.resolve();
      },
      warning: (msg, props) => {
        logged.push(`warning ${msg} ${props?.error}`);
        if (/could not read/i.test(msg)) failed.resolve();
      },
    },
    signal: abort.signal,
  }, { port: 0, draft: "puddleworks-factory", pollSeconds: 0.01 });
  failing = true;
  await failed.promise;
  // Failing again is not logged again.
  await new Promise((r) => setTimeout(r, 60));
  failing = false;
  await recovered.promise;
  abort.abort();
  await running;
  const about = logged.filter((m) => /read/i.test(m));
  assertEquals(about.length, 2, JSON.stringify(logged));
  // Showing old records is degraded: a warning. Reading again is not.
  assertStringIncludes(about[0], "warning Could not read");
  assertStringIncludes(about[0], "datastore locked");
  assertStringIncludes(about[1], "info ");
});
