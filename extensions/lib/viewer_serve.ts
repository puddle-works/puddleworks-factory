/**
 * Runs the viewer, as Capture's viewer runs: reads one draft behavior's
 * records with swamp's data query, serves the pages on 127.0.0.1, and polls
 * for changes until swamp's signal aborts (Ctrl-C).
 *
 * @module
 */
import { type App, appsFromRecords } from "./viewer_apps.ts";
import { VIEWER_ASSETS } from "./viewer_assets.ts";
import { appPage, overviewPage } from "./viewer_html.ts";
import { handleViewerRequest, type ViewerDeps } from "./viewer_server.ts";

/** The behavior type whose records the viewer shows. */
export const DRAFT_TYPE = "@puddleworks/puddleworks-factory/draft";

/** How often serve reads the records again. */
const POLL_SECONDS = 3;

/** swamp's data query, as the method context gives it. */
export type QueryData = (predicate: string) => Promise<unknown[]>;

/** A behavior name, checked so it can't change the query it is put into. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.@\/-]*$/;

/** The one query the viewer runs: the latest of each record the draft behavior keeps. */
export function predicate(draft: string): string {
  if (!NAME.test(draft)) {
    throw new Error(`"${draft}" isn't a behavior name`);
  }
  return `modelType == "${DRAFT_TYPE}" && modelName == "${draft}" && lifecycle != "deleted"`;
}

/** What makes two reads the same: each record's spec, name and version. */
function fingerprint(records: unknown[]): string {
  return records
    .map((r) => {
      const { specName, name, version } = (r ?? {}) as Record<string, unknown>;
      return `${specName}/${name}@${version}`;
    })
    .sort()
    .join(",");
}

/** The part of swamp's method context serve uses. */
export interface ViewerContext {
  queryData?: QueryData;
  logger: { info: (message: string, props?: Record<string, unknown>) => void };
  signal?: AbortSignal;
}

export async function serveViewer(
  ctx: ViewerContext,
  options: {
    port: number;
    draft: string;
    pollSeconds?: number;
    onListen?: (port: number) => void;
  },
): Promise<{ dataHandles: { name: string }[] }> {
  if (typeof ctx.queryData !== "function") {
    throw new Error(
      "this swamp gives no data query, which the viewer reads the Factory's records with",
    );
  }
  const query = ctx.queryData.bind(ctx);
  const where = predicate(options.draft);
  let apps = new Map<string, App>();
  let readAt = new Date(0).toISOString();
  let last: string | null = null;
  /** Reads again; true when something changed since the last read. */
  const refresh = async () => {
    const records = await query(where);
    readAt = new Date().toISOString();
    const print = fingerprint(records);
    if (print === last) return false;
    last = print;
    apps = new Map(appsFromRecords(records).map((a) => [a.name, a]));
    return true;
  };
  await refresh();

  const listeners = new Set<() => void>();
  // One poll at a time: a slow datastore skips a beat rather than piling up.
  let polling = false;
  const poll = setInterval(() => {
    if (polling) return;
    polling = true;
    refresh()
      .then((changed) => {
        if (changed) listeners.forEach((listener) => listener());
      })
      .catch(() => {
        // Data mid-write; the next poll sees it whole.
      })
      .finally(() => (polling = false));
  }, (options.pollSeconds ?? POLL_SECONDS) * 1000);
  try {
    const deps: ViewerDeps = {
      // Set once the server has bound, before any request can arrive.
      port: 0,
      assets: VIEWER_ASSETS,
      overview: () => overviewPage([...apps.values()], readAt),
      app: (name) => {
        const found = apps.get(name);
        return found && appPage(found, readAt);
      },
      events: {
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      // Deno.serve waits for open responses when it stops, so the event
      // streams close on the same signal.
      signal: ctx.signal,
    };
    const server = Deno.serve({
      hostname: "127.0.0.1",
      port: options.port,
      signal: ctx.signal,
      onListen: ({ port }) => {
        ctx.logger.info("Factory viewer: http://127.0.0.1:{port}/", { port });
        options.onListen?.(port);
      },
    }, (req) => handleViewerRequest(req, deps));
    deps.port = server.addr.port;
    await server.finished;
  } finally {
    // Also when the port cannot be bound.
    clearInterval(poll);
  }
  return { dataHandles: [] };
}
