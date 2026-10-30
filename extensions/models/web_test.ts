/**
 * Tests for the web model: its settings, the serve method's port, and that
 * it reads the draft behavior it is set to.
 *
 * Run with:
 *   ~/.swamp/deno/deno test -A extensions/models/web_test.ts
 *
 * @module
 */
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { model } from "./web.ts";
import { model as draftModel } from "./draft.ts";
import { DRAFT_TYPE, predicate } from "../lib/viewer_serve.ts";

Deno.test("web model: the type, its version and one method", () => {
  assertEquals(model.type, "@puddleworks/puddleworks-factory/web");
  assertEquals(model.version, "2026.10.29.1");
  assertEquals(Object.keys(model.methods), ["serve"]);
});

Deno.test("web model: it shows the draft behavior named puddleworks-factory by default", () => {
  assertEquals(model.globalArguments.parse({}), {
    draft: "puddleworks-factory",
  });
  assertEquals(model.globalArguments.parse({ draft: "other" }), {
    draft: "other",
  });
  assertEquals(model.globalArguments.safeParse({ draft: "" }).success, false);
});

Deno.test("web model: it reads the draft model's type", () => {
  assertEquals(DRAFT_TYPE, draftModel.type);
});

Deno.test("web model: serve picks a free port unless given one", () => {
  const args = model.methods.serve.arguments;
  assertEquals(args.parse({}), { port: 0 });
  assertEquals(args.parse({ port: "3003" }), { port: 3003 });
  assertEquals(args.safeParse({ port: 70000 }).success, false);
});

Deno.test("web model: serve reads the draft behavior it is set to, until aborted", async () => {
  const asked: string[] = [];
  const abort = new AbortController();
  const listening = Promise.withResolvers<number>();
  const running = model.methods.serve.execute({ port: 0 }, {
    globalArgs: { draft: "my-factory" },
    queryData: (p: string) => {
      asked.push(p);
      return Promise.resolve([]);
    },
    logger: {
      info: (_msg: string, props?: Record<string, unknown>) =>
        listening.resolve(props?.port as number),
    },
    signal: abort.signal,
  });
  const port = await listening.promise;
  const res = await fetch(`http://127.0.0.1:${port}/`);
  assertStringIncludes(await res.text(), "No apps yet.");
  abort.abort();
  assertEquals(await running, { dataHandles: [] });
  assertEquals(asked, [predicate("my-factory")]);
});
