/**
 * Tests for the visibility assessment: whether a built app looks fit to share
 * publicly, or should stay private.
 *
 * Run with:
 *   ~/.swamp/deno/deno test -A extensions/lib/visibility_test.ts
 *
 * @module
 */
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { assessVisibility, type RepoFacts, scanFile } from "./visibility.ts";

const MANIFEST = `manifestVersion: 1
name: "@puddleworks/obsidian-puddle-scanner"
version: "2026.10.26.1"
repository: "https://github.com/puddle-works/obsidian-puddle-scanner"
license: MIT
visibility: private
models:
  - obsidian_puddle_scanner.ts
`;

const OUTCOME = JSON.stringify(
  {
    format: "puddleworks.dev/outcome-spec/v1",
    specification: {
      problemStatement: "Tasks in notes get lost.",
      scope: { in: ["Listing open tasks"], out: ["Editing the vault"] },
      constraints: ["Runs on a laptop"],
      assumptions: [],
    },
    participants: [{ name: "Priya Shah", email: "priya@example.com" }],
  },
  null,
  2,
);

/** A clean app: every required check passes and nothing looks internal. */
function facts(overrides: Partial<RepoFacts> = {}): RepoFacts {
  return {
    files: [
      { path: "manifest.yaml", text: MANIFEST },
      { path: "LICENSE", text: "MIT License\n" },
      { path: "README.md", text: "# obsidian-puddle-scanner\n" },
      {
        path: "extensions/models/obsidian_puddle_scanner.ts",
        text: 'const where = "/tmp/vault";\n',
      },
      { path: "spec/outcome-spec.v1.json", text: OUTCOME },
    ],
    quality: 100,
    repoVisibility: "private",
    ...overrides,
  };
}

const replace = (path: string, text: string) =>
  facts().files.map((f) => (f.path === path ? { path, text } : f));

const check = (a: ReturnType<typeof assessVisibility>, id: string) =>
  a.checks.find((c) => c.id === id)!;

Deno.test("visibility: a clean app is recommended public", () => {
  const a = assessVisibility(facts());
  assertEquals(a.recommendation, "public");
  assertEquals(a.canBePublic, true);
  assertEquals(a.manifestVisibility, "private");
  assertEquals(a.findings, []);
  assertEquals(
    a.checks.map((c) => [c.id, c.role, c.ok]),
    [
      ["licence", "required", true],
      ["repository", "required", true],
      ["quality", "required", true],
      ["secrets", "required", true],
      ["internal-details", "signal", true],
      ["audience", "signal", true],
      ["repo-visibility", "info", true],
    ],
  );
});

Deno.test("visibility: no LICENSE file means it cannot be public", () => {
  const a = assessVisibility(
    facts({ files: facts().files.filter((f) => f.path !== "LICENSE") }),
  );
  assertEquals(a.recommendation, "private");
  assertEquals(a.canBePublic, false);
  assertEquals(check(a, "licence").ok, false);
  assertStringIncludes(check(a, "licence").detail, "LICENSE");
});

Deno.test("visibility: no license or repository in the manifest is refused", () => {
  const bare = MANIFEST.replace(/^repository:.*\n/m, "").replace(
    /^license:.*\n/m,
    "",
  );
  const a = assessVisibility(facts({ files: replace("manifest.yaml", bare) }));
  assertEquals(check(a, "licence").ok, false);
  assertEquals(check(a, "repository").ok, false);
  assertEquals(a.canBePublic, false);
});

Deno.test("visibility: a missing manifest fails every manifest check", () => {
  const a = assessVisibility(
    facts({ files: facts().files.filter((f) => f.path !== "manifest.yaml") }),
  );
  assertEquals(a.manifestVisibility, null);
  assertEquals(check(a, "licence").ok, false);
  assertEquals(check(a, "repository").ok, false);
  assertStringIncludes(check(a, "repository").detail, "manifest.yaml");
});

Deno.test("visibility: quality below 100% cannot be public", () => {
  const a = assessVisibility(facts({ quality: 93 }));
  assertEquals(check(a, "quality").ok, false);
  assertStringIncludes(check(a, "quality").detail, "93%");
  assertEquals(a.canBePublic, false);
});

Deno.test("visibility: an internal detail recommends private but allows public", () => {
  const a = assessVisibility(
    facts({
      files: replace(
        "extensions/models/obsidian_puddle_scanner.ts",
        'const where = "/Users/alice/vault";\n',
      ),
    }),
  );
  assertEquals(a.recommendation, "private");
  assertEquals(a.canBePublic, true);
  assertEquals(check(a, "internal-details").ok, false);
  assertEquals(a.findings, [{
    file: "extensions/models/obsidian_puddle_scanner.ts",
    line: 1,
    kind: "home-path",
    text: 'const where = "/Users/alice/vault";',
  }]);
});

Deno.test("visibility: a secret blocks public and its text is not repeated", () => {
  const key = ["AKIA", "Q".repeat(16)].join("");
  const a = assessVisibility(
    facts({ files: replace("README.md", `# app\n\nkey ${key}\n`) }),
  );
  assertEquals(check(a, "secrets").ok, false);
  assertEquals(a.canBePublic, false);
  assertEquals(a.findings.length, 1);
  assertEquals(a.findings[0].kind, "secret");
  assertEquals(a.findings[0].line, 3);
  assertEquals(a.findings[0].text.includes(key), false);
});

Deno.test("scan: no finding repeats a secret on its line", () => {
  const token = ["ghp_", "a".repeat(36)].join("");
  const findings = scanFile(
    "README.md",
    `push as alice@acme.io with ${token} from /Users/alice/ to 10.0.0.5\n`,
  );
  assertEquals(
    findings.map((f) => f.kind),
    ["email", "secret", "home-path", "private-ip"],
  );
  for (const f of findings) assertEquals(f.text.includes(token), false);
});

Deno.test("visibility: spec wording with a secret in it is not repeated", () => {
  const token = ["ghp_", "b".repeat(36)].join("");
  const internal = OUTCOME.replace(
    "Runs on a laptop",
    `Confidential: use ${token}`,
  );
  const a = assessVisibility(
    facts({ files: replace("spec/outcome-spec.v1.json", internal) }),
  );
  const audience = a.findings.filter((f) => f.kind === "audience");
  assertEquals(audience.length, 1);
  assertEquals(audience[0].text.includes(token), false);
  assertEquals(JSON.stringify(a).includes(token), false);
});

Deno.test("visibility: spec wording about who it is for recommends private", () => {
  const internal = OUTCOME.replace(
    "Runs on a laptop",
    "Only for our team; the data is confidential",
  );
  const a = assessVisibility(
    facts({ files: replace("spec/outcome-spec.v1.json", internal) }),
  );
  assertEquals(check(a, "audience").ok, false);
  assertEquals(a.recommendation, "private");
  assertEquals(a.canBePublic, true);
  const found = a.findings.filter((f) => f.kind === "audience");
  assertEquals(found.length, 1);
  assertEquals(found[0].file, "spec/outcome-spec.v1.json");
  assertStringIncludes(found[0].text, "our team");
});

Deno.test("visibility: a real address in the spec is an internal detail", () => {
  const real = OUTCOME.replace("priya@example.com", "priya@acme-stores.co.uk");
  const a = assessVisibility(
    facts({ files: replace("spec/outcome-spec.v1.json", real) }),
  );
  assertEquals(check(a, "internal-details").ok, false);
  assertEquals(a.findings.map((f) => f.kind), ["email"]);
});

Deno.test("visibility: a repo that does not match the manifest is reported, not decided on", () => {
  const a = assessVisibility(facts({ repoVisibility: "public" }));
  assertEquals(check(a, "repo-visibility").ok, false);
  assertStringIncludes(check(a, "repo-visibility").detail, "public");
  assertEquals(a.recommendation, "public");
});

Deno.test("scan: finds each kind of internal detail", () => {
  const ghToken = ["ghp", "_", "a".repeat(36)].join("");
  const text = [
    "see http://build.corp/status",
    "or 10.2.3.4 and 192.168.1.20",
    "files in /home/bob/data and C:\\Users\\bob\\data",
    "mail ops@acme.io or nobody@example.com or noreply@acme.io",
    `token ${ghToken}`,
    "-----BEGIN RSA PRIVATE KEY-----",
    "localhost:8080 and 127.0.0.1 are fine",
  ].join("\n");
  assertEquals(
    scanFile("x.md", text).map((f) => [f.line, f.kind]),
    [
      [1, "internal-host"],
      [2, "private-ip"],
      [2, "private-ip"],
      [3, "home-path"],
      [3, "home-path"],
      [4, "email"],
      [5, "secret"],
      [6, "secret"],
    ],
  );
});

Deno.test("scan: a file name like settings.local.json is not a host", () => {
  const text =
    ".claude/settings.local.json\nconfig.internal.yaml\nnas.local:445\nsee build.corp.";
  assertEquals(
    scanFile(".gitignore", text).map((f) => [f.line, f.kind]),
    [[3, "internal-host"], [4, "internal-host"]],
  );
});
