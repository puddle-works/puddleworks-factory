/**
 * What text may be stored, logged and shown: secrets hidden, and URLs
 * without the login, fragment or query parameter a person may have pasted a
 * token into.
 *
 * Everything the Factory copies from its input into a resource, a log line,
 * an error or the viewer goes through `safeText`, or is refused by
 * `linkProblem` before it is recorded.
 *
 * @module
 */

/**
 * A secret shape. The whole match is hidden, or only the value `v` when
 * `hide` is "v". `v`, when the pattern names it, is what must not be a
 * placeholder: the password, not the user in front of it.
 */
interface SecretPattern {
  re: RegExp;
  hide?: "v";
  /** A URL's login: `safeText` removes it, so the URL still parses. */
  login?: true;
  /** More than a pattern can say about whether `v` is a secret. */
  check?: (m: RegExpMatchArray) => boolean;
}

/** Text that stands in for a secret in docs and templates: `your-token-here`, `%s`, `${…}`, `xxxxxx`. */
const PLACEHOLDER =
  /%s|\$\{|\{\{|<[^>]*>|\byour[-_ ]|[-_]here\b|\.\.\.|x{6,}|\*{3,}|replace[-_]?me|change[-_]?me|placeholder|(?<![a-z])(?:todo|tbd|fixme|fake|dummy|test)(?![a-z])/i;

/**
 * Whether the value of a `NAME=value` or `name: value` is a secret, not code,
 * a reference or a word. A value in quotes is a literal; one without quotes
 * must be a single word with no code in it, and, under a name that is not
 * all capitals (so not an env file), have a digit or symbol in it.
 */
function assignedSecret(m: RegExpMatchArray): boolean {
  const { name = "", q = "", v = "" } = m.groups ?? {};
  if (v.length < 8) return false;
  // A variable, a path, a Ruby symbol, `++n`, a URL (its own patterns find a
  // password in it), an ARN.
  if (/^[$<{[%/~.:]|^\+\+|^--|^[a-z][a-z0-9+.-]*:\/\/|^arn:/i.test(v)) {
    return false;
  }
  if (
    /^(?:true|false|null|none|undefined|password|passwd|secret|token)$/i.test(v)
  ) return false;
  // The name of where it lives: `SAS_TOKEN`, `puddle/SCANNER_TOKEN`,
  // `vault.secret_key`.
  if (
    /^(?:[\w.-]+\/)*[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$|^[a-z_]+(?:\.[a-z_]+)+$/
      .test(v)
  ) {
    return false;
  }
  if (q) return true;
  if (/[(){}[\];,`]/.test(v)) return false;
  // A reference like `args.password`, `secrets.GITHUB_TOKEN` or `o?.token`.
  if (/^[A-Za-z_$][\w$]*(?:\??\.[\w$]+)+$/.test(v)) return false;
  return name === name.toUpperCase() || /[^A-Za-z]/.test(v);
}

/** Secret shapes. */
const SECRET_PATTERNS: SecretPattern[] = [
  // No closing \b: a key followed by `_x` is still a key.
  { re: /\bAKIA[0-9A-Z]{16}/g },
  // Not \b: `token_ghp_…` is still a token.
  { re: /(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{36,}/g },
  { re: /(?<![A-Za-z0-9])[sr]k_live_[A-Za-z0-9]{20,}/g },
  { re: /\bAIza[0-9A-Za-z_-]{35}/g },
  { re: /\bglpat-[A-Za-z0-9_-]{20,}/g },
  { re: /\bnpm_[A-Za-z0-9]{36}/g },
  { re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/g },
  // A JSON Web Token: header, payload and signature.
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { re: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/g },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}/g },
  { re: /\bxox[abpr]-[A-Za-z0-9-]{10,}/g },
  { re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  // As in a credentials file, or the JSON `aws iam create-access-key` prints.
  {
    re:
      /\b(?:aws_secret_access_key|SecretAccessKey)["']?\s*[=:]\s*["']?(?<v>[A-Za-z0-9/+]{40})/dgi,
    hide: "v",
  },
  // A secret set by name, in an env file, YAML, JSON, code, a header or a
  // connection string: `DB_PASSWORD=…`, `password: …`, `"apiKey": "…"`,
  // `const API_KEY = "…"`, `X-API-Key: …`, `;Password=…;`. The name ends in
  // the word, so `TOKEN_ENDPOINT` and `PASSWORD_FILE` are not, and a shell
  // `${token:-…}` is not an assignment. Only the value is hidden; one without
  // quotes ends at a `;`.
  {
    re:
      /(?<![\w.$:/-]|\$\{)(?<q1>["']?)(?<name>[A-Za-z0-9_.-]*?(?:password|passwd|pwd|secret|token|api[-_]?key|apikey|(?:secret|access|private|signing|encryption|client|master|account)[-_]?key))\k<q1>\s*[=:]\s*(?<q>["']?)(?<v>(?<=["'])[^\s"'<>]+|[^\s"'<>;]+)/dgi,
    hide: "v",
    check: assignedSecret,
  },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/g },
  // A token sent as `Authorization: Bearer …`.
  { re: /\bBearer\s+(?<v>[A-Za-z0-9._~+/-]{16,}=*)/dg, hide: "v" },
  // A password in a URL, with or without a user. It may hold an @, so it
  // runs to the last @ before the host. The scheme stays, so the URL is
  // still found and stripped after the login is hidden.
  {
    re:
      /(?<=\b[a-z][a-z0-9+.-]*:\/\/)(?<u>[^\s/:@]*):(?<v>[^\s/]+)@(?=[A-Za-z0-9.-]+)/dgi,
    login: true,
  },
  // The same with a / in the password, which a URL parser reads as a port
  // and a path: `https://deploy:1234/abc@git.acme.com`. The user has no dot,
  // so `https://acme.io:8080/u/bob@acme.io` is a host, not a login.
  {
    re:
      /(?<=\b[a-z][a-z0-9+.-]*:\/\/)(?!localhost:)(?<u>[^\s/:@.]+):(?<v>[^\s@]*\/[^\s@]*)@(?=(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})/dgi,
    login: true,
  },
  // A token as the URL's user, like `https://<token>@dev.azure.com/`: long,
  // with letters and digits, so `git@` and `alice@` are not.
  {
    re:
      /(?<=\b[a-z][a-z0-9+.-]*:\/\/)(?=[\w-]*\d)(?=[\w-]*[A-Za-z])[\w-]{20,}@/gi,
    login: true,
  },
  // A password with no scheme, like `default:pw@redis.example.com`. The host
  // must look like one, or be localhost, and an IAM member like
  // `serviceAccount:sa@…` or a `from:` address is not one, so `npm:zod@4` and
  // `npm:lodash-es@4.17.21` are not.
  {
    re:
      /(?<![\w.~%+:@-])(?!(?:mailto|user|group|serviceaccount|domain|principal|from|to|cc|bcc|author|committer|email|sip|sips|tel|xmpp):)(?<u>[A-Za-z0-9._~%+-]+):(?<v>[^\s/]+)@(?=(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?![\w-])|\d{1,3}(?:\.\d{1,3}){3}(?!\d)|localhost(?![\w.-]))/dgi,
  },
];

/** A private key from its BEGIN line to its END line, or to the end of the text. */
const PRIVATE_KEY =
  /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|$)/g;

/** Documentation domains: an address or URL there names nobody real. */
export const exampleDomain = (domain: string) =>
  /(^|\.)example\.(com|org|net)$|\.example$|\.invalid$|\.test$/.test(
    domain.toLowerCase(),
  );

/** A URL password for a documentation domain, like `https://user:pass@example.com/`. */
function harmlessUrlPassword(line: string, end: number): boolean {
  const host = /^[A-Za-z0-9.-]+/.exec(line.slice(end))?.[0] ?? "";
  return exampleDomain(host);
}

/** Each secret on the line, left to right, overlapping matches as one. */
function spans(line: string): Array<{ s: number; e: number; login: boolean }> {
  const found: Array<{ s: number; e: number; login: boolean }> = [];
  for (const { re, hide, login, check } of SECRET_PATTERNS) {
    for (const m of line.matchAll(re)) {
      const at = m.index ?? 0;
      if (harmlessUrlPassword(line, at + m[0].length)) continue;
      if (PLACEHOLDER.test(m.groups?.v ?? m[0])) continue;
      if (check && !check(m)) continue;
      const v = hide === "v" ? m.indices?.groups?.v : undefined;
      found.push({
        s: v ? v[0] : at,
        e: v ? v[1] : at + m[0].length,
        login: login === true,
      });
    }
  }
  found.sort((a, b) => a.s - b.s);
  const merged: typeof found = [];
  for (const f of found) {
    const last = merged.at(-1);
    if (last && f.s < last.e) {
      last.e = Math.max(last.e, f.e);
      last.login ||= f.login;
    } else merged.push({ ...f });
  }
  return merged;
}

/** Where on the line each secret is, as [start, end), left to right. */
export function secretSpans(line: string): Array<[number, number]> {
  return spans(line).map(({ s, e }) => [s, e]);
}

/** The text with every secret, and every private key whole, replaced; a URL's login by `loginAs`. */
function hide(text: string, loginAs: string): string {
  return text.replace(PRIVATE_KEY, "(hidden)").split("\n").map((line) => {
    let out = line;
    // Right to left, so earlier spans keep their place.
    for (const { s, e, login } of spans(line).reverse()) {
      out = `${out.slice(0, s)}${login ? loginAs : "(hidden)"}${out.slice(e)}`;
    }
    return out;
  }).join("\n");
}

/** The text with every secret in it, and every private key whole, replaced by `(hidden)`. */
export const hideSecrets = (text: string) => hide(text, "(hidden)");

/** A query parameter whose name says it carries a credential. */
const SECRET_PARAM =
  /token|key|secret|sig|pass|pwd|auth|code|session|credential|jwt|^x-amz-|^x-goog-/i;

/** A query value that may be a secret: already hidden, a known shape, or long with letters and digits, unless a UUID. */
const mayBeSecret = (value: string) =>
  value.includes("(hidden)") || secretSpans(value).length > 0 ||
  (value.length >= 16 && /\d/.test(value) && /[A-Za-z]/.test(value) &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    ));

/**
 * The URL without its login or fragment, and without any query parameter
 * that may carry a secret, so `?id=42` is kept and `?token=…` is not.
 */
export function shownUrl(url: string): string {
  try {
    const u = new URL(url);
    u.username = "";
    u.password = "";
    u.hash = "";
    const kept = [...u.searchParams].filter(([k, v]) =>
      !SECRET_PARAM.test(k) && !mayBeSecret(v)
    );
    u.search = kept.length ? new URLSearchParams(kept).toString() : "";
    return u.href;
  } catch {
    // A password with `#`, `?` or `/` in it breaks parsing: the login is
    // everything up to the last @, and no query is kept.
    const m = /^([a-z][a-z0-9+.-]*:\/\/)([\s\S]*)$/i.exec(url);
    const rest = m ? m[2].slice(m[2].lastIndexOf("@") + 1) : url;
    return (m ? m[1] : "") + rest.replace(/[?#][\s\S]*$/, "");
  }
}

/**
 * Text as it may be stored, logged or shown: no secret, and every URL as
 * `shownUrl` gives it. Secrets are hidden and URL logins removed first, so a
 * password a URL parser would read as a port is gone before it is parsed.
 */
export const safeText = (text: string) =>
  hide(text, "").replace(
    // A URL may hold brackets, like `Foo_(bar)` or a `(hidden)` secret, but a
    // `)` with no `(` ends it, as in `(see https://…)`.
    /\b[a-z][a-z0-9+.-]*:\/\/(?:\([^\s()'"<>]*\)|[^\s()'"<>])+/gi,
    (u) => shownUrl(u),
  );

/** A value with every string in it, however deep, as `safeText` gives it. */
export function safeData<T>(value: T): T {
  if (typeof value === "string") return safeText(value) as T;
  if (Array.isArray(value)) return value.map(safeData) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, safeData(v)]),
    ) as T;
  }
  return value;
}

/** Why a URL cannot be recorded as a plain https link, or null when it can. */
export function linkProblem(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "is not a URL";
  }
  if (u.protocol !== "https:") return "is not https";
  if (u.username !== "" || u.password !== "") return "has a login in it";
  if (u.search !== "" || u.hash !== "") return "has a query or fragment in it";
  return null;
}
