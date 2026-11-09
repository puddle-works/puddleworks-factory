/**
 * Tests for checking an app's recipe against the phrases agreed for it, using
 * the real recipe engine in a throwaway swamp repo. A fake `swamp` stands in
 * here; it reads the `puddlerouter.yaml` the check writes, as the engine does.
 *
 * Run with:
 *   ~/.swamp/deno/deno test -A extensions/lib/recipe_check_test.ts
 *
 * @module
 */
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { parse } from "jsr:@std/yaml@1.0.12";
import { realSwamp, recipeReadiness, type SwampRun } from "./recipe_check.ts";
import { onlyReads } from "./recipes.ts";
import { BuildExamplesSchema } from "../contracts/build_result_v1.ts";

const ok = (attributes: unknown) => ({
  code: 0,
  stdout: JSON.stringify({ dataArtifacts: [{ attributes }] }),
  stderr: "",
});

/** A `swamp` that matches each phrase against the recipes in puddlerouter.yaml. */
function fakeSwamp(
  over: { fail?: string; executeOk?: boolean; seen?: string[][] } = {},
): SwampRun {
  let created = false;
  return async (args, cwd) => {
    over.seen?.push(args);
    if (over.fail && args.join(" ").includes(over.fail)) {
      return { code: 1, stdout: "", stderr: `${over.fail} went wrong` };
    }
    if (args[0] === "behavior" && args[1] === "create") created = true;
    if (args[0] !== "behavior" || args[1] !== "run") {
      return { code: 0, stdout: "{}", stderr: "" };
    }
    // Real swamp makes the definition on a first run, and says so on stdout,
    // ahead of the JSON the run gives.
    if (!created) {
      created = true;
      return {
        code: 0,
        stdout: `{"event":"definition_auto_created"}\n{}`,
        stderr: "",
      };
    }
    const config = parse(
      await Deno.readTextFile(`${cwd}/puddlerouter.yaml`),
    ) as { recipes: Array<{ id: string; pattern: string }> };
    const value = (name: string) =>
      args.find((a) => a.startsWith(`${name}=`) || a.startsWith(`${name}:`))
        ?.replace(/^[^=]*=/, "");
    if (args.includes("match")) {
      const text = value("text")!;
      for (const r of config.recipes) {
        const m = new RegExp(`^(?:${r.pattern})$`, "i").exec(text);
        if (m) {
          return ok({
            matched: true,
            recipeId: r.id,
            captures: m.slice(1),
            effects: "write",
          });
        }
      }
      return ok({ matched: false, recipeId: "", captures: [], effects: "" });
    }
    return over.executeOk === false
      ? ok({ action: "none", ok: false, text: "", error: "bad input: no" })
      : ok({ action: "would-ask", ok: true, text: "Would ask.", error: "" });
  };
}

const ENTRY = `name: "@puddleworks/my-app"
jobs:
  - steps:
      - task: { type: model_method, modelIdOrName: m, methodName: run }
`;
const recipeFile = (pattern = "^show issue (\\d{1,6})[?.!]*$") =>
  `name: "@puddleworks/my-app-recipe"
tags:
  puddlerouterRecipe: '${
    JSON.stringify({
      id: "my-app",
      extension: "@acme/my-app",
      pattern,
      dataName: "result",
      inputs: { number: { capture: 1, as: "int" } },
      each: { path: "items", line: "{title}" },
      template: "{lines}",
    })
  }'
jobs:
  - steps:
      - task:
          type: model_method
          modelIdOrName: my-app-model
          methodName: run
          inputs:
            number: \${{ inputs.number }}
`;
const files = (recipe: string | null = recipeFile()) => [
  {
    path: "manifest.yaml",
    text:
      "labels: [puddlerouter-recipe]\nworkflows: [workflow-my-app.yaml, workflow-my-app-recipe.yaml]\n",
  },
  { path: "workflows/workflow-my-app.yaml", text: ENTRY },
  ...(recipe === null
    ? []
    : [{ path: "workflows/workflow-my-app-recipe.yaml", text: recipe }]),
];
const draft = (examples = ["show issue 42", "show issue 7?"]) => ({
  entryPointRef: "@puddleworks/my-app",
  recipe: {
    examples,
    pieces: ["number"],
    workflow: "workflows/workflow-my-app-recipe.yaml",
  },
});

Deno.test("recipe check: every phrase answered, one passed example each", async () => {
  const seen: string[][] = [];
  const got = await recipeReadiness(
    files(),
    draft(),
    fakeSwamp({ seen }),
  );
  assertEquals(got.blockers, []);
  assertEquals(got.examples, [
    { phrase: "show issue 42", passed: true },
    { phrase: "show issue 7?", passed: true },
  ]);
  assertEquals(got.line, "2 of 2 example phrases passed");
  const flat = seen.map((a) => a.join(" "));
  assertEquals(flat[0].startsWith("repo init"), true);
  assertEquals(flat[1].startsWith("extension pull @puddleworks/recipes"), true);
  const match = seen.find((a) => a.includes("match"))!;
  assertEquals(match.includes("--literal-inputs"), true);
  const execute = seen.find((a) => a.includes("execute"))!;
  assertEquals(execute.includes("mode=shadow"), true);
  assertEquals(execute.includes('captures:json=["42"]'), true);
});

Deno.test("recipe check: a phrase the recipe no longer answers fails and blocks", async () => {
  const got = await recipeReadiness(
    files(recipeFile("^list every issue[?.!]*$")),
    draft(),
    fakeSwamp(),
  );
  assertEquals(got.examples?.map((e) => e.passed), [false, false]);
  assertEquals(got.line, "0 of 2 example phrases passed");
  assertStringIncludes(got.examples![0].detail!, "No recipe matched");
  assertStringIncludes(got.blockers.join(" "), '"show issue 42"');
});

Deno.test("recipe check: execute's refusal is a failed example", async () => {
  const got = await recipeReadiness(
    files(),
    draft(["show issue 42"]),
    fakeSwamp({ executeOk: false }),
  );
  assertEquals(got.examples, [{
    phrase: "show issue 42",
    passed: false,
    detail: "bad input: no",
  }]);
  assertStringIncludes(got.blockers.join(" "), "bad input: no");
});

Deno.test("recipe check: one phrase's swamp failure doesn't lose the others", async () => {
  const got = await recipeReadiness(
    files(),
    draft(["show issue 42", "show issue 7"]),
    fakeSwamp({ fail: "text=show issue 42" }),
  );
  assertEquals(got.examples?.map((e) => e.passed), [false, true]);
  assertStringIncludes(got.examples![0].detail!, "went wrong");
});

Deno.test("recipe check: an engine that can't be set up is a blocker, and no example is reported", async () => {
  for (const step of ["repo init", "extension pull"]) {
    const got = await recipeReadiness(
      files(),
      draft(),
      fakeSwamp({ fail: step }),
    );
    assertEquals(got.examples, undefined, step);
    assertStringIncludes(got.blockers.join(" "), "went wrong", step);
    assertEquals(got.line, "not checked");
  }
});

Deno.test("recipe check: a swamp that won't start is a blocker too", async () => {
  const got = await recipeReadiness(files(), draft(), () => {
    throw new Error("swamp is not on the PATH");
  });
  assertEquals(got.examples, undefined);
  assertStringIncludes(got.blockers.join(" "), "swamp is not on the PATH");
});

Deno.test("recipe check: no recipe says why, runs nothing and reports no examples", async () => {
  const seen: string[][] = [];
  const freeText = files(null).map((f) =>
    f.path === "workflows/workflow-my-app.yaml"
      ? { ...f, text: `inputs:\n  required: [note]\n${f.text}` }
      : f
  );
  const got = await recipeReadiness(freeText, {
    entryPointRef: "@puddleworks/my-app",
    recipe: {
      examples: ["show issue 42"],
      pieces: [],
      reason: "It needs free text.",
    },
  }, fakeSwamp({ seen }));
  assertEquals(seen, []);
  assertEquals(got.examples, undefined);
  assertEquals(got.blockers, []);
  assertStringIncludes(got.line!, 'none. The input "note" is required');
});

Deno.test("recipe check: nothing agreed runs nothing and says nothing", async () => {
  const seen: string[][] = [];
  const got = await recipeReadiness(
    files(null),
    { entryPointRef: "@puddleworks/my-app" },
    fakeSwamp({ seen }),
  );
  assertEquals(seen, []);
  assertEquals(got, { line: null, blockers: [] });
});

Deno.test("recipe check: it allows the app's collective, and leaves no repo behind", async () => {
  let cwd = "";
  let allow: unknown;
  const got = await recipeReadiness(files(), draft(["show issue 42"]), async (
    args,
    dir,
  ) => {
    cwd = dir;
    if (args.includes("match")) {
      allow = (parse(await Deno.readTextFile(`${dir}/puddlerouter.yaml`)) as {
        allow: unknown;
      }).allow;
    }
    return fakeSwamp()(args, dir);
  });
  assertEquals(got.examples?.length, 1);
  assertEquals(allow, ["@acme/*"]);
  const left = await Deno.stat(cwd).then(() => true, () => false);
  assertEquals(left, false);
});

// ---- Does the app answer in time? Only a recipe that only reads is ever run.

const READ_MANIFEST = {
  path: "manifest.yaml",
  text:
    "labels: [puddlerouter-recipe, effects-read]\nworkflows: [workflow-my-app.yaml, workflow-my-app-recipe.yaml]\n",
};
const readingApp = () => [READ_MANIFEST, ...files().slice(1)];

/** A `swamp` that also loads the app and runs it, on a clock it moves itself. */
function appSwamp(over: {
  methods?: string[];
  runSeconds?: number;
  runResult?: Record<string, unknown>;
  cutOff?: boolean;
  fail?: string;
  seen?: string[][];
  reads?: unknown[];
  timeouts?: Array<number | undefined>;
} = {}) {
  let clock = 0;
  const base = fakeSwamp({ seen: over.seen, fail: over.fail });
  const run: SwampRun = async (args, cwd, timeoutMs) => {
    if (args[0] === "behavior" && args[1] === "type") {
      over.seen?.push(args);
      return {
        code: 0,
        stdout: JSON.stringify({
          methods: (over.methods ?? ["run"]).map((name) => ({ name })),
        }),
        stderr: "",
      };
    }
    const config = parse(
      await Deno.readTextFile(`${cwd}/puddlerouter.yaml`).catch(() => "{}"),
    ) as { reads?: string[] };
    if (args.includes("execute") && config.reads) {
      over.seen?.push(args);
      over.reads?.push(config.reads);
      over.timeouts?.push(timeoutMs);
      if (over.cutOff) {
        clock += timeoutMs ?? 0;
        return { code: 143, stdout: "", stderr: "" };
      }
      clock += (over.runSeconds ?? 2) * 1000;
      return ok(
        over.runResult ?? { action: "ran", ok: true, text: "A.", error: "" },
      );
    }
    return base(args, cwd);
  };
  return { run, now: () => clock };
}

Deno.test("speed: an app that only reads is run once for each phrase and timed", async () => {
  const seen: string[][] = [];
  const reads: unknown[] = [];
  const { run, now } = appSwamp({ seen, reads, runSeconds: 2.5 });
  const got = await recipeReadiness(
    readingApp(),
    draft(["show issue 42"]),
    run,
    {
      dir: "/w/app",
      now,
    },
  );
  assertEquals(got.blockers, []);
  assertEquals(reads, [["@acme/my-app run"]]);
  assertEquals(
    seen.some((a) => a.join(" ") === "extension source add /w/app --json"),
    true,
  );
  assertStringIncludes(got.line!, "1 of 1 example phrases passed");
  assertStringIncludes(got.line!, "Slowest run 2.5 s");
});

Deno.test("speed: a run over the budget blocks, and says what to do", async () => {
  const { run, now } = appSwamp({ runSeconds: 10.5 });
  const got = await recipeReadiness(readingApp(), draft(), run, {
    dir: "/w/app",
    now,
  });
  assertEquals(got.blockers.length, 1);
  assertStringIncludes(got.blockers[0], "10.5 s");
  assertStringIncludes(got.blockers[0], "latest stored result");
});

Deno.test("speed: a run at the budget is allowed", async () => {
  const { run, now } = appSwamp({ runSeconds: 10 });
  const got = await recipeReadiness(readingApp(), draft(), run, {
    dir: "/w/app",
    now,
  });
  assertEquals(got.blockers, []);
});

Deno.test("speed: a run that is cut off blocks, however it ended", async () => {
  const timeouts: Array<number | undefined> = [];
  const { run, now } = appSwamp({ cutOff: true, timeouts });
  const got = await recipeReadiness(readingApp(), draft(), run, {
    dir: "/w/app",
    now,
  });
  assertEquals(typeof timeouts[0], "number");
  assertEquals(got.blockers.length, 1);
  assertStringIncludes(got.blockers[0], "did not finish");
});

Deno.test("speed: a run that fails for another reason only leaves a note", async () => {
  const { run, now } = appSwamp({
    runResult: { action: "ran", ok: false, text: "", error: "no token" },
  });
  const got = await recipeReadiness(readingApp(), draft(), run, {
    dir: "/w/app",
    now,
  });
  assertEquals(got.blockers, []);
  assertStringIncludes(got.line!, "Speed not timed");
  assertStringIncludes(got.line!, "no token");
});

Deno.test("speed: a run the engine didn't actually do is not counted as fast", async () => {
  const { run, now } = appSwamp({
    runResult: { action: "would-ask", ok: true, text: "Would ask.", error: "" },
  });
  const got = await recipeReadiness(readingApp(), draft(), run, {
    dir: "/w/app",
    now,
  });
  assertEquals(got.blockers, []);
  assertEquals(got.line!.includes("Slowest run"), false);
  assertStringIncludes(got.line!, "Speed not timed");
});

Deno.test("speed: an app that may change things is never run", async () => {
  const reads: unknown[] = [];
  const { run, now } = appSwamp({ reads, runSeconds: 99 });
  const got = await recipeReadiness(files(), draft(), run, {
    dir: "/w/app",
    now,
  });
  assertEquals(reads, []);
  assertEquals(got.blockers, []);
  assertStringIncludes(got.line!, "Speed not timed");
  assertStringIncludes(got.line!, "may change things");
});

Deno.test("speed: only effects-read without effects-write counts as only reading", async () => {
  const manifest = (text: string) => [{ path: "manifest.yaml", text }];
  for (
    const text of [
      "labels: [effects-read]",
      "labels:\n  - puddlerouter-recipe\n  - effects-read\n",
    ]
  ) assertEquals(onlyReads(manifest(text)), true, text);
  for (
    const text of [
      "labels: []",
      "labels: [puddlerouter-recipe]",
      "labels: [effects-read, effects-write]",
      "labels: [effects-write]",
      "labels: effects-read",
      "labels: [effects-reads]",
      "name: x",
      ": : not yaml [",
    ]
  ) assertEquals(onlyReads(manifest(text)), false, text);
  assertEquals(onlyReads([]), false);
});

Deno.test("method: a recipe calling a method the app doesn't have blocks, for any app", async () => {
  for (const app of [readingApp(), files()]) {
    const { run, now } = appSwamp({ methods: ["other"] });
    const got = await recipeReadiness(app, draft(), run, {
      dir: "/w/app",
      now,
    });
    assertEquals(got.blockers.length, 1);
    assertStringIncludes(got.blockers[0], '"run"');
    assertStringIncludes(got.blockers[0], '"other"');
  }
});

Deno.test("method: an app that can't be loaded here is a note, not a blocker", async () => {
  const { run, now } = appSwamp({ fail: "source add" });
  const got = await recipeReadiness(readingApp(), draft(), run, {
    dir: "/w/app",
    now,
  });
  assertEquals(got.blockers, []);
  assertStringIncludes(got.line!, "not checked");
  assertStringIncludes(got.line!, "source add");
});

// Stopping swamp doesn't stop a run it started, and that run holds its pipes.
Deno.test({
  name: "real swamp: a run left going by the stopped swamp doesn't hold it up",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "factory-swamp-shim-" });
    const path = Deno.env.get("PATH") ?? "";
    try {
      await Deno.writeTextFile(`${dir}/swamp`, "#!/bin/sh\nsleep 6 &\nwait\n");
      await Deno.chmod(`${dir}/swamp`, 0o755);
      Deno.env.set("PATH", `${dir}:${path}`);
      const started = performance.now();
      // A slow machine may stop it before the sleep starts, which also passes.
      await realSwamp(["x"], dir, 1000).catch(() => {});
      assertEquals(performance.now() - started < 4000, true);
    } finally {
      Deno.env.set("PATH", path);
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test("recipe check: says how many phrases were past the limit and not checked", async () => {
  const phrases = (n: number) =>
    Array.from({ length: n }, (_, i) => `show issue ${i}`);
  const many = await recipeReadiness(
    files(),
    draft(phrases(61)),
    fakeSwamp(),
  );
  assertEquals(many.examples!.length, 50);
  assertEquals(
    many.line,
    "50 of 50 example phrases passed. 11 more phrases not checked",
  );
  const one = await recipeReadiness(files(), draft(phrases(51)), fakeSwamp());
  assertEquals(
    one.line,
    "50 of 50 example phrases passed. 1 more phrase not checked",
  );
});

Deno.test("speed: an app in a relative folder is still found from the throwaway repo", async () => {
  const seen: string[][] = [];
  const { run, now } = appSwamp({ seen, runSeconds: 1 });
  const got = await recipeReadiness(
    readingApp(),
    draft(["show issue 42"]),
    run,
    { dir: "some/app", now },
  );
  assertEquals(got.blockers, []);
  assertEquals(
    seen.some((a) =>
      a.join(" ") === `extension source add ${Deno.cwd()}/some/app --json`
    ),
    true,
  );
});

// A hand-edited outcome spec can hold a phrase longer than the readiness
// resource takes, and writing it then failed (issue #95).
Deno.test("recipe check: a phrase too long for a build result blocks and is left out", async () => {
  const long = `show issue 42 ${"and more ".repeat(66)}`.trim();
  const outcome = {
    path: "spec/outcome-spec.v1.json",
    text: JSON.stringify({
      specification: { version: 1, recipe: { examples: [{ phrase: long }] } },
    }),
  };
  const got = await recipeReadiness(
    [...files(), outcome],
    draft(["show issue 42"]),
    fakeSwamp(),
  );
  assertEquals(got.examples?.map((e) => e.phrase), ["show issue 42"]);
  assertEquals(BuildExamplesSchema.safeParse(got.examples).success, true);
  assertStringIncludes(got.blockers.join(" "), "at most 500");
  const only = await recipeReadiness(
    [...files(), outcome],
    { entryPointRef: "@puddleworks/my-app" },
    fakeSwamp(),
  );
  assertStringIncludes(only.blockers.join(" "), `${long.length} characters`);
});
