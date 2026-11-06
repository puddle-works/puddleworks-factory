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
import { recipeReadiness, type SwampRun } from "./recipe_check.ts";

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
  const got = await recipeReadiness(files(null), {
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
  assertEquals(got.line, "none. It needs free text.");
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
