/**
 * URLs as they may be shown: without the login, query or fragment a person
 * may have pasted a token into.
 *
 * @module
 */

/** Whether the URL carries a user name or password, as in `https://user:pw@host/`. */
export function hasLogin(url: string): boolean {
  try {
    const u = new URL(url);
    return u.username !== "" || u.password !== "";
  } catch {
    return false;
  }
}

/** The URL without its user name or password. */
export function withoutLogin(url: string): string {
  try {
    const u = new URL(url);
    u.username = "";
    u.password = "";
    return u.href;
  } catch {
    return url.replace(/\/\/[^/]*@/, "//");
  }
}

/** The URL without its login, query or fragment: what is safe to store, log and show. */
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

/** Every http(s) URL in a message, as `shownUrl` gives it. */
export const withShownUrls = (message: string) =>
  message.replace(/\bhttps?:\/\/[^\s)'"]+/g, (u) => shownUrl(u));
