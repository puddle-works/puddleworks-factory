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
  /\bgh[pousr]_[A-Za-z0-9]{36,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/g,
  /\bsk-ant-[A-Za-z0-9_-]{20,}/g,
  /\baws_secret_access_key\s*[=:]\s*["']?[A-Za-z0-9/+]{40}/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  // A password in a URL, with or without a user. It may hold an @, so it
  // runs to the last @ before the host.
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]*:[^\s/]+@(?=[A-Za-z0-9.-]+)/gi,
  // A token as the URL's user, like `https://<token>@dev.azure.com/`: long,
  // with letters and digits, so `git@` and `alice@` are not.
  /\b[a-z][a-z0-9+.-]*:\/\/(?=[\w-]*\d)(?=[\w-]*[A-Za-z])[\w-]{20,}@/gi,
  // A password with no scheme, like `default:pw@redis.example.com`. The host
  // must look like one, so `npm:zod@4` and `npm:lodash-es@4.17.21` are not.
  /(?<![\w.~%+:@-])(?!mailto:)[A-Za-z0-9._~%+-]+:[^\s/]+@(?=(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?![\w-])|\d{1,3}(?:\.\d{1,3}){3}(?!\d))/gi,
];

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
    return url.replace(/[?#][\s\S]*$/, "").replace(/\/\/[^/]*@/, "//");
  }
}

/** Text as it may be stored, logged or shown: every http(s) URL as `shownUrl` gives it, and no secret. */
export const safeText = (text: string) =>
  hideSecrets(
    text.replace(/\bhttps?:\/\/[^\s)'"<>]+/gi, (u) => shownUrl(u)),
  );

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
