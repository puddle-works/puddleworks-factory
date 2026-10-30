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
    text: "/Users/alice/",
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

Deno.test("scan: a finding stores what it found, not the line", () => {
  const findings = scanFile(
    "README.md",
    "push as bob@acme.io from /Users/alice/ to 10.0.0.5 on nas.internal\n",
  );
  assertEquals(
    findings.map((f) => [f.kind, f.text]),
    [
      ["email", "…@acme.io"],
      ["home-path", "/Users/alice/"],
      ["private-ip", "10.0.0.5"],
      ["internal-host", "nas.internal"],
    ],
  );
});

Deno.test("scan: secrets it has no pattern for are not stored either", () => {
  const password = "S3cretPassw0rd";
  const text = [
    `export KEY=${"wJalrXUtnFEMI" + "K7MDENGbPxRfiCY"} # from /Users/alice/`,
    `postgres://admin:${password}@db.internal:5432`,
  ].join("\n");
  const stored = JSON.stringify(scanFile("x.env", text));
  assertEquals(stored.includes("wJalrXUtnFEMI"), false);
  assertEquals(stored.includes(password), false);
});

Deno.test("scan: a password in a URL is a secret, not an email", () => {
  const text = [
    "postgres://admin:S3cretPassw0rd@db.internal:5432",
    "https://deploy:pw@10.1.2.3/",
    "see https://user:pass@example.com/ in the docs",
  ].join("\n");
  assertEquals(
    scanFile("x.md", text).map((f) => [f.line, f.kind, f.text]),
    [
      [1, "secret", "(hidden)"],
      [1, "internal-host", "db.internal"],
      [2, "secret", "(hidden)"],
      [2, "private-ip", "10.1.2.3"],
    ],
  );
});

Deno.test("scan: more key shapes are secrets", () => {
  const text = [
    ["sk-ant-", "api03-", "c".repeat(40)].join(""),
    ["ghp_", "d".repeat(36), "_x"].join(""),
    ["AKIA", "R".repeat(16), "_x"].join(""),
    ["aws_secret_access_key", " = ", "e".repeat(40)].join(""),
  ].join("\n");
  assertEquals(
    scanFile("x.md", text).map((f) => [f.line, f.kind]),
    [[1, "secret"], [2, "secret"], [3, "secret"], [4, "secret"]],
  );
});

Deno.test("visibility: spec wording stores the words that matched, not the sentence", () => {
  const internal = OUTCOME.replace(
    "Runs on a laptop",
    "Only for our team; ask Sam on 07700 900123",
  );
  const a = assessVisibility(
    facts({ files: replace("spec/outcome-spec.v1.json", internal) }),
  );
  const found = a.findings.filter((f) => f.kind === "audience");
  assertEquals(found.map((f) => f.text), ["our team"]);
});

Deno.test("visibility: the secrets check names what it did not read", () => {
  const a = assessVisibility(
    facts({ notRead: [".claude/skills/", "data/big.json (over 512 KB)"] }),
  );
  assertEquals(check(a, "secrets").ok, true);
  assertStringIncludes(
    check(a, "secrets").detail,
    "not read: .claude/skills/, data/big.json (over 512 KB)",
  );
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

Deno.test("scan: an email is stored as its domain only", () => {
  const stored = JSON.stringify(
    scanFile("x.md", "mail bob.smith@acme.io or priya@shop.acme.co.uk\n"),
  );
  assertEquals(stored.includes("bob.smith"), false);
  assertEquals(stored.includes("priya"), false);
  assertEquals(
    scanFile("x.md", "mail bob.smith@acme.io\n").map((f) => f.text),
    ["…@acme.io"],
  );
});

Deno.test("scan: a password with @ in it is hidden up to the last @", () => {
  const findings = scanFile(
    "x.env",
    "postgres://admin:P@ssw0rd@db.acme.io:5432/app\n",
  );
  const stored = JSON.stringify(findings);
  assertEquals(stored.includes("ssw0rd"), false);
  assertEquals(findings.map((f) => f.kind), ["secret"]);
});

Deno.test("scan: a user:password@host with no scheme is a secret", () => {
  const text = [
    "REDIS=default:pw@redis.prod.com:6379",
    "cache admin:hunter2@10.0.0.9",
  ].join("\n");
  const findings = scanFile("x.env", text);
  const stored = JSON.stringify(findings);
  for (const s of ["default:pw", "hunter2", "pw@redis"]) {
    assertEquals(stored.includes(s), false, s);
  }
  assertEquals(
    findings.map((f) => [f.line, f.kind]),
    [[1, "secret"], [2, "secret"], [2, "private-ip"]],
  );
});

Deno.test("scan: package specifiers and mailto links are not passwords", () => {
  const text = [
    'import _ from "npm:lodash-es@4.17.21";',
    'import { z } from "npm:zod@4";',
    'import { parse } from "jsr:@std/yaml@1.0.12";',
    "[mail](mailto:help@example.com)",
  ].join("\n");
  assertEquals(scanFile("x.ts", text), []);
});

Deno.test("visibility: no check detail repeats a secret from the manifest", () => {
  const token = ["ghp_", "f".repeat(36)].join("");
  const manifest = MANIFEST.replace(
    "https://github.com/puddle-works/obsidian-puddle-scanner",
    `https://x-access-token:${token}@github.com/puddle-works/obsidian-puddle-scanner`,
  ).replace("license: MIT", "license: MIT admin:hunter2@db.acme.io");
  const a = assessVisibility(
    facts({
      files: replace("manifest.yaml", manifest),
      notRead: [`data/${token}.bin (binary)`],
    }),
  );
  const shown = JSON.stringify(a.checks);
  assertEquals(shown.includes(token), false);
  assertEquals(shown.includes("hunter2"), false);
  assertEquals(shown.includes("x-access-token"), false);
});

Deno.test("visibility: a repository with a login in it is refused", () => {
  for (
    const login of ["x-access-token:tok", "alice", "alice:pw"]
  ) {
    const manifest = MANIFEST.replace(
      "https://github.com/",
      `https://${login}@github.com/`,
    );
    const a = assessVisibility(
      facts({ files: replace("manifest.yaml", manifest) }),
    );
    const repo = check(a, "repository");
    assertEquals(repo.ok, false, login);
    assertEquals(a.canBePublic, false);
    assertEquals(repo.detail.includes(login), false, repo.detail);
    assertStringIncludes(
      repo.detail,
      "https://github.com/puddle-works/obsidian-puddle-scanner",
    );
  }
});
