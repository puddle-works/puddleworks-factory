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
import { linkProblem, safeText } from "./redact.ts";

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
    "push (hidden) to (hidden)cache.prod.acme.io:6379",
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
