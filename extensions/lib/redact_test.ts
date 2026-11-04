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
      'git.push("https://deploy:%s@github.com/acme/app.git")',
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

// The two-sided lists. Changing how secrets are detected has flipped between
// missing real passwords and flagging ordinary code, so every change must keep
// both sides passing. Add each new case, and every reviewer's probe, to the
// list it belongs on, with the secret it must find.

/** In config, docs and logs: each line, and the secret that must be found in it. */
const MUST_FLAG_AS_TEXT: Array<[string, string]> = [
  // Weak passwords.
  ['password: "password123"', "password123"],
  ["PASSWORD=Summer2024", "Summer2024"],
  ['const API_TOKEN = "Summer2024token";', "Summer2024token"],
  ["PASSWORD=Password1", "Password1"],
  ['"password": "password1"', "password1"],
  ["MYSQL_ROOT_PASSWORD: password1", "password1"],
  ["POSTGRES_PASSWORD=postgres1", "postgres1"],
  ["DB_PASSWORD=dbpassword1", "dbpassword1"],
  ["secret: secret12", "secret12"],
  ["password=password123", "password123"],
  // `key = value` config files.
  ["password = Summer2024", "Summer2024"],
  ["password = Welcome123", "Welcome123"],
  ["password = 8f3kD92mXq", "8f3kD92mXq"],
  ["password = Xk29vLq83mZp", "Xk29vLq83mZp"],
  ["db.password = Secret_Pass_2024", "Secret_Pass_2024"],
  ["spring.datasource.password = Welcome2024", "Welcome2024"],
  ["api_key = Live_Prod_Key_2024", "Live_Prod_Key_2024"],
  ["DB_PASSWORD = Summer2024", "Summer2024"],
  ["DB_PASSWORD=Summer2024", "Summer2024"],
  ["token = AbcDefGhiJkl123", "AbcDefGhiJkl123"],
  // YAML.
  ["  password: Summer2024", "Summer2024"],
  ["  password: Summer2024, user: bob", "Summer2024"],
  // Connection strings.
  ['"Server=db.acme.io;User Id=sa;Password=Summer2024;"', "Summer2024"],
  [
    "Server=db.acme.io;Database=App;User Id=sa;Password=Summer2024;",
    "Summer2024",
  ],
  [
    "Server=db.acme.io;User Id=sa;Password=Welcome123;Encrypt=true",
    "Welcome123",
  ],
  ["Data Source=db;User ID=app;Pwd=Secret_Pass_2024;", "Secret_Pass_2024"],
  ["Pwd=Secret_Pass_2024;Encrypt=true", "Secret_Pass_2024"],
  ["Host=db;Username=app;Password=Monkey2024;Database=app", "Monkey2024"],
  // A comment, in a language the scan does not treat as source code.
  ["-- password: Summer2024", "Summer2024"],
  ["<!-- password: Summer2024 -->", "Summer2024"],
];

/** In source code: secrets in strings and comments, which are text, not code. */
const MUST_FLAG_IN_CODE: Array<[string, string]> = [
  // In a string.
  [
    'const cs = "Server=db.acme.io;User Id=sa;Password=Summer2024;";',
    "Summer2024",
  ],
  ["const s = 'Password=Summer2024;';", "Summer2024"],
  ['const CONFIG = "password = Summer2024";', "Summer2024"],
  ['const password = "Summer2024";', "Summer2024"],
  ['"password": "password1"', "password1"],
  ["db_url = 'postgres://app:Summer2024@db.acme.io/app'", "Summer2024"],
  ['const u = "postgres://app:Summer2024@db.acme.io/app";', "Summer2024"],
  ["''' password = Summer2024 '''", "Summer2024"],
  // In a comment.
  ["// staging login, password: Summer2024", "Summer2024"],
  ["// password: Summer2024", "Summer2024"],
  ["// TODO: password: Summer2024", "Summer2024"],
  ["// DB_PASSWORD=Summer2024", "Summer2024"],
  ["// DB_PASSWORD=Summer2024 (rotated)", "Summer2024"],
  ["// token: 8f3kD92mXqZ7", "8f3kD92mXqZ7"],
  ["// token:abc12345defgh", "abc12345defgh"],
  ["// See https://x.io/a#token=AbcDef12345", "AbcDef12345"],
  ["# api_key = Xk29vLq83mZp", "Xk29vLq83mZp"],
  ["# staging db password = Summer2024", "Summer2024"],
  ["  # PASSWORD=Summer2024", "Summer2024"],
  ["x = 1  # DB_PASSWORD=Summer2024", "Summer2024"],
  ["/* api_key: Live_Prod_Key_2024 */", "Live_Prod_Key_2024"],
  [" * token: AbcDefGhiJkl123", "AbcDefGhiJkl123"],
  ["/** @example client.login({ password: Summer2024 }) */", "Summer2024"],
  ['const a = "x"; // password: Summer2024', "Summer2024"],
];

/** Not secrets anywhere: expressions, references, comments about secrets, and names for them. */
const MUST_NOT_FLAG: string[] = [
  "({ token: user_token })",
  "password: hash_password(pw)",
  "self.token = access_token",
  "password: user.password2",
  "token: access_token,",
  "conn = psycopg2.connect(host=db_host, user=db_user, password=db_pass, dbname=db_name)",
  "login(username=user, password=new_pw, remember=True)",
  'jwt.sign(payload, secret_v2, { expiresIn: "1h" })',
  "{ token: id_token, user }",
  "{ token: jwt_token, user }",
  "const pageToken = next_page_token;",
  "return { token: access_token };",
  "fn new<'a>(secret_key: Ed25519Key) -> Self {}",
  // Names for a secret.
  'const header_token = "X-Auth-Token";',
  'const CSRF_TOKEN = "XSRF-TOKEN";',
  'const TOKEN = "accessToken";',
  'const COOKIE_TOKEN = "session_token";',
  'export const REFRESH_TOKEN = "refresh_token";',
  // Comments that name a secret or say where it comes from.
  "$x = 1; # ok then",
  "# frozen_string_literal: true",
  "#!/usr/bin/env python3",
  "# -*- coding: utf-8 -*-",
  "// eslint-disable-next-line @typescript-eslint/no-explicit-any",
  "/** @param token: the access token */",
  " * @param {string} token - the token",
  "// token: see client_secret_v2",
  "// password: ${PASSWORD}",
  "// password: process.env.DB_PASSWORD",
  "// api_key = settings.API_KEY",
  '# api_key = os.environ["API_KEY"]',
  "# token = get_token(user2)",
  "// const password = config.db.password;",
  "// don't do this: token = refresh_token",
];

/** In source code only: a value without quotes is code. As text, these are flagged. */
const MUST_NOT_FLAG_IN_CODE: string[] = [
  ...MUST_NOT_FLAG,
  "  secretKey: Uint8Array;",
  "  secretKey: Uint8Array",
  "secretKey: Uint8Array",
  "token: Uint8Array",
  "secret_key: Base64Bytes",
  "privateKey: Uint8Array<ArrayBuffer>;",
  "const privateKey: Uint8Array = ed.utils.randomPrivateKey();",
  "  apiKey: Base64Url;",
  "  password?: HashedPassword,",
  "this.token = refresh_token;",
  "user.password = hashed_password;",
  "self.token = refresh_token",
  "function sign(opts: { secretKey: Uint8Array }) {",
  "type Token = { secret: Uint8Array };",
  "Client(api_key=api_key_v2, timeout=30)",
  "client = Client(api_key=api_key_v2, timeout=30)",
  "  client_secret: client_secret_v2,",
  '{"password": hashed_pw, "user": u}',
  'data = {"password": hashed_pw, "user": u}',
  "token=access_token2",
  "secret = os_secret_2",
  "  #token = refresh_token;",
  "this.#apiKey = api_key_v2;",
  "this.#secret = client_secret_v2;",
  "class A { #token = refresh_token2; }",
  "#[derive(Debug)] struct S { secret_key: Ed25519Key2 }",
  'const u = "http://x"; const t = { token: access_token };',
  'const h = "#"; return { secret: client_secret_v2 };',
  "const u = x / y; const o = { token: refresh_token2 };",
  "const n = a * 2; // the token: see refresh_token",
  "const n = a * b; token = refresh_token2",
  "const o = { token: access_token2 } // set from env",
  'const glob = "src/**/*.ts"; const o = { token: access_token2 };',
  'const href = url + "#" + id; const o = { secret: client_secret_v2 };',
  'puts "#{token}"; token = refresh_token2',
  // A bare name in code is a variable, though the same line in a config file is a password.
  "password = Summer2024",
  "DB_PASSWORD=Summer2024",
];

/**
 * Known limits, reviewed and accepted so far: real secrets that are missed.
 * These pin what happens today. If a change catches one, move it to a must-flag
 * list. Each is `[line, mode]`.
 */
const KNOWN_MISSES: Array<[string, "text" | "code"]> = [
  // A `}` stops the value counting.
  ["{user: admin, password: Summer2024}", "text"],
  // Words only: read as the name of a secret, not a secret.
  ['password: "Super-Secret-Password"', "text"],
  ['PASSWORD="SecretKey"', "text"],
  ['api_key: "MasterKeyToken"', "text"],
  // Escaped quotes.
  ['"Password=\\"Summer2024\\";"', "text"],
  ['"{\\"password\\":\\"Summer2024\\"}"', "text"],
  // A `#` with no space is not read as a comment, so `#private` fields are not either.
  ["#PASSWORD=Summer2024", "code"],
  ["#password: Summer2024", "code"],
  ["x = 1 #password=Summer2024", "code"],
];

/**
 * Known limits, reviewed and accepted so far: ordinary code that is flagged,
 * which errs on the side of blocking. If a change clears one, move it to
 * `MUST_NOT_FLAG_IN_CODE`.
 */
const KNOWN_FALSE_ALARMS: string[] = [
  // `//` outside a string turns on comment mode for the rest of the line.
  "const re = /https?:\\/\\//; const t = { token: access_token2 };",
  'path.replace(/\\/*$/, ""); const o = { secret: client_secret_v2 };',
  "x = a // b; token = refresh_token2",
  // A line starting `* ` is read as a doc comment.
  "  * token: access_token2,",
  "  * qty; const o = { token: refresh_token2 };",
  // An apostrophe in a comment opens a string for the rest of the line.
  "// it's here: secretKey: Uint8Array",
  // A comment is checked as text.
  "// secret: my_secret_2",
  " * @param password: user_password_v2",
  // `:` does not split words, so this is not read as a name for a secret.
  'const STORAGE_TOKEN = "myapp:token";',
];

/** Whether the line's spans include the secret. */
const flags = (line: string, secret: string, code: boolean) =>
  secretSpans(line, { code }).some(([s, e]) =>
    line.slice(s, e).includes(secret)
  );

Deno.test("detection list: must flag in config, docs and logs", () => {
  for (const [line, secret] of MUST_FLAG_AS_TEXT) {
    assertEquals(flags(line, secret, false), true, line);
    assertEquals(hideSecrets(line).includes(secret), false, line);
  }
});

Deno.test("detection list: must flag in strings and comments in source code", () => {
  for (const [line, secret] of MUST_FLAG_IN_CODE) {
    assertEquals(flags(line, secret, true), true, line);
    assertEquals(flags(line, secret, false), true, `as text: ${line}`);
  }
});

Deno.test("detection list: must not flag, as text or in source code", () => {
  for (const line of MUST_NOT_FLAG) {
    assertEquals(secretSpans(line), [], line);
  }
});

Deno.test("detection list: must not flag in source code", () => {
  for (const line of MUST_NOT_FLAG_IN_CODE) {
    assertEquals(secretSpans(line, { code: true }), [], line);
  }
});

Deno.test("detection list: known misses are still missed, or move them to a must-flag list", () => {
  for (const [line, mode] of KNOWN_MISSES) {
    assertEquals(secretSpans(line, { code: mode === "code" }), [], line);
  }
});

Deno.test("detection list: known false alarms are still flagged, or move them to must-not-flag", () => {
  for (const line of KNOWN_FALSE_ALARMS) {
    assertEquals(secretSpans(line, { code: true }).length > 0, true, line);
  }
});
