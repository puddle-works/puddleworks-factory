/**
 * The viewer's HTTP handler, ported from Capture's viewer. It only reads: the
 * overview at `/`, one app at `/apps/<name>`, the page's files, and an event
 * stream at `/events` that says when to reload and nothing else. Every page
 * is HTML rendered on the server; there is no JSON API.
 *
 * A request is refused before routing when:
 * - its Host is not 127.0.0.1:<port> or localhost:<port> (DNS rebinding);
 * - it carries an Origin other than the server's own;
 * - it carries a Sec-Fetch-Site other than same-origin or none, which is how
 *   a hostile page's no-cors load (script, img, link) shows itself, unless it
 *   is a person opening a page from a link;
 * - its method is not GET.
 * No response carries a CORS header. Every response carries a strict CSP and
 * Cross-Origin-Resource-Policy: same-origin.
 *
 * @module
 */
import type { ViewerAsset } from "./viewer_assets.ts";
import { notFoundPage } from "./viewer_html.ts";

export interface ViewerEvents {
  /** Calls the listener each time the data changes; returns how to stop. */
  subscribe(listener: () => void): () => void;
}

export interface ViewerDeps {
  /** The port the server is bound to, for the Host check. */
  port: number;
  assets: Readonly<Record<string, ViewerAsset>>;
  /** The overview page. */
  overview(): string;
  /** One app's page, or undefined when there is no such app. */
  app(name: string): string | undefined;
  events: ViewerEvents;
  /** Aborts on shutdown; open event streams close with it. */
  signal?: AbortSignal;
  /** Seconds between keepalive comments on an event stream. */
  keepaliveSeconds?: number;
}

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "content-security-policy":
    "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "cross-origin-resource-policy": "same-origin",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
};

function respond(
  body: BodyInit | null,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, {
    status,
    headers: { ...SECURITY_HEADERS, ...headers },
  });
}

function html(body: string, status = 200): Response {
  return respond(body, status, { "content-type": "text/html; charset=utf-8" });
}

function error(status: number, message: string): Response {
  return respond(`${message}\n`, status, {
    "content-type": "text/plain; charset=utf-8",
  });
}

/** The path's parts, or null for one that doesn't decode. */
function segments(pathname: string): string[] | null {
  try {
    return pathname.split("/").filter((p) => p !== "").map(decodeURIComponent);
  } catch {
    return null;
  }
}

/** Whether a path is one a page is served on: / or /apps/<name>. */
function isPagePath(parts: string[]): boolean {
  return parts.length === 0 || (parts.length === 2 && parts[0] === "apps");
}

/**
 * Opening a page from a link in another site or app: a top-level GET of a
 * page path that the browser shows the person. The linking page cannot read
 * it, and frame-ancestors 'none' keeps it out of frames, so it is let
 * through; nothing else from another site is.
 */
function pageNavigation(req: Request): boolean {
  const parts = segments(new URL(req.url).pathname);
  return req.method === "GET" && parts !== null && isPagePath(parts) &&
    req.headers.get("sec-fetch-mode") === "navigate" &&
    req.headers.get("sec-fetch-dest") === "document";
}

/** Why a request is refused before routing, or null. */
function refusal(req: Request, port: number): Response | null {
  const host = req.headers.get("host");
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  // A browser leaves the default port out of Host and Origin.
  if (port === 80) hosts.push("127.0.0.1", "localhost");
  if (host === null || !hosts.includes(host)) {
    return error(403, "the Host header must name this server");
  }
  const origin = req.headers.get("origin");
  if (origin !== null && origin !== `http://${host}`) {
    return error(403, "requests from another origin are refused");
  }
  const site = req.headers.get("sec-fetch-site");
  if (
    site !== null && site !== "same-origin" && site !== "none" &&
    !pageNavigation(req)
  ) {
    return error(403, "requests from another site are refused");
  }
  if (req.method !== "GET") {
    const res = error(405, "the viewer only reads; every route is GET");
    res.headers.set("allow", "GET");
    return res;
  }
  return null;
}

function eventStream(deps: ViewerDeps): Response {
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const send = (text: string) => {
        if (open) controller.enqueue(encoder.encode(text));
      };
      // Says only that something changed: the page reloads to see what.
      const unsubscribe = deps.events.subscribe(() =>
        send("data: changed\n\n")
      );
      const keepalive = setInterval(
        () => send(": keepalive\n\n"),
        (deps.keepaliveSeconds ?? 15) * 1000,
      );
      const close = () => {
        if (!open) return;
        cleanup();
        controller.close();
      };
      cleanup = () => {
        open = false;
        unsubscribe();
        clearInterval(keepalive);
        deps.signal?.removeEventListener("abort", close);
      };
      deps.signal?.addEventListener("abort", close);
      send(": connected\n\n");
      // Opened as the server began to stop.
      if (deps.signal?.aborted) close();
    },
    // The page went away.
    cancel() {
      cleanup();
    },
  });
  return respond(body, 200, {
    "content-type": "text/event-stream; charset=utf-8",
  });
}

export function handleViewerRequest(
  req: Request,
  deps: ViewerDeps,
): Response {
  const refused = refusal(req, deps.port);
  if (refused) return refused;
  const parts = segments(new URL(req.url).pathname);
  if (parts === null) return error(400, "the path doesn't decode");
  if (parts.length === 0) return html(deps.overview());
  if (isPagePath(parts)) {
    const page = deps.app(parts[1]);
    return page === undefined ? html(notFoundPage(), 404) : html(page);
  }
  if (parts.length === 1 && parts[0] === "events") return eventStream(deps);
  if (parts.length === 1 && Object.hasOwn(deps.assets, parts[0])) {
    const { type, text } = deps.assets[parts[0]];
    return respond(text, 200, { "content-type": type });
  }
  return html(notFoundPage(), 404);
}
