/**
 * Tests for reading an app spec from wherever it is: a file, an https URL or
 * inline JSON.
 *
 * Run with:
 *   ~/.swamp/deno/deno test -A extensions/lib/spec_source_test.ts
 *
 * @module
 */
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert@1.0.19";
import { stringify as toYaml } from "jsr:@std/yaml@1.0.12";
import { loadAppSpec, loadOutcomeSpec, type SpecIo } from "./spec_source.ts";

const EXAMPLE_TEXT = await Deno.readTextFile(
  new URL("../../docs/contracts/app-spec.v1.example.json", import.meta.url),
);
const EXAMPLE = JSON.parse(EXAMPLE_TEXT);

const OUTCOME_TEXT = await Deno.readTextFile(
  new URL("../../docs/contracts/outcome-spec.v1.example.json", import.meta.url),
);

/** No file system and no network unless a test gives them. */
function io(overrides: Partial<SpecIo> = {}): SpecIo {
  return {
    readTextFile: () => Promise.reject(new Error("unexpected file read")),
    fetch: () => Promise.reject(new Error("unexpected fetch")),
    ...overrides,
  };
}

Deno.test("spec source: inline JSON is read as it is", async () => {
  const { spec, source } = await loadAppSpec(EXAMPLE_TEXT, io());
  assertEquals(spec, EXAMPLE);
  assertEquals(source, "inline");
});

Deno.test("spec source: inline JSON may have leading whitespace", async () => {
  const { spec } = await loadAppSpec(`\n  ${EXAMPLE_TEXT}`, io());
  assertEquals(spec.name, "obsidian-puddle-scanner");
});

Deno.test("spec source: a path is read from disk", async () => {
  const dir = await Deno.makeTempDir({ prefix: "factory-spec-" });
  try {
    const path = `${dir}/spec.json`;
    await Deno.writeTextFile(path, EXAMPLE_TEXT);
    const { spec, source } = await loadAppSpec(
      path,
      io({ readTextFile: Deno.readTextFile }),
    );
    assertEquals(spec, EXAMPLE);
    assertEquals(source, path);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("spec source: a YAML file is read too", async () => {
  const { spec } = await loadAppSpec(
    "/specs/scanner.yaml",
    io({ readTextFile: () => Promise.resolve(toYaml(EXAMPLE)) }),
  );
  assertEquals(spec, EXAMPLE);
});

Deno.test("spec source: a missing file is named", async () => {
  await assertRejects(
    () =>
      loadAppSpec(
        "/nowhere/spec.json",
        io({ readTextFile: Deno.readTextFile }),
      ),
    Error,
    "/nowhere/spec.json",
  );
});

Deno.test("spec source: an https URL is fetched", async () => {
  const fetched: string[] = [];
  const url = "https://example.com/specs/scanner.json";
  const { spec, source } = await loadAppSpec(
    url,
    io({
      fetch: (u) => {
        fetched.push(u);
        return Promise.resolve(new Response(EXAMPLE_TEXT));
      },
    }),
  );
  assertEquals(fetched, [url]);
  assertEquals(spec, EXAMPLE);
  assertEquals(source, url);
});

Deno.test("spec source: a failed fetch names the URL and the status", async () => {
  const url = "https://example.com/specs/gone.json";
  await assertRejects(
    () =>
      loadAppSpec(
        url,
        io({
          fetch: () =>
            Promise.resolve(new Response("not found", { status: 404 })),
        }),
      ),
    Error,
    `${url} returned 404`,
  );
});

/** A fetch that answers each URL from a table, and records what it was asked. */
function routes(table: Record<string, () => Response>) {
  const fetched: string[] = [];
  const inits: Array<RequestInit | undefined> = [];
  return {
    fetched,
    inits,
    fetch: (u: string, init?: RequestInit) => {
      fetched.push(u);
      inits.push(init);
      const answer = table[u];
      return answer
        ? Promise.resolve(answer())
        : Promise.reject(new Error(`unexpected fetch of ${u}`));
    },
  };
}

const redirect = (location: string, status = 302) => () =>
  new Response(null, { status, headers: { location } });

Deno.test("spec source: a redirect to http is refused before it is requested", async () => {
  const url = "https://example.com/specs/moved.json";
  const r = routes({ [url]: redirect("http://example.com/specs/moved.json") });
  await assertRejects(
    () => loadAppSpec(url, io({ fetch: r.fetch })),
    Error,
    "redirected to http://example.com/specs/moved.json",
  );
  assertEquals(r.fetched, [url]);
});

Deno.test("spec source: redirects are not followed by fetch itself", async () => {
  const url = "https://example.com/specs/scanner.json";
  const r = routes({ [url]: () => new Response(EXAMPLE_TEXT) });
  await loadAppSpec(url, io({ fetch: r.fetch }));
  assertEquals(r.inits[0]?.redirect, "manual");
});

Deno.test("spec source: an https redirect is followed, relative or not", async () => {
  const url = "https://example.com/specs/old.json";
  const r = routes({
    [url]: redirect("/specs/v2.json", 301),
    "https://example.com/specs/v2.json": redirect(
      "https://cdn.example.org/v2.json",
      307,
    ),
    "https://cdn.example.org/v2.json": () => new Response(EXAMPLE_TEXT),
  });
  const { spec, source } = await loadAppSpec(url, io({ fetch: r.fetch }));
  assertEquals(r.fetched, [
    url,
    "https://example.com/specs/v2.json",
    "https://cdn.example.org/v2.json",
  ]);
  assertEquals(spec, EXAMPLE);
  assertEquals(source, url);
});

Deno.test("spec source: more than 5 redirects are refused", async () => {
  const table: Record<string, () => Response> = {};
  for (let i = 0; i < 10; i++) {
    table[`https://example.com/${i}`] = redirect(
      `https://example.com/${i + 1}`,
    );
  }
  const r = routes(table);
  await assertRejects(
    () => loadAppSpec("https://example.com/0", io({ fetch: r.fetch })),
    Error,
    "redirected more than 5 times",
  );
  assertEquals(r.fetched.length, 6);
});

Deno.test("spec source: the fetch has a time limit", async () => {
  const signals: Array<AbortSignal | null | undefined> = [];
  await loadAppSpec(
    "https://example.com/specs/scanner.json",
    io({
      fetch: (_u, init) => {
        signals.push(init?.signal);
        return Promise.resolve(new Response(EXAMPLE_TEXT));
      },
    }),
  );
  assertEquals(signals[0] instanceof AbortSignal, true);
});

Deno.test("spec source: a fetch that times out says so", async () => {
  const url = "https://example.com/specs/slow.json";
  await assertRejects(
    () =>
      loadAppSpec(
        url,
        io({
          fetch: () =>
            Promise.reject(
              new DOMException("Signal timed out.", "TimeoutError"),
            ),
        }),
      ),
    Error,
    `${url} did not answer within 30 seconds`,
  );
});

Deno.test("spec source: a fetched spec over 1 MB is refused", async () => {
  const url = "https://example.com/specs/huge.json";
  await assertRejects(
    () =>
      loadAppSpec(
        url,
        io({
          fetch: () => Promise.resolve(new Response("x".repeat(1_000_001))),
        }),
      ),
    Error,
    `${url} is over 1 MB`,
  );
});

Deno.test("spec source: plain http is refused without fetching", async () => {
  await assertRejects(
    () => loadAppSpec("http://example.com/spec.json", io()),
    Error,
    "https",
  );
});

Deno.test("spec source: every source gives the same spec", async () => {
  const sources = [
    loadAppSpec(EXAMPLE_TEXT, io()),
    loadAppSpec(
      "/specs/scanner.json",
      io({ readTextFile: () => Promise.resolve(EXAMPLE_TEXT) }),
    ),
    loadAppSpec(
      "https://example.com/scanner.json",
      io({ fetch: () => Promise.resolve(new Response(EXAMPLE_TEXT)) }),
    ),
  ];
  const specs = (await Promise.all(sources)).map((r) => r.spec);
  assertEquals(specs[1], specs[0]);
  assertEquals(specs[2], specs[0]);
});

Deno.test("spec source: text that is not JSON or YAML says so", async () => {
  const err = await assertRejects(
    () => loadAppSpec("{ not json", io()),
    Error,
  );
  assertStringIncludes(err.message, "inline");
  assertStringIncludes(err.message, "JSON");
});

Deno.test("spec source: a spec that breaks the contract lists every problem", async () => {
  const bad = structuredClone(EXAMPLE);
  bad.name = "Not A Slug";
  delete bad.specification.inputs[0].default;
  const err = await assertRejects(
    () => loadAppSpec(JSON.stringify(bad), io()),
    Error,
  );
  assertStringIncludes(err.message, "not a valid puddleworks.dev/app-spec/v1");
  assertStringIncludes(err.message, "name");
});

Deno.test("spec source: an outcome spec is read from the same places", async () => {
  const inline = await loadOutcomeSpec(OUTCOME_TEXT, io());
  assertEquals(inline.source, "inline");
  assertEquals(inline.spec.format, "puddleworks.dev/outcome-spec/v1");
  const file = await loadOutcomeSpec(
    "/exports/stock.json",
    io({ readTextFile: () => Promise.resolve(OUTCOME_TEXT) }),
  );
  assertEquals(file.source, "/exports/stock.json");
  assertEquals(file.spec, inline.spec);
});

Deno.test("spec source: an app spec given as an outcome spec says which format it needs", async () => {
  const err = await assertRejects(
    () => loadOutcomeSpec(EXAMPLE_TEXT, io()),
    Error,
  );
  assertStringIncludes(
    err.message,
    "not a valid puddleworks.dev/outcome-spec/v1",
  );
});

Deno.test("spec source: a URL is recorded without its query or login", async () => {
  const url = "https://bot:pw@example.com/specs/scanner.json?token=s3cret#v2";
  const r = routes({ [url]: () => new Response(EXAMPLE_TEXT) });
  const { source } = await loadAppSpec(url, io({ fetch: r.fetch }));
  assertEquals(r.fetched, [url]);
  assertEquals(source, "https://example.com/specs/scanner.json");
});

Deno.test("spec source: errors do not repeat a URL's query or login", async () => {
  const url = "https://bot:pw@example.com/specs/gone.json?token=s3cret";
  const failures: Array<() => Response> = [
    () => new Response("not found", { status: 404 }),
    redirect("http://example.com/x?token=s3cret"),
    () => new Response("{", { status: 200 }),
  ];
  for (const answer of failures) {
    const err = await assertRejects(
      () => loadAppSpec(url, io({ fetch: routes({ [url]: answer }).fetch })),
      Error,
    );
    assertStringIncludes(err.message, "https://example.com/specs/gone.json");
    for (const s of ["s3cret", "bot:pw"]) {
      assertEquals(err.message.includes(s), false, err.message);
    }
  }
  const http = await assertRejects(
    () => loadAppSpec("http://bot:pw@example.com/a?token=s3cret", io()),
    Error,
  );
  assertEquals(http.message.includes("s3cret"), false, http.message);
});

Deno.test("spec source: a Location that is not a URL gives a plain error", async () => {
  const url = "https://example.com/specs/moved.json";
  const r = routes({ [url]: redirect("https://[bad") });
  await assertRejects(
    () => loadAppSpec(url, io({ fetch: r.fetch })),
    Error,
    `${url} redirected to a Location that is not a URL.`,
  );
});

Deno.test("spec source: a fetch error that quotes the URL does not repeat its query", async () => {
  const url = "https://example.com/a.json?token=s3cret";
  const err = await assertRejects(
    () =>
      loadAppSpec(
        url,
        io({
          fetch: (u) =>
            Promise.reject(new Error(`error sending request for url (${u})`)),
        }),
      ),
    Error,
    "https://example.com/a.json",
  );
  assertEquals(err.message.includes("s3cret"), false, err.message);
});

Deno.test("spec source: the scheme is read whatever its case or leading space", async () => {
  const url = "HTTPS://user:pw@specs.example.com/a.json?token=SEKRET1";
  const r = routes({
    "https://user:pw@specs.example.com/a.json?token=SEKRET1": () =>
      new Response(EXAMPLE_TEXT),
  });
  const { source } = await loadAppSpec(` ${url}`, io({ fetch: r.fetch }));
  assertEquals(source, "https://specs.example.com/a.json");
  for (const http of ["Http://h.example.com/a?token=SEKRET2", "ftp://h/a"]) {
    const err = await assertRejects(
      () => loadAppSpec(http, io()),
      Error,
      "only fetched over https",
    );
    assertEquals(err.message.includes("SEKRET2"), false, err.message);
  }
});

Deno.test("spec source: a file path that cannot be read is not repeated with a secret in it", async () => {
  const err = await assertRejects(
    () =>
      loadAppSpec(
        "specs/admin:hunter2@db.acme.io/spec.json",
        io({
          readTextFile: (p) =>
            Promise.reject(new Error(`No such file: readfile '${p}'`)),
        }),
      ),
    Error,
    "Could not read",
  );
  assertEquals(err.message.includes("hunter2"), false, err.message);
});

Deno.test("spec source: a body that stops arriving times out naming the spec", async () => {
  const url = "https://example.com/specs/slow.json";
  const stalled = new ReadableStream<Uint8Array>({
    pull: () =>
      Promise.reject(
        new DOMException(
          "The operation was aborted due to timeout",
          "TimeoutError",
        ),
      ),
  });
  await assertRejects(
    () =>
      loadAppSpec(
        url,
        io({ fetch: () => Promise.resolve(new Response(stalled)) }),
      ),
    Error,
    `${url} did not answer within 30 seconds.`,
  );
});

Deno.test("spec source: the link back to where a spec was agreed is kept without its login or query", async () => {
  const url =
    "https://alice:Hunter2pw@capture.acme.io/requests/1?token=SECRETTOKEN123#c2";
  const app = await loadAppSpec(
    JSON.stringify({ ...EXAMPLE, source: { url, version: 1 } }),
    io(),
  );
  assertEquals(app.spec.source?.url, "https://capture.acme.io/requests/1");
  const outcome = JSON.parse(OUTCOME_TEXT);
  outcome.request.url = url;
  const loaded = await loadOutcomeSpec(JSON.stringify(outcome), io());
  assertEquals(loaded.spec.request.url, "https://capture.acme.io/requests/1");
});

Deno.test("spec source: the link back keeps a query that holds no secret", async () => {
  const outcome = JSON.parse(OUTCOME_TEXT);
  outcome.request.url = "https://capture.acme.io/requests?id=42";
  const loaded = await loadOutcomeSpec(JSON.stringify(outcome), io());
  assertEquals(
    loaded.spec.request.url,
    "https://capture.acme.io/requests?id=42",
  );
});
