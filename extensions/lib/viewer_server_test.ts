/**
 * Tests for the viewer's HTTP handler: read-only, local only, HTML only, and
 * strict about who may call it, as Capture's viewer is.
 *
 * Run with:
 *   ~/.swamp/deno/deno test -A extensions/lib/viewer_server_test.ts
 *
 * @module
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "jsr:@std/assert@1.0.19";
import { VIEWER_ASSETS } from "./viewer_assets.ts";
import { handleViewerRequest, type ViewerDeps } from "./viewer_server.ts";

const PORT = 4321;
const BASE = `http://127.0.0.1:${PORT}`;

function deps(extra: Partial<ViewerDeps> = {}): ViewerDeps {
  return {
    port: PORT,
    assets: VIEWER_ASSETS,
    overview: () => "<!doctype html><title>Apps</title>",
    app: (name) =>
      name === "puddle-scanner"
        ? "<!doctype html><title>puddle-scanner</title>"
        : undefined,
    events: { subscribe: () => () => {} },
    ...extra,
  };
}

function get(
  path: string,
  headers: Record<string, string> = {},
  method = "GET",
) {
  return new Request(`${BASE}${path}`, {
    method,
    headers: { host: `127.0.0.1:${PORT}`, ...headers },
  });
}

const handle = async (req: Request, d = deps()) =>
  await handleViewerRequest(req, d);

Deno.test("viewer server: the overview and each app are HTML", async () => {
  for (
    const [path, title] of [["/", "Apps"], [
      "/apps/puddle-scanner",
      "puddle-scanner",
    ]]
  ) {
    const res = await handle(get(path));
    assertEquals(res.status, 200, path);
    assertEquals(res.headers.get("content-type"), "text/html; charset=utf-8");
    assertStringIncludes(await res.text(), `<title>${title}</title>`);
  }
});

Deno.test("viewer server: an unknown app or page is a not found page", async () => {
  for (const path of ["/apps/nope", "/apps/", "/nope", "/apps/a/b"]) {
    const res = await handle(get(path));
    assertEquals(res.status, 404, path);
    assertEquals(res.headers.get("content-type"), "text/html; charset=utf-8");
    assertStringIncludes(await res.text(), "<h1>Not found</h1>");
  }
});

Deno.test("viewer server: serves the stylesheet, icon and script", async () => {
  const css = await handle(get("/web.css"));
  assertEquals(css.headers.get("content-type"), "text/css; charset=utf-8");
  assertStringIncludes(await css.text(), "--color-accent");
  const icon = await handle(get("/favicon.svg"));
  assertEquals(icon.headers.get("content-type"), "image/svg+xml");
  await icon.body?.cancel();
  const js = await handle(get("/reload.js"));
  assertEquals(
    js.headers.get("content-type"),
    "text/javascript; charset=utf-8",
  );
  assertStringIncludes(await js.text(), "EventSource");
});

Deno.test("viewer server: there is no JSON API, and nothing answers in JSON", async () => {
  const paths = [
    "/",
    "/apps/puddle-scanner",
    "/api/apps",
    "/api/apps/puddle-scanner",
    "/web.css",
    "/x",
    "/%zz",
  ];
  for (const path of paths) {
    const res = await handle(get(path, { accept: "application/json" }));
    assert(
      !res.headers.get("content-type")?.includes("json"),
      `${path} answers ${res.headers.get("content-type")}`,
    );
    await res.body?.cancel();
  }
  assertEquals((await handle(get("/api/apps"))).status, 404);
});

Deno.test("viewer server: every response carries the CSP and CORP", async () => {
  const requests = [
    get("/"),
    get("/web.css"),
    get("/nope"),
    get("/", {}, "POST"),
    get("/", { host: "evil.example" }),
  ];
  for (const req of requests) {
    const res = await handle(req);
    assertEquals(
      res.headers.get("content-security-policy"),
      "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    assertEquals(
      res.headers.get("cross-origin-resource-policy"),
      "same-origin",
    );
    assertEquals(res.headers.get("x-content-type-options"), "nosniff");
    assertEquals(res.headers.get("access-control-allow-origin"), null);
    await res.body?.cancel();
  }
});

Deno.test("viewer server: it only reads", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
    const res = await handle(get("/", {}, method));
    assertEquals(res.status, 405, method);
    assertEquals(res.headers.get("allow"), "GET");
    assertEquals(res.headers.get("content-type"), "text/plain; charset=utf-8");
    await res.body?.cancel();
  }
});

Deno.test("viewer server: refuses another Host, another Origin and another site", async () => {
  const refused = [
    get("/", { host: "evil.example" }),
    get("/", { host: `127.0.0.1:${PORT + 1}` }),
    get("/", { origin: "http://evil.example" }),
    get("/web.css", { "sec-fetch-site": "cross-site" }),
    get("/events", { "sec-fetch-site": "same-site" }),
  ];
  for (const req of refused) {
    const res = await handle(req);
    assertEquals(res.status, 403, `${req.url} ${[...req.headers]}`);
    assertEquals(res.headers.get("content-type"), "text/plain; charset=utf-8");
    await res.body?.cancel();
  }
  for (
    const headers of <Record<string, string>[]> [
      { host: `localhost:${PORT}` },
      { origin: BASE },
      { "sec-fetch-site": "same-origin" },
      { "sec-fetch-site": "none" },
    ]
  ) {
    const res = await handle(get("/", headers));
    assertEquals(res.status, 200, JSON.stringify(headers));
    await res.body?.cancel();
  }
});

Deno.test("viewer server: a person may open a page from a link elsewhere, but nothing else", async () => {
  const link = {
    "sec-fetch-site": "cross-site",
    "sec-fetch-mode": "navigate",
    "sec-fetch-dest": "document",
  };
  assertEquals((await handle(get("/apps/puddle-scanner", link))).status, 200);
  assertEquals((await handle(get("/", link))).status, 200);
  for (const path of ["/web.css", "/reload.js", "/events"]) {
    const res = await handle(get(path, link));
    assertEquals(res.status, 403, path);
    await res.body?.cancel();
  }
});

Deno.test("viewer server: the event stream only ever says changed", async () => {
  let send: () => void = () => {};
  let unsubscribed = false;
  const abort = new AbortController();
  const res = await handle(
    get("/events"),
    deps({
      signal: abort.signal,
      events: {
        subscribe: (listener) => {
          send = listener;
          return () => (unsubscribed = true);
        },
      },
    }),
  );
  assertEquals(
    res.headers.get("content-type"),
    "text/event-stream; charset=utf-8",
  );
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  assertStringIncludes(
    decoder.decode((await reader.read()).value),
    ": connected",
  );
  send();
  assertEquals(
    decoder.decode((await reader.read()).value),
    "data: changed\n\n",
  );
  abort.abort();
  assertEquals((await reader.read()).done, true);
  assert(unsubscribed);
});
