/**
 * The published package ships the README but not the rest of the repo, so
 * what the README points at must be shipped too, or be an absolute URL.
 */
import { assertEquals } from "jsr:@std/assert@1.0.19";
import { parse } from "jsr:@std/yaml@1.0.12";

const ROOT = new URL("../../", import.meta.url);

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

Deno.test("package: the skill says it is Puddleworks' own procedure, and runs on any sed", async () => {
  const skill = await Deno.readTextFile(
    new URL(".claude/skills/factory-build/SKILL.md", ROOT),
  );
  const body = skill.slice(skill.indexOf("\n---", 3) + 4);
  const intro = body.trimStart().split("\n\n").slice(0, 3).join("\n\n");
  assertEquals(/Puddleworks' own/.test(intro), true, intro);
  assertEquals(skill.includes("sed -i ''"), false, "BSD-only sed -i ''");
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
      line.includes("--global-arg typeScope=@YOUR-COLLECTIVE"),
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
      line.includes("--global-arg typeScope=@puddleworks"),
      true,
      `SKILL.md: ${line}`,
    );
  }
});
