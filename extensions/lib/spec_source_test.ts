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
