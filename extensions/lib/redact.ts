/**
 * What text may be stored, logged and shown: secrets hidden, and URLs
 * without the login, query or fragment a person may have pasted a token into.
 *
 * Everything the Factory copies from its input into a resource, a log line,
 * an error or the viewer goes through `safeText`, or is refused by
 * `linkProblem` before it is recorded.
 *
 * @module
 */

/** Secret shapes. Each match is hidden whole. */
export const SECRET_PATTERNS: RegExp[] = [
  // No closing \b: a key followed by `_x` is still a key.
  /\bAKIA[0-9A-Z]{16}/g,
  // Not \b: `token_ghp_…` is still a token.
  /(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{36,}/g,
  /(?<![A-Za-z0-9])[sr]k_live_[A-Za-z0-9]{20,}/g,
  /\bAIza[0-9A-Za-z_-]{35}/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  /\bnpm_[A-Za-z0-9]{36}/g,
  /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/g,
  // A JSON Web Token: header, payload and signature.
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/g,
  /\bsk-ant-[A-Za-z0-9_-]{20,}/g,
  // As in a credentials file, or the JSON `aws iam create-access-key` prints.
  /\b(?:aws_secret_access_key|SecretAccessKey)["']?\s*[=:]\s*["']?[A-Za-z0-9/+]{40}/gi,
  // A secret set in an env file or YAML, like `DB_PASSWORD=…`: the line
  // starts with the name, and a value like `${…}`, `<…>` or a path is not one.
  /^\s*(?:export\s+|-\s+)?[A-Z][A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|APIKEY)[A-Z0-9_]*\s*[=:]\s*["']?(?![$<{%/])[^\s"'<>]{8,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  // A password in a URL, with or without a user. It may hold an @, so it
  // runs to the last @ before the host.
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]*:[^\s/]+@(?=[A-Za-z0-9.-]+)/gi,
  // A token as the URL's user, like `https://<token>@dev.azure.com/`: long,
  // with letters and digits, so `git@` and `alice@` are not.
  /\b[a-z][a-z0-9+.-]*:\/\/(?=[\w-]*\d)(?=[\w-]*[A-Za-z])[\w-]{20,}@/gi,
  // A password with no scheme, like `default:pw@redis.example.com`. The host
  // must look like one, or be localhost, and an IAM member like
  // `serviceAccount:sa@…` or a `from:` address is not one, so `npm:zod@4` and
  // `npm:lodash-es@4.17.21` are not.
  /(?<![\w.~%+:@-])(?!(?:mailto|user|group|serviceaccount|domain|principal|from|to|cc|bcc|author|committer|email|sip|sips|tel|xmpp):)[A-Za-z0-9._~%+-]+:[^\s/]+@(?=(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?![\w-])|\d{1,3}(?:\.\d{1,3}){3}(?!\d)|localhost(?![\w.-]))/gi,
];

/** Documentation domains: an address or URL there names nobody real. */
export const exampleDomain = (domain: string) =>
  /(^|\.)example\.(com|org|net)$|\.example$|\.invalid$|\.test$/.test(
    domain.toLowerCase(),
  );

/** Text that stands in for a secret in docs and templates: `your-token-here`, `%s`, `${…}`. */
const PLACEHOLDER =
  /%s|\$\{|\{\{|<[^>]*>|\byour[-_ ]|[-_]here\b|\.\.\.|changeme|placeholder/i;

/** A URL password for a documentation domain, like `https://user:pass@example.com/`. */
function harmlessUrlPassword(line: string, end: number): boolean {
  const host = /^[A-Za-z0-9.-]+/.exec(line.slice(end))?.[0] ?? "";
  return exampleDomain(host);
}

/**
 * Where on the line each secret is, as [start, end), left to right.
 * Overlapping matches, like a URL password both patterns find, are one.
 */
export function secretSpans(line: string): Array<[number, number]> {
  const found: Array<[number, number]> = [];
  for (const re of SECRET_PATTERNS) {
    for (const m of line.matchAll(re)) {
      const at = m.index ?? 0;
      if (harmlessUrlPassword(line, at + m[0].length)) continue;
      if (PLACEHOLDER.test(m[0])) continue;
      found.push([at, at + m[0].length]);
    }
  }
  found.sort((a, b) => a[0] - b[0]);
  const spans: Array<[number, number]> = [];
  for (const [s, e] of found) {
    const last = spans.at(-1);
    if (last && s < last[1]) last[1] = Math.max(last[1], e);
    else spans.push([s, e]);
  }
  return spans;
}

/** The text with every secret in it replaced by `(hidden)`. */
export function hideSecrets(text: string): string {
  return text.split("\n").map((line) => {
    let out = line;
    // Right to left, so earlier spans keep their place.
    for (const [s, e] of secretSpans(line).reverse()) {
      out = `${out.slice(0, s)}(hidden)${out.slice(e)}`;
    }
    return out;
  }).join("\n");
}

/** The URL without its login, query or fragment. */
export function shownUrl(url: string): string {
  try {
    const u = new URL(url);
    u.username = "";
    u.password = "";
    u.search = "";
    u.hash = "";
    return u.href;
  } catch {
    // A password with `#`, `?` or `/` in it breaks parsing: the login is
    // everything up to the last @.
    const m = /^([a-z][a-z0-9+.-]*:\/\/)([\s\S]*)$/i.exec(url);
    const rest = m ? m[2].slice(m[2].lastIndexOf("@") + 1) : url;
    return (m ? m[1] : "") + rest.replace(/[?#][\s\S]*$/, "");
  }
}

/** Text as it may be stored, logged or shown: every URL as `shownUrl` gives it, and no secret. */
export const safeText = (text: string) =>
  hideSecrets(
    text.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s)'"<>]+/gi, (u) => shownUrl(u)),
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
