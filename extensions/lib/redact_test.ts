/**
 * Tests for what text may be stored, logged and shown: secrets hidden, URLs
 * without their login or query.
 *
 * Run with:
 *   ~/.swamp/deno/deno test -A extensions/lib/redact_test.ts
 *
 * @module
 */
import { assertEquals } from "jsr:@std/assert@1.0.19";
import { hideSecrets, linkProblem, safeText, shownUrl } from "./redact.ts";

Deno.test("redact: a URL in text loses its login and query, whatever its case", () => {
  assertEquals(
    safeText(
      "read HTTPS://user:pw@specs.acme.io/a.json?token=SEKRET1 and Http://h.io/x?k=v",
    ),
    "read https://specs.acme.io/a.json and http://h.io/x",
  );
});

Deno.test("redact: a URL that does not parse still loses its login", () => {
  const shown = safeText("https://deploy:hunter2@github.com:abc/acme/app");
  assertEquals(shown.includes("hunter2"), false, shown);
  assertEquals(shown.includes("deploy"), false, shown);
});

Deno.test("redact: secrets in text are hidden", () => {
  const token = ["ghp_", "g".repeat(36)].join("");
  assertEquals(
    safeText(`push ${token} to redis://:s3cretpass@cache.prod.acme.io:6379`),
    "push (hidden) to redis://cache.prod.acme.io:6379",
  );
});

Deno.test("redact: a link must be a plain https URL", () => {
  assertEquals(linkProblem("https://github.com/acme/app/pull/1"), null);
  assertEquals(linkProblem("git@github.com:acme/app.git"), "is not a URL");
  assertEquals(linkProblem("http://github.com/acme/app"), "is not https");
  assertEquals(
    linkProblem("https://deploy:hunter2@github.com:abc/acme/app"),
    "is not a URL",
  );
  assertEquals(
    linkProblem("https://bot@github.com/acme/app"),
    "has a login in it",
  );
  assertEquals(
    linkProblem("https://github.com/acme/app?access_token=SEKRET"),
    "has a query or fragment in it",
  );
  assertEquals(
    linkProblem("https://github.com/acme/app#token=SEKRET"),
    "has a query or fragment in it",
  );
});

Deno.test("redact: a URL whose password breaks parsing shows nothing of the login", () => {
  for (
    const url of [
      "https://user:se#cretPART@host.example.org/spec.json",
      "https://user:pa?ssWORD@capture.acme.io/spec.json",
      "https://tok:abc/defSECRET@capture.acme.io/x",
    ]
  ) {
    const shown = shownUrl(url);
    assertEquals(
      /user|tok|:se|:pa|:abc|PART|WORD|SECRET/.test(shown),
      false,
      shown,
    );
  }
  assertEquals(
    shownUrl("https://tok:abc/defSECRET@capture.acme.io/x"),
    "https://capture.acme.io/x",
  );
});

Deno.test("redact: a URL of any scheme loses its login and query", () => {
  for (
    const text of [
      "ftp://capture.acme.io/x?token=SEKRET1",
      "wss://bot:SEKRET2@capture.acme.io/socket",
    ]
  ) {
    const shown = safeText(text);
    assertEquals(/SEKRET/.test(shown), false, shown);
    assertEquals(shown.includes("capture.acme.io"), true, shown);
  }
  assertEquals(
    safeText("ssh://git@github.com/acme/app.git"),
    "ssh://github.com/acme/app.git",
  );
});

Deno.test("redact: common token shapes are secrets", () => {
  const tokens = [
    ["sk_live_", "a1".repeat(12)],
    ["rk_live_", "b2".repeat(12)],
    ["AIza", "Sy", "c".repeat(33)],
    ["glpat-", "d4".repeat(10)],
    ["npm_", "e5".repeat(18)],
    ["sk-proj-", "f6".repeat(20)],
    [
      "eyJhbGciOiJIUzI1NiJ9",
      ".",
      "eyJzdWIiOiIxMjM0NTY3ODkwIn0",
      ".",
      "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
    ],
    [
      '"SecretAccessKey": "',
      "wJalrXUtnFEMI/K7MDENG/bPxRfiCY",
      "EXAMPLEKEY",
      '"',
    ],
    ["DB_PASSWORD=", "Tr0ub4dor&3xyz"],
    [
      "https://hooks.slack.com/services/",
      "T00000000/B00000000/",
      "XXXXXXXXXXXXXXXXXXXXXXXX",
    ],
    ["token_", "ghp_", "g".repeat(36)],
    ["admin:", "hunter2", "@localhost:5432"],
  ].map((parts) => parts.join(""));
  for (const t of tokens) {
    const shown = hideSecrets(`x\n${t}\ny`);
    assertEquals(shown.includes("(hidden)"), true, t);
  }
});

Deno.test("redact: placeholders and package specifiers are not secrets", () => {
  for (
    const t of [
      "GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}",
      "DB_PASSWORD=",
      "DB_PASSWORD=${DB_PASSWORD}",
      "API_TOKEN=<your token>",
      'import { z } from "npm:zod@4";',
      "sk-ant is a prefix",
      "the password field",
      "export API_TOKEN=your-token-here",
      "POSTGRES_PASSWORD_FILE=/run/secrets/db_password",
      'member: "serviceAccount:deploy@acme-prod.iam.gserviceaccount.com"',
      "user:alice@acme.io",
      'git.push("https://mesgme:%s@github.com/acme/app.git")',
    ]
  ) {
    assertEquals(hideSecrets(t), t);
  }
});
