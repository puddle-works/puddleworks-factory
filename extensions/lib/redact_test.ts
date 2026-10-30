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
import {
  hideSecrets,
  linkProblem,
  safeText,
  secretSpans,
  shownUrl,
} from "./redact.ts";

Deno.test("redact: a URL in text loses its login and secret query, whatever its case", () => {
  assertEquals(
    safeText(
      "read HTTPS://user:pw@specs.acme.io/a.json?token=SEKRET1 and Http://h.io/x?k=v",
    ),
    "read https://specs.acme.io/a.json and http://h.io/x?k=v",
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
      "Q9x7Kp2mZr4Lw8Vb3nYtAb12",
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
      "OAUTH_TOKEN_ENDPOINT: https://login.microsoftonline.com/common/oauth2/v2.0/token",
      "DB_PASSWORD_SECRET_ARN: arn:aws:secretsmanager:eu-west-1:123456789012:secret:db-AbCdEf",
      "API_TOKEN=xxxxxxxxxxxxxxxx",
      "API_TOKEN=********",
      "API_TOKEN=REPLACE_ME_TOKEN",
      "API_TOKEN=TODO_SET_ME",
      "GITHUB_TOKEN: secrets.GITHUB_TOKEN",
      "  token: z.string(),",
      "  password: args.password,",
      "  password: input.password",
      "  secret: string;",
      "maxTokens: 1000000",
      "tokenizer: cl100k_base",
      "token: optional",
      'const token = Deno.env.get("GITHUB_TOKEN");',
      "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      `"adminPassword": "[parameters('adminPassword')]"`,
      'swamp list ${token:+--token "${token}"} --json',
      "echo ${API_TOKEN:-unset-value}",
      "apiToken: puddle/SCANNER_TOKEN",
      '{ "sas_token": "SAS_TOKEN" }',
      '{ "secret_access_key": "SECRET_ACCESS_KEY" }',
      'VAULT_SECRET_KEY: "vault.secret_key",',
      'const apiToken = overrides?.apiToken ?? Deno.env.get("API_TOKEN");',
      "task reset_password: :environment do",
      "const token = ++reloads;",
      "KPI_DATABASE_PASSWORD=password mvn spring-boot:run",
      'export const ACCESS_TOKEN = "access_token";',
      'const AUTH_TOKEN = "authToken";',
      'const CSRF_TOKEN = "X-CSRF-Token";',
      'const header_token = "X-Auth-Token";',
      'const CSRF_TOKEN = "XSRF-TOKEN";',
      'const TOKEN = "accessToken";',
      'const COOKIE_TOKEN = "session_token";',
    ]
  ) {
    assertEquals(hideSecrets(t), t);
  }
});

Deno.test("redact: a placeholder user does not excuse a real password", () => {
  for (
    const t of [
      "DATABASE_URL=postgres://${POSTGRES_USER}:Xk29vLq83mZp@db.acme.com:5432/app",
      "https://<user>:Xk29vLq83mZp@git.acme.com/repo.git",
      "https://your-user:Xk29vLq83mZp@git.acme.com/repo.git",
    ]
  ) {
    assertEquals(hideSecrets(t).includes("Xk29vLq83mZp"), false, t);
    assertEquals(safeText(t).includes("Xk29vLq83mZp"), false, t);
  }
});

Deno.test("redact: a password the URL parser reads as a port is hidden", () => {
  for (
    const t of [
      "https://deploy:1234#abcXYZ@git.acme.com/repo",
      "https://deploy:1234/abcXYZ@git.acme.com/repo",
      "https://deploy:1234?abcXYZ@git.acme.com/repo",
    ]
  ) {
    const shown = safeText(t);
    assertEquals(shown.includes("1234"), false, shown);
    assertEquals(shown.includes("abcXYZ"), false, shown);
    assertEquals(hideSecrets(t).includes("abcXYZ"), false, t);
  }
  // A path with an email in it is not a password.
  for (
    const t of [
      "https://jenkins.acme.io:8080/user/bob@acme.io",
      "https://acme.io/u/bob@acme.io",
    ]
  ) {
    assertEquals(hideSecrets(t), t);
  }
});

Deno.test("redact: a secret's name on its own or in any case is a secret", () => {
  for (
    const t of [
      "PASSWORD=Xk29vLq83mZp",
      "TOKEN=Xk29vLq83mZp",
      "SECRET=Xk29vLq83mZp",
      "API_KEY=Xk29vLq83mZp",
      "db_password: Xk29vLq83mZp",
      "password: Xk29vLq83mZp",
      '{"user": "a", "password": "Xk29vLq83mZp"}',
      "export db_password=Xk29vLq83mZp",
      'githubToken: "Xk29vLq83mZp"',
      'client_secret = "Xk29vLq83mZp"',
      "  - SWAMP_API_KEY=Xk29vLq83mZp",
      "user.password = Xk29vLq83mZp;",
      "  token: Xk29vLq83mZp,",
    ]
  ) {
    const shown = hideSecrets(t);
    assertEquals(shown.includes("Xk29vLq83mZp"), false, t);
    assertEquals(shown.includes("(hidden)"), true, t);
  }
});

Deno.test("redact: a private key is hidden to its end", () => {
  const pem = [
    "key:",
    "-----BEGIN RSA PRIVATE KEY-----",
    "MIIEowIBAAKCAQEA1x2y3z",
    "-----END RSA PRIVATE KEY-----",
    "after",
  ].join("\n");
  const shown = safeText(pem);
  assertEquals(shown.includes("MIIEowIBAAKCAQEA1x2y3z"), false, shown);
  assertEquals(shown.startsWith("key:\n"), true, shown);
  assertEquals(shown.endsWith("\nafter"), true, shown);
  const json =
    '{"key": "-----BEGIN PRIVATE KEY-----\\nMIIEvQIBADANBg\\n-----END PRIVATE KEY-----\\n", "x": 1}';
  const hidden = safeText(json);
  assertEquals(hidden.includes("MIIEvQIBADANBg"), false, hidden);
  assertEquals(hidden.includes('"x": 1'), true, hidden);
});

Deno.test("redact: a URL keeps a query that holds no secret", () => {
  assertEquals(
    shownUrl("https://capture.acme.io/requests?id=42"),
    "https://capture.acme.io/requests?id=42",
  );
  assertEquals(
    shownUrl(
      "https://x.io/a?id=42&token=abc&sig=Q9x&t=Q9x7Kp2mZr4Lw8Vb3nYt&k=ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&page=2#frag",
    ),
    "https://x.io/a?id=42&page=2",
  );
});

Deno.test("redact: a hidden secret does not cut a URL short", () => {
  const sig =
    "9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0";
  for (
    const [t, gone, kept] of [
      [
        `Reading https://b.s3.amazonaws.com/spec.md?X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20261030&X-Amz-Signature=${sig}`,
        sig,
        "https://b.s3.amazonaws.com/spec.md",
      ],
      [
        "at https://x.io/cb?id_token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlMTIz&session=opaqueSess10nValue",
        "opaqueSess10nValue",
        "https://x.io/cb",
      ],
      [
        "see https://en.wikipedia.org/wiki/Foo_(bar)?token=s3cretvalue123",
        "s3cretvalue123",
        "https://en.wikipedia.org/wiki/Foo_(bar)",
      ],
    ]
  ) {
    const shown = safeText(t);
    assertEquals(shown.includes(gone), false, shown);
    assertEquals(shown.includes(kept), true, shown);
  }
  assertEquals(
    safeText("(see https://x.io/a?id=1)"),
    "(see https://x.io/a?id=1)",
  );
});

Deno.test("redact: secrets assigned in code, headers and connection strings are hidden", () => {
  for (
    const [t, secret] of [
      ['const API_KEY = "sk_9f8e7d6c5b4a39281706";', "sk_9f8e7d6c5b4a39281706"],
      ['let dbPassword = "Tr0ub4dor&3x";', "Tr0ub4dor&3x"],
      [
        '"Server=db.acme.io;User Id=sa;Password=Pa55word123;"',
        "Pa55word123",
      ],
      [
        'Authorization: "Bearer 9f8e7d6c5b4a39281706abc"',
        "9f8e7d6c5b4a39281706abc",
      ],
      [
        'curl -H "X-API-Key: 9f8e7d6c5b4a39281706abc" https://api.acme.io',
        "9f8e7d6c5b4a39281706abc",
      ],
      [
        "DefaultEndpointsProtocol=https;AccountName=acme;AccountKey=Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MA==;EndpointSuffix=core.windows.net",
        "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MA",
      ],
      [
        "-----BEGIN PGP PRIVATE KEY BLOCK-----\nlQOYBF9x2abc\n-----END PGP PRIVATE KEY BLOCK-----",
        "lQOYBF9x2abc",
      ],
    ]
  ) {
    const shown = hideSecrets(t);
    assertEquals(shown.includes(secret), false, t);
    assertEquals(shown.includes("(hidden)"), true, t);
  }
});

Deno.test("redact: a weak password is still a secret", () => {
  for (
    const [t, secret] of [
      ['password: "password123"', "password123"],
      ["PASSWORD=Summer2024", "Summer2024"],
      ['const API_TOKEN = "Summer2024token";', "Summer2024token"],
      ["PASSWORD=Password1", "Password1"],
      ['"password": "password1"', "password1"],
      ["MYSQL_ROOT_PASSWORD: password1", "password1"],
      ["password = Summer2024", "Summer2024"],
      ["spring.datasource.password = Welcome2024", "Welcome2024"],
      ['"Server=db.acme.io;User Id=sa;Password=Summer2024;"', "Summer2024"],
      ["Pwd=Secret_Pass_2024;Encrypt=true", "Secret_Pass_2024"],
      ["DB_PASSWORD = Summer2024", "Summer2024"],
      ["token = AbcDefGhiJkl123", "AbcDefGhiJkl123"],
    ]
  ) {
    assertEquals(hideSecrets(t).includes(secret), false, t);
  }
});

Deno.test("redact: in source code a value without quotes is code, not a secret", () => {
  for (
    const t of [
      "  secretKey: Uint8Array;",
      "  secretKey: Uint8Array",
      "const privateKey: Uint8Array = ed.utils.randomPrivateKey();",
      "  apiKey: Base64Url;",
      "  password?: HashedPassword,",
      "this.token = refresh_token;",
      "user.password = hashed_password;",
      "self.token = refresh_token",
      "function sign(opts: { secretKey: Uint8Array }) {",
      "type Token = { secret: Uint8Array };",
      "return { token: access_token };",
      "Client(api_key=api_key_v2, timeout=30)",
      "  client_secret: client_secret_v2,",
      '{"password": hashed_pw, "user": u}',
    ]
  ) {
    assertEquals(secretSpans(t, { code: true }), [], t);
  }
  for (
    const [t, secret] of [
      [
        'const cs = "Server=db.acme.io;User Id=sa;Password=Summer2024;";',
        "Summer2024",
      ],
      ['const password = "Summer2024";', "Summer2024"],
      ["db_url = 'postgres://app:Summer2024@db.acme.io/app'", "Summer2024"],
    ]
  ) {
    const spans = secretSpans(t, { code: true });
    assertEquals(
      spans.some(([s, e]) => t.slice(s, e).includes(secret)),
      true,
      t,
    );
  }
});
