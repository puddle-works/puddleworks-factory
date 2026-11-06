/**
 * Tests for the draft of an app's recipe: whether a spec's recipe fits a
 * single method, the pattern it gets, and what readiness makes of the recipe
 * in the app's repo.
 *
 * The pattern is a detection rule, so it is tested both ways: the turns it must
 * answer, and the turns it must leave alone.
 *
 * Run with:
 *   ~/.swamp/deno/deno test -A extensions/lib/recipes_test.ts
 *
 * @module
 */
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import {
  assessRecipe,
  DRAFT_LINE,
  type Piece,
  recipeFit,
  recipeFromWorkflow,
  recipePattern,
} from "./recipes.ts";
import type { Specification } from "../contracts/app_spec_v1.ts";

/** The pattern, read the way the recipe engine reads it. */
const engineRegex = (pattern: string) => new RegExp(`^(?:${pattern})$`, "i");

function pattern(phrases: string[], pieces: Piece[] = []): string {
  const made = recipePattern(phrases, pieces);
  if ("reason" in made) throw new Error(made.reason);
  return made.pattern;
}

const CASES: Array<{
  what: string;
  phrases: string[];
  pieces?: Piece[];
  must: Array<[string, string[]]>;
  mustNot: string[];
}> = [
  {
    what: "a phrase with nothing to capture",
    phrases: ["which tasks in my vault could a swamp extension do"],
    must: [
      ["which tasks in my vault could a swamp extension do", []],
      ["Which tasks in my vault could a swamp extension do?", []],
      ["which tasks in my vault could a swamp extension do?!", []],
      ["WHICH TASKS IN MY VAULT COULD A SWAMP EXTENSION DO.", []],
    ],
    mustNot: [
      "which tasks in my vault",
      "tell me which tasks in my vault could a swamp extension do",
      "which tasks in my vault could a swamp extension do please",
      "which tasks in my vault could a swamp extension do? and more",
    ],
  },
  {
    what: "alternatives, whatever each phrase ends with",
    phrases: ["list my notes?", "show my notes."],
    must: [
      ["list my notes", []],
      ["list my notes?", []],
      ["show my notes", []],
      ["show my notes?", []],
    ],
    mustNot: ["list my notes show my notes", "my notes", "list notes"],
  },
  {
    what: "characters a regular expression would read as its own",
    phrases: ["what's in (this) vault [now] a.b c++ $5 ^up|down\\"],
    must: [["what's in (this) vault [now] a.b c++ $5 ^up|down\\", []]],
    mustNot: [
      "what's in this vault [now] a.b c++ $5 ^up|down\\",
      "what's in (this) vault [now] axb c++ $5 ^up|down\\",
      "down\\",
    ],
  },
  {
    what: "a number",
    phrases: ["show issue 42?"],
    pieces: [{ name: "number", shape: "int" }],
    must: [
      ["show issue 42", ["42"]],
      ["show issue 7?", ["7"]],
      ["SHOW ISSUE 123456.", ["123456"]],
    ],
    mustNot: [
      "show issue",
      "show issue abc",
      "show issue 7 please",
      "please show issue 7",
      "show issue 1234567",
      "show issues 7",
      "show issue 7; rm -rf /",
    ],
  },
  {
    what: "a repo",
    phrases: ["open prs in puddle-works/factory"],
    pieces: [{ name: "repo", shape: "repo" }],
    must: [
      ["open prs in acme/widgets", ["acme/widgets"]],
      ["open prs in a.b/c_d-e?", ["a.b/c_d-e"]],
    ],
    mustNot: [
      "open prs in acme",
      "open prs in acme/widgets/extra",
      "open prs in acme widgets",
      "open prs in acme/widgets and more",
    ],
  },
  {
    what: "several pieces, with different words around them",
    phrases: ["issue 42 in a/b", "show issue 7 from c/d now"],
    pieces: [
      { name: "number", shape: "int" },
      { name: "repo", shape: "repo" },
    ],
    must: [
      ["issue 42 in a/b", ["42", "a/b"]],
      ["show issue 7 from c/d now", ["7", "c/d"]],
    ],
    mustNot: ["issue x in a/b", "issue 42 in a", "in a/b issue 42"],
  },
  {
    what: "digits that are part of the phrase, when no piece wants them",
    phrases: ["top 10 tasks"],
    must: [["top 10 tasks", []]],
    mustNot: ["top 11 tasks", "top tasks"],
  },
  {
    what: "digits inside a repo name, with a number as well",
    phrases: ["issue 5 of org1/repo2"],
    pieces: [
      { name: "number", shape: "int" },
      { name: "repo", shape: "repo" },
    ],
    must: [["issue 9 of x/y", ["9", "x/y"]]],
    mustNot: ["issue 9 of 1", "issue of x/y"],
  },
];

for (const c of CASES) {
  Deno.test(`recipe pattern: ${c.what}`, () => {
    const made = engineRegex(pattern(c.phrases, c.pieces));
    for (const phrase of c.phrases) {
      assertEquals(made.test(phrase), true, `must match: ${phrase}`);
    }
    for (const [turn, captures] of c.must) {
      const m = made.exec(turn);
      assertEquals(m?.slice(1), captures, `must match: ${turn}`);
    }
    for (const turn of c.mustNot) {
      assertEquals(made.test(turn), false, `must not match: ${turn}`);
    }
  });
}

Deno.test("recipe pattern: gives a reason when the phrases can't show where a piece is", () => {
  const int: Piece = { name: "number", shape: "int" };
  const repo: Piece = { name: "repo", shape: "repo" };
  for (
    const [what, phrases, pieces, says] of [
      ["no such token", ["show the issue"], [int], "show the issue"],
      ["too many tokens", ["move 3 to 4"], [int], "move 3 to 4"],
      ["a decimal", ["round 3.5"], [int], "round 3.5"],
      ["a differing order", ["42 in a/b", "a/b has 42"], [int, repo], "order"],
      ["a phrase of only punctuation", ["?!"], [], "?!"],
      ["a catch-all", ["x"], [], "any turn"],
    ] as Array<[string, string[], Piece[], string]>
  ) {
    const made = recipePattern(phrases, pieces);
    assertEquals("reason" in made, true, what);
    if ("reason" in made) assertStringIncludes(made.reason, says, what);
  }
});

const SPEC: Specification = {
  purpose: "Show an issue.",
  inputs: [
    {
      name: "number",
      type: "integer",
      description: "The issue.",
      required: true,
    },
    {
      name: "verbose",
      type: "boolean",
      description: "More.",
      required: false,
      default: false,
    },
  ],
  output: "The issue's title.",
  outOfScope: ["Changing it."],
  recordedBy: "a@example.com",
  recordedAt: "2026-10-26T16:00:00Z",
};
const recipe = (over = {}) => ({
  examples: [{ phrase: "show issue 42", answer: "The title." }],
  pieces: [{ name: "number", shape: "int" as const }],
  whenEmpty: "",
  ...over,
});

Deno.test("recipe fit: no recipe, or no examples, asks for nothing", () => {
  assertEquals(recipeFit(SPEC), null);
  assertEquals(
    recipeFit({ ...SPEC, recipe: recipe({ examples: [] }) }),
    null,
  );
});

Deno.test("recipe fit: a piece per required input fits, and optional inputs stay out", () => {
  const fit = recipeFit({ ...SPEC, recipe: recipe() });
  assertEquals(fit && "pattern" in fit, true);
  if (fit && "pattern" in fit) {
    assertEquals(fit.inputs, { number: { capture: 1, as: "int" } });
    assertEquals(engineRegex(fit.pattern).exec("show issue 9")?.[1], "9");
  }
});

Deno.test("recipe fit: says why when the spec can't be one method call", () => {
  const needsText = {
    ...SPEC,
    inputs: [
      ...SPEC.inputs,
      {
        name: "note",
        type: "string" as const,
        description: "Free text.",
        required: true,
      },
    ],
  };
  for (
    const [what, spec, says] of [
      ["a required input with no piece", {
        ...needsText,
        recipe: recipe(),
      }, '"note"'],
      ["a piece with no input", {
        ...SPEC,
        inputs: [],
        recipe: recipe(),
      }, '"number"'],
      ["a number piece on a text input", {
        ...SPEC,
        inputs: [{ ...SPEC.inputs[0], type: "string" as const }],
        recipe: recipe(),
      }, "number"],
      ["a repo piece on a number input", {
        ...SPEC,
        recipe: recipe({
          examples: [{ phrase: "show a/b", answer: "" }],
          pieces: [{ name: "number", shape: "repo" }],
        }),
      }, "number"],
      ["a word piece", {
        ...SPEC,
        inputs: [{ ...SPEC.inputs[0], name: "name", type: "string" as const }],
        recipe: recipe({ pieces: [{ name: "name", shape: "word" }] }),
      }, "word"],
      ["more captures than the engine takes", {
        ...SPEC,
        inputs: Array.from({ length: 10 }, (_, i) => ({
          name: `n${i}`,
          type: "integer" as const,
          description: "A number.",
          required: true,
        })),
        recipe: recipe({
          examples: [{ phrase: "0 1 2 3 4 5 6 7 8 9", answer: "" }],
          pieces: Array.from({ length: 10 }, (_, i) => ({
            name: `n${i}`,
            shape: "int",
          })),
        }),
      }, "9"],
    ] as Array<[string, Specification, string]>
  ) {
    const fit = recipeFit(spec);
    assertEquals(fit && "reason" in fit, true, what);
    if (fit && "reason" in fit) assertStringIncludes(fit.reason, says, what);
  }
});

// ---------------------------------------------------------------------------
// The recipe in the app's repo
// ---------------------------------------------------------------------------

const TAG = {
  id: "my-app",
  extension: "@puddleworks/my-app",
  pattern: "^show issue (\\d{1,6})[?.!]*$",
  dataName: "result",
  inputs: { number: { capture: 1, as: "int" } },
  each: { path: "items", line: "{title}" },
  template: "Issues:\n{lines}",
};

function recipeYaml(
  tag: unknown = TAG,
  inputs = "number: ${{ inputs.number }}",
): string {
  return `id: 3e1a
name: "@puddleworks/my-app-recipe"
tags:
  puddlerouterRecipe: '${JSON.stringify(tag).replaceAll("'", "''")}'
jobs:
  - name: main
    steps:
      - name: run
        task:
          type: model_method
          modelIdOrName: my-app-model
          methodName: run
          inputs:
            ${inputs}
`;
}

const ENTRY = (steps = 1, required = "[]") =>
  `id: 3e1b
name: "@puddleworks/my-app"
inputs:
  type: object
  required: ${required}
jobs:
  - name: main
    steps:
${
    Array.from({ length: steps }, (_, i) =>
      `      - name: s${i}
        task:
          type: model_method
          modelIdOrName: my-app-model
          methodName: run
`).join("")
  }`;

const MANIFEST = `name: "@puddleworks/my-app"
labels:
  - puddlerouter-recipe
workflows:
  - workflow-my-app.yaml
  - workflow-my-app-recipe.yaml
`;

const DRAFT = {
  entryPointRef: "@puddleworks/my-app",
  recipe: {
    examples: ["show issue 42"],
    pieces: ["number"],
    workflow: "workflows/workflow-my-app-recipe.yaml",
  },
};

function repo(over: Record<string, string | null> = {}) {
  const all: Record<string, string | null> = {
    "manifest.yaml": MANIFEST,
    "workflows/workflow-my-app.yaml": ENTRY(),
    "workflows/workflow-my-app-recipe.yaml": recipeYaml(),
    ...over,
  };
  return Object.entries(all).flatMap(([path, text]) =>
    text === null ? [] : [{ path, text }]
  );
}

Deno.test("recipe in the repo: an entry point with several steps and no recipe blocks, and says how to get one", () => {
  const found = assessRecipe(
    repo({
      "workflows/workflow-my-app-recipe.yaml": null,
      "workflows/workflow-my-app.yaml": ENTRY(6),
    }),
    DRAFT,
  );
  assertEquals(found.none, undefined);
  assertEquals(found.recipes, []);
  assertEquals(found.blockers.length, 1);
  for (const part of ["6 steps", "one method", "latest stored result"]) {
    assertStringIncludes(found.blockers[0], part);
  }
});

Deno.test("recipe in the repo: several steps that also need free text can't have a recipe", () => {
  const found = assessRecipe(
    repo({
      "workflows/workflow-my-app-recipe.yaml": null,
      "workflows/workflow-my-app.yaml": ENTRY(6, "[note]"),
    }),
    DRAFT,
  );
  assertEquals(found.blockers, []);
  assertStringIncludes(found.none ?? "", '"note"');
});

Deno.test("recipe in the repo: a finished one is ready to check, as the engine would read it", () => {
  const found = assessRecipe(repo(), DRAFT);
  assertEquals(found.blockers, []);
  assertEquals(found.none, undefined);
  assertEquals(found.phrases, ["show issue 42"]);
  assertEquals(found.recipes, [{
    ...TAG,
    method: "run",
    definition: "my-app-model",
    fixed: {},
  }]);
});

Deno.test("recipe in the repo: nothing agreed means nothing to say", () => {
  const found = assessRecipe(
    repo({ "workflows/workflow-my-app-recipe.yaml": null }),
    { entryPointRef: "@puddleworks/my-app" },
  );
  assertEquals(found, { phrases: [], recipes: [], blockers: [], skipped: 0 });
});

Deno.test("recipe in the repo: a later outcome spec's phrases count too", () => {
  const outcome = (version: number, phrase: string) =>
    JSON.stringify({
      specification: { version, recipe: { examples: [{ phrase }] } },
    });
  const found = assessRecipe(
    repo({
      "spec/outcome-spec.v1.json": outcome(1, "an old phrase"),
      "spec/outcome-spec.v2.json": outcome(2, "show issue 7?"),
    }),
    DRAFT,
  );
  assertEquals(found.phrases, ["show issue 42", "show issue 7?"]);
});

Deno.test("recipe in the repo: blocks what would stop it reaching the app", () => {
  const blocker = (
    what: string,
    over: Record<string, string | null>,
    says: string,
  ) => {
    const found = assessRecipe(repo(over), DRAFT);
    assertEquals(found.blockers.length > 0, true, what);
    assertStringIncludes(found.blockers.join(" "), says, what);
  };
  const path = "workflows/workflow-my-app-recipe.yaml";
  blocker("not listed", {
    "manifest.yaml": MANIFEST.replace("  - workflow-my-app-recipe.yaml\n", ""),
  }, "workflow-my-app-recipe.yaml");
  blocker("no label", {
    "manifest.yaml": MANIFEST.replace("labels:\n  - puddlerouter-recipe\n", ""),
  }, "puddlerouter-recipe");
  blocker("draft line left", {
    [path]: recipeYaml({ ...TAG, each: { path: "items", line: DRAFT_LINE } }),
  }, "each.line");
  blocker("tag not JSON", {
    [path]: recipeYaml("x").replace('"x"', "{not json"),
  }, "not JSON");
  blocker("input not captured", {
    [path]: recipeYaml(TAG, "other: ${{ inputs.other }}"),
  }, "other");
  blocker("recipe removed from a one-step entry point", {
    [path]: null,
  }, "workflow-my-app-recipe.yaml");
});

Deno.test("recipe in the repo: a broken recipe isn't offered to the check", () => {
  const found = assessRecipe(
    repo({
      "workflows/workflow-my-app-recipe.yaml": recipeYaml("x").replace(
        '"x"',
        "{not json",
      ),
    }),
    DRAFT,
  );
  assertEquals(found.recipes, []);
});

Deno.test("recipe in the repo: no recipe is fine when it can't call the app, and says why", () => {
  const without = { "workflows/workflow-my-app-recipe.yaml": null };
  for (
    const [what, over, draft, says] of [
      ["the draft found no fit, for free text", {
        ...without,
        "workflows/workflow-my-app.yaml": ENTRY(1, "[note]"),
      }, {
        entryPointRef: DRAFT.entryPointRef,
        recipe: {
          examples: ["show issue 42"],
          pieces: [],
          reason: "The input needs free text.",
        },
      }, '"note"'],
      [
        "the entry point now needs free text",
        {
          ...without,
          "workflows/workflow-my-app.yaml": ENTRY(1, "[note]"),
        },
        DRAFT,
        '"note"',
      ],
    ] as Array<[
      string,
      Record<string, string | null>,
      typeof DRAFT,
      string,
    ]>
  ) {
    const found = assessRecipe(repo(over), draft);
    assertEquals(found.blockers, [], what);
    assertEquals(found.recipes, [], what);
    assertStringIncludes(found.none ?? "", says, what);
  }
});

Deno.test("recipe in the repo: the engine's rules for a workflow", () => {
  const steps = (n: number) => ({
    tags: { puddlerouterRecipe: JSON.stringify(TAG) },
    jobs: [{
      steps: Array.from({ length: n }, () => ({
        task: {
          type: "model_method",
          methodName: "run",
          modelIdOrName: "m",
          inputs: { number: "${{ inputs.number }}" },
        },
      })),
    }],
  });
  assertEquals("recipe" in recipeFromWorkflow(steps(1)), true);
  // The engine reads only this spelling of an input.
  for (const spelling of ["${{inputs.number}}", "${{  inputs.number }}"]) {
    const wf = steps(1);
    wf.jobs[0].steps[0].task.inputs.number = spelling;
    assertEquals("error" in recipeFromWorkflow(wf), true, spelling);
  }
  assertEquals(recipeFromWorkflow(steps(2)), {
    error: "must have exactly one step",
  });
  assertEquals(
    recipeFromWorkflow({
      ...steps(1),
      jobs: [{ steps: [{ task: { type: "workflow" } }] }],
    }),
    { error: "the step must be a model_method" },
  );
  const fixed = recipeFromWorkflow({
    tags: { puddlerouterRecipe: JSON.stringify({ ...TAG, inputs: {} }) },
    jobs: [{
      steps: [{
        task: {
          type: "model_method",
          methodName: "run",
          modelIdOrName: "m",
          inputs: { state: "open", limit: 5 },
        },
      }],
    }],
  });
  assertEquals(
    "recipe" in fixed && fixed.recipe.fixed,
    { state: "open", limit: "5" },
  );
});

Deno.test("recipe in the repo: no recipe blocks when it's the spec or the build that can change, and says why", () => {
  const found = assessRecipe(
    repo({ "workflows/workflow-my-app-recipe.yaml": null }),
    {
      entryPointRef: DRAFT.entryPointRef,
      recipe: {
        examples: ["show issue 42"],
        pieces: ["number"],
        reason: 'The recipe\'s piece "number" is a word.',
      },
    },
  );
  assertEquals(found.none, undefined);
  assertEquals(found.blockers.length, 1);
  assertStringIncludes(found.blockers[0], 'piece "number" is a word');
  assertStringIncludes(found.blockers[0], "CLAUDE.md");
  assertStringIncludes(found.blockers[0], "change the spec");
});

Deno.test("recipe pattern: pieces of one shape need the same words in every phrase", () => {
  const ints: Piece[] = [
    { name: "from", shape: "int" },
    { name: "to", shape: "int" },
  ];
  const repos: Piece[] = [
    { name: "from", shape: "repo" },
    { name: "to", shape: "repo" },
  ];
  for (
    const [phrases, pieces] of [
      [["from 1 to 2 notes", "notes to 2 from 1 now"], ints],
      [["from 1 to 2", "to 1 from 2"], ints],
      [["copy a/b to c/d", "into c/d copy a/b"], repos],
    ] as Array<[string[], Piece[]]>
  ) {
    const made = recipePattern(phrases, pieces);
    assertEquals("reason" in made, true, phrases.join(" | "));
    if ("reason" in made) {
      assertStringIncludes(made.reason, "which is which");
    }
  }
  for (
    const [phrases, pieces] of [
      [["from 1 to 2", "from 30 to 40?"], ints],
      [["Move 1 to 2", "move 3 to 4."], ints],
      [["copy a/b to c/d", "copy e/f to g/h"], repos],
      [["issue 4 in a/b", "show issue 4 in a/b"], [
        { name: "number", shape: "int" },
        { name: "repo", shape: "repo" },
      ]],
      [["show issue 4", "what's in issue 7"], [{
        name: "number",
        shape: "int",
      }]],
    ] as Array<[string[], Piece[]]>
  ) {
    assertEquals(
      "pattern" in recipePattern(phrases, pieces),
      true,
      phrases.join(" | "),
    );
  }
});

Deno.test("recipe pattern: spaces in a phrase are read as the engine reads a turn", () => {
  const withPiece = engineRegex(
    pattern(["show  issue \t 42?"], [{ name: "number", shape: "int" }]),
  );
  assertEquals(withPiece.test("show issue 7"), true);
  assertEquals(
    engineRegex(pattern(["list   my notes"])).test("list my notes"),
    true,
  );
});
