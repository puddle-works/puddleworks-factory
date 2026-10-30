/**
 * @puddleworks/puddleworks-factory/web — a read-only page showing what the
 * Factory has done.
 *
 * `serve` shows every app of one `@puddleworks/puddleworks-factory/draft`
 * behavior on 127.0.0.1, as Capture's viewer shows Capture's requests: the
 * apps grouped by the stage they are at, and each app's prefill, draft,
 * visibility, readiness and build result. The pages are rendered on the
 * server, with no JSON API (extensions/lib/viewer_server.ts). It only reads;
 * every change goes through the draft behavior's methods and the Factory's
 * workflows. The page reloads as the data changes.
 *
 * @module
 */
import { z } from "npm:zod@4";
import { serveViewer, type ViewerContext } from "../lib/viewer_serve.ts";

/** The behavior's settings: which draft behavior to show. */
export const GlobalArgsSchema = z.object({
  draft: z.string().min(1).default("puddleworks-factory").describe(
    "The name of the @puddleworks/puddleworks-factory/draft behavior to show.",
  ),
});
/** The settings, as the serve method sees them. */
export type GlobalArgs = z.infer<typeof GlobalArgsSchema>;

/** The behavior type: serves the read-only Factory page. */
export const model = {
  type: "@puddleworks/puddleworks-factory/web",
  version: "2026.10.29.1",
  globalArguments: GlobalArgsSchema,
  methods: {
    serve: {
      description:
        "Serve the Factory page on 127.0.0.1 until Ctrl-C: every app by stage, read-only, reloaded as it changes",
      // Not a read method: it runs for the session, holding this instance's
      // lock, so it is its own type and never blocks the draft behavior.
      arguments: z.object({
        port: z.coerce.number().int().min(0).max(65535).default(0).describe(
          "The port on 127.0.0.1; 0, the default, picks a free one",
        ),
      }),
      execute: (
        args: { port: number },
        context: ViewerContext & { globalArgs: GlobalArgs },
      ) =>
        serveViewer(context, {
          port: args.port,
          draft: context.globalArgs.draft,
        }),
    },
  },
};
