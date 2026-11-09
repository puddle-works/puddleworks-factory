/**
 * The published package ships the README but not the rest of the repo, so
 * what the README points at must be shipped too, or be an absolute URL.
 */
import { assertEquals } from "jsr:@std/assert@1.0.19";
import { parse } from "jsr:@std/yaml@1.0.12";
import { model as draftModel } from "./draft.ts";
import { model as webModel } from "./web.ts";

const ROOT = new URL("../../", import.meta.url);

// An instance only moves to a new behavior version through an upgrade entry,
// and swamp warns at publish about a behavior that has none.
Deno.test("package: each behavior is at the manifest's version, with an upgrade to it", async () => {
  const { version } = parse(
    await Deno.readTextFile(new URL("manifest.yaml", ROOT)),
  ) as { version: string };
  for (const model of [draftModel, webModel]) {
    assertEquals(model.version, version, model.type);
    assertEquals(model.upgrades.at(-1)?.toVersion, version, model.type);
    const old = { draft: "kept" };
    assertEquals(model.upgrades.at(-1)?.upgradeAttributes(old), old);
  }
});

async function exists(url: URL): Promise<boolean> {
  try {
    await Deno.stat(url);
    return true;
  } catch {
    return false;
  }
}

Deno.test("package: the README links and example inputs reach only shipped files or URLs", async () => {
  const readme = await Deno.readTextFile(new URL("README.md", ROOT));
  const manifest = parse(
    await Deno.readTextFile(new URL("manifest.yaml", ROOT)),
  ) as { additionalFiles?: string[] };
  const shipped = new Set(manifest.additionalFiles ?? []);
  const targets = [
    ...[...readme.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]),
    ...[...readme.matchAll(/--input \w+=([^\s`]+)/g)].map((m) => m[1]),
  ];
  // Only a path to a file in this repo can be left behind by the package; a
  // value like true, or a path in the app's own checkout, is not one.
  const unshipped = [];
  for (const t of targets) {
    const path = t.split("#")[0];
    if (!path || /^[a-z]+:/.test(path) || shipped.has(path)) continue;
    if (await exists(new URL(path, ROOT))) unshipped.push(t);
  }
  assertEquals(unshipped, []);
});

Deno.test("package: the shipped workflows point at docs by URL, since docs/ is not shipped", async () => {
  const manifest = parse(
    await Deno.readTextFile(new URL("manifest.yaml", ROOT)),
  ) as { workflows?: string[] };
  const bare: string[] = [];
  for (const file of manifest.workflows ?? []) {
    const text = await Deno.readTextFile(new URL(`workflows/${file}`, ROOT));
    for (const m of text.matchAll(/(\S*)docs\/[\w./-]+/g)) {
      if (!m[1].startsWith("https://")) bare.push(`${file}: ${m[0]}`);
    }
  }
  assertEquals(bare, []);
});

Deno.test("package: shipped docs don't lean on Puddleworks' other tools", async () => {
  for (const file of ["README.md", "extensions/models/web.ts"]) {
    const text = await Deno.readTextFile(new URL(file, ROOT));
    assertEquals(/Capture/.test(text), false, `${file} mentions Capture`);
  }
  const readme = await Deno.readTextFile(new URL("README.md", ROOT));
  // Orca may be named, but only once it is said what it is.
  const first = readme.indexOf("Orca");
  assertEquals(
    first === -1 || /Orca \([^)]*worktree/.test(readme.slice(first)),
    true,
    "the README names Orca without saying what it is",
  );
});

const SKILL = new URL(".claude/skills/factory-build/SKILL.md", ROOT);
const SETTINGS_KEYS = ["org", "template", "secrets", "collective", "worktrees"];

/** The skill without its Settings section, the one place defaults may be written. */
async function skillOutsideSettings(): Promise<string> {
  const skill = await Deno.readTextFile(SKILL);
  const at = skill.indexOf("\n## Settings");
  const end = skill.indexOf("\n## ", at + 1);
  return at < 0 ? skill : skill.slice(0, at) + skill.slice(end);
}

Deno.test("package: the skill has no Puddleworks setup outside its Settings section", async () => {
  const skill = await Deno.readTextFile(SKILL);
  const rest = await skillOutsideSettings();
  assertEquals(skill.includes("\n## Settings"), true, "no Settings section");
  assertEquals(/puddle-works/.test(rest), false, "a literal org or template");
  assertEquals(/Puddleworks' own/.test(skill), false, "the own-procedure line");
  assertEquals(rest.includes('--author="Claude Code'), false, "fixed author");
  assertEquals(/Co-Authored-By: Claude/.test(rest), false, "fixed trailer");
  assertEquals(skill.includes("sed -i ''"), false, "BSD-only sed -i ''");
});

Deno.test("package: the skill's Settings name each key with its default, and cover no Orca and no secrets", async () => {
  const skill = await Deno.readTextFile(SKILL);
  const settings = skill.slice(skill.indexOf("\n## Settings"));
  for (const key of SETTINGS_KEYS) {
    assertEquals(settings.includes(`"${key}"`), true, key);
  }
  for (
    const d of [
      "puddle-works/puddle-template",
      "SWAMP_API_KEY",
      "SWAMP_SIGNIN_TOKEN",
      "@puddleworks",
    ]
  ) assertEquals(settings.includes(d), true, `default ${d}`);
  assertEquals(skill.includes("factory-build.json"), true);
  assertEquals(skill.includes("git worktree add"), true, "plain worktree");
  assertEquals(
    /\[ -n "\$SECRETS" \]/.test(skill),
    true,
    "secret grant is not guarded",
  );
});

/** The skill's block that reads its settings, as the builder runs it. */
async function settingsBlock(): Promise<string> {
  const skill = await Deno.readTextFile(SKILL);
  const at = skill.indexOf("```bash\nO='{}'");
  return skill.slice(at + "```bash\n".length, skill.indexOf("\n```", at));
}

async function readSettings(file: string | null, args = "{}") {
  const dir = await Deno.makeTempDir({ prefix: "factory-settings-" });
  try {
    if (file !== null) {
      await Deno.writeTextFile(`${dir}/factory-build.json`, file);
    }
    const block = (await settingsBlock()).replace("O='{}'", `O='${args}'`);
    const script = `${block}
echo "$ORG|$TEMPLATE|$SECRETS|$COLLECTIVE"`;
    const out = await new Deno.Command("bash", {
      args: ["-c", script],
      cwd: dir,
      stdout: "piped",
      stderr: "piped",
    }).output();
    return {
      code: out.code,
      stdout: new TextDecoder().decode(out.stdout).trim(),
      stderr: new TextDecoder().decode(out.stderr),
    };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("package: the skill's settings block uses a good factory-build.json and stops on a bad one", async () => {
  const none = await readSettings(null);
  assertEquals(none.code, 0, none.stderr);
  assertEquals(
    none.stdout,
    "puddle-works|puddle-works/puddle-template|SWAMP_API_KEY SWAMP_SIGNIN_TOKEN|@puddleworks",
  );
  const set = await readSettings(
    '{"org":"acme","secrets":["ONE"],"collective":"@acme"}',
  );
  assertEquals(set.code, 0, set.stderr);
  assertEquals(
    set.stdout,
    "acme|puddle-works/puddle-template|ONE|@acme",
  );
  const noSecrets = await readSettings('{"secrets":[]}');
  assertEquals(noSecrets.code, 0, noSecrets.stderr);
  assertEquals(
    noSecrets.stdout,
    "puddle-works|puddle-works/puddle-template||@puddleworks",
  );
  for (
    const bad of ["{not json", '{"secrets":"ONE"}', "[1]", '"x"', "null", ""]
  ) {
    const got = await readSettings(bad);
    assertEquals(got.code === 0, false, `${bad}: ${got.stdout}`);
    assertEquals(got.stdout, "", bad);
    assertEquals(got.stderr.includes("factory-build.json"), true, bad);
  }
});

Deno.test("package: the settings block keeps the arguments of /factory-build over the file, and every call", async () => {
  const file = '{"org":"filed","collective":"@filed"}';
  const got = await readSettings(file, '{"org":"acme"}');
  assertEquals(got.code, 0, got.stderr);
  assertEquals(
    got.stdout,
    "acme|puddle-works/puddle-template|SWAMP_API_KEY SWAMP_SIGNIN_TOKEN|@filed",
  );
  const skill = await Deno.readTextFile(SKILL);
  assertEquals(skill.includes("O='{}'"), true, "the arguments line");
});

Deno.test("package: the settings block refuses a setting it can't use, and a file with two objects", async () => {
  for (
    const bad of [
      '{"org":null}',
      '{"org":""}',
      '{"template":5}',
      '{"worktrees":["git"]}',
      '{"org":"a"}\n{"org":"b"}',
      // Text, but not a value the skill can use (issue #97).
      '{"collective":"acme"}',
      '{"collective":"@Acme"}',
      '{"worktrees":"banana"}',
      '{"org":"acme/apps"}',
      '{"template":"puddle-template"}',
      '{"secrets":["ONE TWO"]}',
      '{"secrets":[1]}',
    ]
  ) {
    const got = await readSettings(bad);
    assertEquals(got.code === 0, false, `${bad}: ${got.stdout}`);
    assertEquals(got.stdout, "", bad);
    assertEquals(got.stderr.includes("factory-build.json"), true, bad);
  }
  const bad = await readSettings("{}", '{"org":null}');
  assertEquals(bad.code === 0, false, bad.stdout);
  const good = await readSettings(
    '{"org":"Acme-2","template":"acme/app.template","collective":"@acme-2","worktrees":"git","secrets":["A_1"]}',
  );
  assertEquals(good.code, 0, good.stderr);
  assertEquals(good.stdout, "Acme-2|acme/app.template|A_1|@acme-2");
});

/** What the skill's secret grant asks of gh in this shell, after its settings block. */
async function grantCalls(shell: string[], secrets: string[]) {
  const skill = await Deno.readTextFile(SKILL);
  const at = skill.indexOf('if [ -n "$SECRETS" ]; then');
  const grant = skill.slice(at, skill.indexOf("\nfi\n", at) + "\nfi".length);
  const dir = await Deno.makeTempDir({ prefix: "factory-grant-" });
  try {
    await Deno.writeTextFile(
      `${dir}/factory-build.json`,
      JSON.stringify({ secrets }),
    );
    await Deno.writeTextFile(
      `${dir}/gh`,
      `#!/bin/sh\n[ "$1" = api ] && [ "$2" = -X ] && echo "$# $3 $4" >>"${dir}/calls"\necho 123\n`,
    );
    await Deno.chmod(`${dir}/gh`, 0o755);
    const out = await new Deno.Command(shell[0], {
      args: [...shell.slice(1), "-c", `${await settingsBlock()}\n${grant}`],
      cwd: dir,
      env: { PATH: `${dir}:${Deno.env.get("PATH")}` },
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(out.code, 0, new TextDecoder().decode(out.stderr));
    const calls = await Deno.readTextFile(`${dir}/calls`).catch(() => "");
    return calls.split("\n").filter(Boolean);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** Whether this shell is installed. CI's runner has no zsh. */
async function hasShell(name: string): Promise<boolean> {
  try {
    const command = new Deno.Command(name, {
      args: ["-c", "exit 0"],
      stdout: "null",
      stderr: "null",
    });
    return (await command.output()).success;
  } catch {
    return false;
  }
}

Deno.test("package: a shell that isn't installed is only skipped", async () => {
  assertEquals(await hasShell("no-such-shell"), false);
  assertEquals(await hasShell("bash"), true);
});

for (
  const shell of [["bash"], ...(await hasShell("zsh") ? [["zsh", "-f"]] : [])]
) {
  Deno.test(`package: the skill grants each secret on its own in ${shell[0]}`, async () => {
    const put = (s: string) =>
      `4 PUT orgs/ORG/actions/secrets/${s}/repositories/123`;
    assertEquals(await grantCalls(shell, ["ONE", "TWO"]), [
      put("ONE"),
      put("TWO"),
    ]);
    assertEquals(await grantCalls(shell, ["ONE"]), [put("ONE")]);
    assertEquals(await grantCalls(shell, []), []);
  });
}

Deno.test("package: the skill doesn't loop over an unquoted $SECRETS, which zsh leaves whole", async () => {
  const skill = await Deno.readTextFile(SKILL);
  assertEquals(/\bin \$SECRETS\b/.test(skill), false);
});

Deno.test("package: the settings block says when it found no factory-build.json", async () => {
  const none = await readSettings(null);
  assertEquals(none.stderr.includes("no factory-build.json"), true);
  const there = await readSettings("{}");
  assertEquals(there.stderr, "");
});

Deno.test("package: the skill says its settings don't last between Bash calls", async () => {
  const skill = await Deno.readTextFile(SKILL);
  assertEquals(skill.replace(/\s+/g, " ").includes("every Bash call"), true);
});

Deno.test("package: the docs follow the settings, not Puddleworks' own values", async () => {
  const rest = await skillOutsideSettings();
  assertEquals(rest.includes("@puddleworks/NAME"), false, "SKILL.md");
  const readme = await Deno.readTextFile(new URL("README.md", ROOT));
  const flatReadme = readme.replace(/\s+/g, " ");
  assertEquals(
    flatReadme.includes("from `puddle-works/puddle-template`"),
    false,
    "README: from the template",
  );
  assertEquals(
    flatReadme.includes("made from `puddle-works/puddle-template`"),
    false,
    "README: made from the template",
  );
  assertEquals(flatReadme.includes("new Orca worktree"), false, "README: Orca");
});

Deno.test("package: the README documents each factory-build setting", async () => {
  const readme = await Deno.readTextFile(new URL("README.md", ROOT));
  assertEquals(readme.includes("factory-build.json"), true);
  for (const key of SETTINGS_KEYS) {
    assertEquals(readme.includes(`\`${key}\``), true, key);
  }
  assertEquals(/Puddleworks' own build procedure/.test(readme), false);
});

// What the draft writes, and what the docs say it writes, must not drift apart.
Deno.test("package: the README and skill say the draft adds a ci.yml and keeps an existing one", async () => {
  const flat = async (path: string) =>
    (await Deno.readTextFile(new URL(path, ROOT))).replace(/\s+/g, " ");
  const readme = await flat("README.md");
  const skill = await flat(".claude/skills/factory-build/SKILL.md");
  assertEquals(
    readme.includes(
      "An existing `LICENSE` or `.github/workflows/ci.yml` is kept",
    ),
    true,
    "README",
  );
  assertEquals(
    skill.includes(
      "`LICENSE` and `.github/workflows/ci.yml` (the template's are kept)",
    ),
    true,
    "SKILL.md",
  );
});

Deno.test("package: the README's commands find deno through swamp, not a fixed path", async () => {
  const readme = await Deno.readTextFile(new URL("README.md", ROOT));
  assertEquals(readme.includes("~/.swamp/deno/deno"), false);
  assertEquals(
    readme.includes("$(swamp doctor extensions --json | jq -r .denoPath) fmt"),
    true,
  );
});

// The visibility check reads the skills the manifest ships; only the others
// are skipped.
Deno.test("package: the skill says the check reads shipped skills, and a Makefile may be absent", async () => {
  const skill = (await Deno.readTextFile(
    new URL(".claude/skills/factory-build/SKILL.md", ROOT),
  )).replace(/\s+/g, " ");
  assertEquals(
    skill.includes("(not `.git`, `.swamp`, `.claude/skills`, `node_modules`)"),
    false,
    "still says no skill is read",
  );
  assertEquals(
    skill.includes("skills the manifest doesn't ship"),
    true,
    "says which skills are skipped",
  );
  assertEquals(
    skill.includes("the `test` target of `W/Makefile` if it has one"),
    true,
  );
});

Deno.test("package: every model create sets typeScope, since it names the app's collective", async () => {
  const readme = await Deno.readTextFile(new URL("README.md", ROOT));
  const skill = await Deno.readTextFile(
    new URL(".claude/skills/factory-build/SKILL.md", ROOT),
  );
  const creates = (text: string) =>
    text.split("\n").filter((l) => l.includes("swamp model create"));
  const readmeCreates = creates(readme);
  assertEquals(readmeCreates.length > 0, true);
  for (const line of readmeCreates) {
    assertEquals(
      line.includes("--global-arg 'typeScope=\\@YOUR-COLLECTIVE'"),
      true,
      `README: ${line}`,
    );
  }
  assertEquals(
    readme.includes("collective") && readme.includes("defaults to"),
    true,
    "README says what typeScope is and what it defaults to",
  );
  const skillCreates = creates(skill);
  assertEquals(skillCreates.length > 0, true);
  for (const line of skillCreates) {
    assertEquals(
      line.includes('--global-arg "typeScope=\\\\$COLLECTIVE"'),
      true,
      `SKILL.md: ${line}`,
    );
  }
});

Deno.test("package: the README links ADR-001, and no ADR reference points at a missing file", async () => {
  const readme = await Deno.readTextFile(new URL("README.md", ROOT));
  assertEquals(
    readme.includes("docs/adr/ADR-001-three-separate-apps.md"),
    true,
    "README does not link ADR-001",
  );
  const adrs: string[] = [];
  for await (const e of Deno.readDir(new URL("docs/adr/", ROOT))) {
    adrs.push(e.name);
  }
  const texts = [
    readme,
    await Deno.readTextFile(SKILL),
    ...(await Promise.all(
      adrs.map((n) => Deno.readTextFile(new URL(`docs/adr/${n}`, ROOT))),
    )),
  ];
  const cited = new Set(
    texts.flatMap((t) => [...t.matchAll(/\bADR-(\d{3})\b/g)].map((m) => m[1])),
  );
  for (const id of cited) {
    assertEquals(
      adrs.some((n) => n.startsWith(`ADR-${id}-`)),
      true,
      `ADR-${id} is cited but docs/adr has no such file`,
    );
  }
});

// swamp reads a value that starts with @ as a file to load, so a collective
// must be escaped or the command stops with "Input file not found".
Deno.test("package: no command passes swamp an unescaped @ value", async () => {
  const unescaped = (line: string) =>
    /--(global-arg|input)\s+['"]?\w+=@/.test(line);
  for (
    const line of [
      "--global-arg typeScope=@acme",
      "--global-arg 'typeScope=@acme'",
      '--input spec="$X" --input ref=@acme/app',
    ]
  ) assertEquals(unescaped(line), true, line);
  for (
    const line of [
      "--global-arg 'typeScope=\\@acme'",
      '--global-arg "typeScope=\\\\$COLLECTIVE"',
      "swamp model create @acme/draft name --json",
      "--input ref=https://x.example/@acme",
      "--input name=app",
    ]
  ) assertEquals(unescaped(line), false, line);
  for (
    const file of [
      "README.md",
      ".claude/skills/factory-build/SKILL.md",
      "docs/contracts/build-result.md",
    ]
  ) {
    const text = await Deno.readTextFile(new URL(file, ROOT));
    assertEquals(text.split("\n").filter(unescaped), [], file);
  }
});

Deno.test("package: the docs say the draft writes a recipe and readiness checks it", async () => {
  const flat = async (path: string) =>
    (await Deno.readTextFile(new URL(path, ROOT))).replace(/\s+/g, " ");
  const readme = await flat("README.md");
  const skill = await flat(".claude/skills/factory-build/SKILL.md");
  const result = await flat("docs/contracts/build-result.md");
  const appSpec = await flat("docs/contracts/app-spec.md");
  for (const [name, text] of [["README", readme], ["SKILL.md", skill]]) {
    assertEquals(text.includes("-recipe.yaml"), true, name);
    assertEquals(text.includes("each.line"), true, name);
    assertEquals(text.includes("puddlerouter-recipe"), true, name);
    assertEquals(text.includes("in a throwaway"), true, name);
  }
  assertEquals(appSpec.includes("`specification.recipe`"), true);
  assertEquals(result.includes("from the latest readiness check"), true);
  assertEquals(result.includes("runs the app only if"), true);
  for (const [name, text] of [["README", readme], ["SKILL.md", skill]]) {
    assertEquals(text.includes("effects-read"), true, name);
    assertEquals(text.includes("latest stored result"), true, name);
    assertEquals(text.includes("10 s"), true, name);
  }
  assertEquals(skill.includes("give each piece an input"), true);
  assertEquals(skill.includes("the engine refuses it"), false, "SKILL.md");
  assertEquals(appSpec.includes("the recipe's tag"), true, "app-spec.md");
});
