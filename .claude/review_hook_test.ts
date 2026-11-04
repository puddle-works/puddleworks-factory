/**
 * Tests for the hook that asks before a review round starts: a review costs a
 * fresh Opus agent, and none may start without the user saying yes.
 *
 * Run with:
 *   $(swamp doctor extensions --json | jq -r .denoPath) test -A .claude/review_hook_test.ts
 *
 * @module
 */
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";

const settings = JSON.parse(
  await Deno.readTextFile(new URL("./settings.json", import.meta.url)),
);

/** What the settings run before an Agent call, given that call's prompt. */
async function runHook(prompt: unknown): Promise<string> {
  const [entry] = settings.hooks.PreToolUse.filter(
    (e: { matcher: string }) => e.matcher === "Agent",
  );
  const child = new Deno.Command("sh", {
    args: ["-c", entry.hooks[0].command],
    stdin: "piped",
    stdout: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(
    new TextEncoder().encode(
      JSON.stringify({ tool_name: "Agent", tool_input: { prompt } }),
    ),
  );
  await writer.close();
  const { code, stdout } = await child.output();
  assertEquals(code, 0);
  return new TextDecoder().decode(stdout).trim();
}

Deno.test("review hook: a review round asks first, whatever the case of the words", async () => {
  for (
    const prompt of [
      "You are an adversarial reviewer of this diff.",
      "ADVERSARIAL REVIEWER: check the fixes",
      "Act as an\nAdversarial Reviewer.",
      "an adversarial\n  reviewer, wrapped across two lines",
    ]
  ) {
    const output = JSON.parse(await runHook(prompt)).hookSpecificOutput;
    assertEquals(output.hookEventName, "PreToolUse", prompt);
    assertEquals(output.permissionDecision, "ask", prompt);
    assertStringIncludes(output.permissionDecisionReason, "review round");
  }
});

Deno.test("review hook: any other agent call is left alone", async () => {
  for (
    const prompt of [
      "Find where the manifest is read.",
      "Review the wording of the README.",
      "",
      undefined,
    ]
  ) {
    assertEquals(await runHook(prompt), "", String(prompt));
  }
});
