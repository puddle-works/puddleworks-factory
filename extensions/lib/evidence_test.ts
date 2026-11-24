// Parsing what swamp and deno report, for readiness's evidence (#50).
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import {
  parseJunit,
  parseQuality,
  realTests,
  testPermissions,
} from "./evidence.ts";
import type { SwampRun } from "./recipe_check.ts";

// Trimmed from `deno test --reporter=junit` with one failing test.
const JUNIT = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="deno test" tests="3" failures="1" errors="0" time="0.011">
    <testsuite name="./extensions/models/app_test.ts" tests="3" disabled="0" errors="0" failures="1">
        <testcase name="model type matches the app spec" classname="./extensions/models/app_test.ts" time="0.024" line="28" col="6">
            <failure message="Uncaught AssertionError: Values are not equal.">x</failure>
        </testcase>
        <testcase name="run handles &quot;quoted&quot; &amp; &lt;odd&gt; names" classname="./extensions/models/app_test.ts" time="0.000" line="32" col="6">
        </testcase>
        <testcase name="self closed" classname="x" time="0" line="1" col="1"/>
    </testsuite>
</testsuites>`;

Deno.test("parseJunit: a testcase with a failure did not pass, others did", () => {
  assertEquals(parseJunit(JUNIT), [
    { name: "model type matches the app spec", passed: false },
    { name: 'run handles "quoted" & <odd> names', passed: true },
    { name: "self closed", passed: true },
  ]);
});

Deno.test("parseQuality: reads the hash, points and what is missing", () => {
  const q = parseQuality(JSON.stringify({
    cacheHash: "9d7c".repeat(16),
    grade: "C",
    rubricVersion: 6,
    earnedPoints: 12,
    maxClientEarnablePoints: 14,
    gateFailures: [{ gate: "fmt-lint", message: "Extension has lint issues." }],
    factors: [
      { id: "has-readme", status: "missing" },
      { id: "dependency-trust", status: "partial" },
      { id: "repository-verified", status: "provisional" },
    ],
  }));
  assertEquals("error" in q ? q.error : q.missing, [
    "has-readme",
    "dependency-trust",
  ]);
  assertEquals("error" in q ? null : q.gateFailures, [
    "Extension has lint issues.",
  ]);
});

Deno.test("parseQuality: output with no content hash can't be used", () => {
  assertEquals("error" in parseQuality("{}"), true);
  assertEquals("error" in parseQuality("not json"), true);
});

// The app's CI test command, as render writes it into ci.yml (the
// publish job's `tests:` input), with the permissions the app's tests need.
const CI = `jobs:
  test:
    steps:
      - run: deno test --allow-read --allow-write --allow-run=git extensions/models/
  publish:
    with:
      visibility: private # must equal visibility: in manifest.yaml
      tests: deno test --allow-read --allow-write --allow-run=git extensions/models/ # as CI runs them
`;

/** The flags testPermissions takes from ci.yml, or the error it gives. */
const flagsOf = (ciYml: string | null) => {
  const got = testPermissions(ciYml);
  return "flags" in got ? got.flags : got;
};

/** A ci.yml whose publish job's tests input is command, quoted for YAML. */
const testsIs = (command: string) =>
  `jobs:\n  publish:\n    with:\n      tests: ${JSON.stringify(command)}\n`;

Deno.test("testPermissions: the permission flags of ci.yml's tests command, nothing else", () => {
  assertEquals(flagsOf(CI), [
    "--allow-read",
    "--allow-write",
    "--allow-run=git",
  ]);
  const withTests = (value: string) =>
    `jobs:\n  publish:\n    with:\n      tests: ${value}\n      dry-run: true\n`;
  assertEquals(
    flagsOf(
      withTests(
        "deno test -A --reporter=dot --config x.json --deny-net=a.example --ignore-env=X extensions/models/",
      ),
    ),
    ["-A", "--deny-net=a.example", "--ignore-env=X"],
  );
  assertEquals(flagsOf(withTests("deno test extensions/models/")), []);
  assertEquals(flagsOf("jobs: {}\n"), []);
  assertEquals(flagsOf(null), []);
});

Deno.test("testPermissions: reads the publish job's tests input however ci.yml writes it", () => {
  const ci = (value: string) =>
    `jobs:
  tests:
    runs-on: ubuntu-24.04
    steps:
      - run: deno test extensions/models/
  publish:
    with:
      tests: ${value}
      dry-run: true
`;
  // A job named tests above it is not the tests command.
  assertEquals(
    flagsOf(ci("deno test --allow-read --allow-run=git extensions/")),
    ["--allow-read", "--allow-run=git"],
  );
  // Deno 2's short flags, with and without a value.
  assertEquals(
    flagsOf(
      ci("deno test -R -W=. -N=a.example -E -S -I --allow-run=git -q"),
    ),
    ["-R", "-W=.", "-N=a.example", "-E", "-S", "-I", "--allow-run=git"],
  );
  // A quoted value keeps its last flag, and a folded one is one command.
  assertEquals(
    flagsOf(ci('"deno test --allow-read --allow-write"')),
    ["--allow-read", "--allow-write"],
  );
  assertEquals(
    flagsOf(
      ci(
        ">-\n        deno test --allow-read\n        --allow-write extensions/",
      ),
    ),
    ["--allow-read", "--allow-write"],
  );
  // An empty value gives none, not the next line's words.
  assertEquals(flagsOf(ci("")), []);
});

Deno.test("testPermissions: only the deno test command's own flags, in every form deno takes (#147)", () => {
  const ci = (value: string) =>
    `jobs:\n  publish:\n    with:\n      tests: ${value}\n`;
  // Combined short flags and permission sets, passed on as written.
  assertEquals(flagsOf(ci("deno test -RW extensions/")), ["-RW"]);
  assertEquals(flagsOf(ci("deno test -RWN=a.example -E=HOME x/")), [
    "-RWN=a.example",
    "-E=HOME",
  ]);
  assertEquals(flagsOf(ci("deno test -P extensions/")), ["-P"]);
  assertEquals(
    flagsOf(ci("deno test -P=ci --permission-set=ci --permission-set")),
    ["-P=ci", "--permission-set=ci", "--permission-set"],
  );
  // Other commands' flags are not deno's, whatever joins them.
  assertEquals(
    flagsOf(
      ci("grep -R -E foo . && ls -S && deno test -R extensions/"),
    ),
    ["-R"],
  );
  assertEquals(
    flagsOf(
      ci(
        "deno fmt --check; deno lint -q | tee lint.log || cp -R a b & deno test --allow-read=. extensions/models/ && sed -E s/a/b/ x",
      ),
    ),
    ["--allow-read=."],
  );
  // Variables set for it, and arguments after -- that go to the tests.
  assertEquals(
    flagsOf(
      ci("NO_COLOR=1 deno test -N extensions/ -- -A --allow-all"),
    ),
    ["-N"],
  );
  // A literal block: commands on separate lines, a continuation, a comment.
  assertEquals(
    flagsOf(
      ci(
        "|\n        deno check -I extensions/\n        deno test -R \\\n          --allow-run=git extensions/models/ # not -A\n",
      ),
    ),
    ["-R", "--allow-run=git"],
  );
  // No deno test command, no permissions, and a note that says so.
  for (const command of ["deno task test -A", "echo deno test -A"]) {
    const got = testPermissions(ci(command));
    assertEquals("flags" in got && got.flags, []);
    assertStringIncludes("note" in got ? got.note ?? "" : "", "no deno test");
    assertStringIncludes("note" in got ? got.note ?? "" : "", command);
  }
  assertEquals(testPermissions(ci("")), { flags: [] });
});

Deno.test("testPermissions: reads quotes, escapes and redirections as the shell does", () => {
  for (
    const [command, flags] of [
      // A quoted value is one word: its spaces, separators and #s are
      // literal, and an option's value is never a permission.
      ['deno test -R --filter "x" extensions/', ["-R"]],
      ['deno test --filter "a -A b" extensions/', []],
      ["deno test --filter 'a -A b' --reporter -A extensions/", []],
      ["deno test --filter -A -qc -A extensions/", []],
      ['deno test -R --filter "a && b; c | d # e" x/ # -A', ["-R"]],
      ["deno test -R=a#b x/", ["-R=a#b"]],
      // Quoted and escaped permission values, passed as the shell would.
      [
        `deno test --allow-read="a b" -W='c d' -E="\\$HOME" -N=a.example`,
        ["--allow-read=a b", "-W=c d", "-E=$HOME", "-N=a.example"],
      ],
      ["deno test \\-A x/", ["-A"]],
      ["deno test -R'W' x/", ["-RW"]],
      // Quotes and separators in other commands.
      [
        `echo "it's && deno test -A" && grep -E 'a|b' x; deno test -E extensions/`,
        ["-E"],
      ],
      [`printf '%s' "deno test -A" > notes; deno test -S x/`, ["-S"]],
      // A cd after deno test doesn't change where it ran.
      ["deno test -R x/ && cd docs && ls", ["-R"]],
      // A comment line, continuations and quotes over several lines.
      [
        `# "deno test -A"\ndeno test -R \\\n  --filter 'x y' \\\n  extensions/ # -A\n`,
        ["-R"],
      ],
      // Redirections and their targets are not arguments.
      ["deno test -R x/ 2>&1 > out.log < /dev/null | tee x", ["-R"]],
      ["deno test -R x/ >-A >>log 2>-W", ["-R"]],
    ] as const
  ) assertEquals(flagsOf(testsIs(command)), [...flags], command);
});

Deno.test("testPermissions: a tests command it can't read as the shell would is an error, not a guess (#147)", () => {
  for (
    const [command, why] of [
      ["deno test $(cat perms) extensions/", "substitutes"],
      ['deno test --allow-read="$HOME" x/', "substitutes"],
      ["deno test -R `cat perms` x/", "substitutes"],
      ["echo $PERMS; deno test -R x/", "substitutes"],
      ['deno test -R --filter "x', "unmatched quote"],
      ["deno test -R --filter 'x", "unmatched quote"],
      ["(cd x && deno test -A)", "subshell"],
      ["deno test -R <<EOF", "here-document"],
      [
        "deno test --allow-read={a,b} x/",
        "expand into flags (--allow-read={a,b})",
      ],
      ["deno test -R=~/x x/", "expand into flags"],
      ["deno test * x/", "expand into flags (*)"],
      ["deno test -R extensions/a/ && deno test -A extensions/b/", "once"],
      ["deno test -qR extensions/", "(-qR)"],
      ["deno test --config ci.json -P extensions/", "config file"],
      ["deno test -c=ci.json -RP extensions/", "config file"],
      ["deno test --no-config -P extensions/", "config option"],
      ["deno test -P --no-config extensions/", "config option"],
      ["deno test --no-config=true -P extensions/", "config option"],
      ["cd sub && deno test -P extensions/", "changes directory"],
      ["cd sub; deno test --allow-read=. extensions/", "changes directory"],
      ["deno test -R extensions/ &>/dev/null -W; true", "&>"],
    ]
  ) {
    const got = testPermissions(testsIs(command));
    assertEquals(
      "error" in got && got.error.includes(why) &&
        got.error.endsWith(command),
      true,
      `${command}: ${JSON.stringify(got)}`,
    );
  }
});

Deno.test("realTests runs the app's tests with the permissions its ci.yml gives them", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${dir}/extensions/models`, { recursive: true });
    await Deno.mkdir(`${dir}/.github/workflows`, { recursive: true });
    await Deno.writeTextFile(
      `${dir}/extensions/models/app_test.ts`,
      `Deno.test("reads and writes a file", async () => {
  const f = await Deno.makeTempFile();
  await Deno.writeTextFile(f, "x");
  if (await Deno.readTextFile(f) !== "x") throw new Error("not read back");
  await Deno.remove(f);
});
`,
    );
    const swamp: SwampRun = () =>
      Promise.resolve({
        code: 0,
        stdout: JSON.stringify({ denoPath: Deno.execPath() }),
        stderr: "",
      });
    // Without ci.yml the tests get no permissions, so this one fails.
    const bare = await realTests(swamp)(dir);
    assertEquals(bare.tests, [{
      name: "reads and writes a file",
      passed: false,
    }]);
    await Deno.writeTextFile(`${dir}/.github/workflows/ci.yml`, CI);
    const run = await realTests(swamp)(dir);
    assertEquals(run.tests, [{
      name: "reads and writes a file",
      passed: true,
    }]);
    // Combined short flags reach deno, and another command's do not.
    const publishTests = (tests: string) =>
      Deno.writeTextFile(
        `${dir}/.github/workflows/ci.yml`,
        `jobs:\n  publish:\n    with:\n      tests: ${tests}\n`,
      );
    await publishTests("deno test -RW extensions/models/");
    assertEquals((await realTests(swamp)(dir)).tests, [{
      name: "reads and writes a file",
      passed: true,
    }]);
    await publishTests("cp -R -W a b && deno test extensions/models/");
    assertEquals((await realTests(swamp)(dir)).tests, [{
      name: "reads and writes a file",
      passed: false,
    }]);
    // A command it can't read is reported, and nothing runs.
    await publishTests("deno test -R a/ && deno test -A extensions/models/");
    const refused = await realTests(swamp)(dir);
    assertEquals(refused.tests, null);
    assertEquals(refused.error?.includes("more than once"), true);
    // A quoted filter is one word, as the shell passes it.
    await publishTests('deno test -RW --filter "reads and" extensions/models/');
    assertEquals((await realTests(swamp)(dir)).tests, [{
      name: "reads and writes a file",
      passed: true,
    }]);
    // No deno test command: the tests run with none, and the run says so.
    await publishTests("deno task test");
    const task = await realTests(swamp)(dir);
    assertEquals(task.tests, [{
      name: "reads and writes a file",
      passed: false,
    }]);
    assertStringIncludes(task.note ?? "", "runs no deno test");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// Prints the permissions deno gave it, for comparing two runs.
const PROBE = `Deno.test("probe -A x", () => {
  const q = (d: Deno.PermissionDescriptor) => Deno.permissions.querySync(d).state;
  console.log("PERMISSIONS " + JSON.stringify([
    q({ name: "read" }), q({ name: "read", path: "a b" }),
    q({ name: "write" }), q({ name: "write", path: ". x" }),
    q({ name: "env" }), q({ name: "env", variable: "HOME" }),
    q({ name: "env", variable: "PATH" }), q({ name: "net" }),
    q({ name: "net", host: "localhost" }), q({ name: "run" }),
    q({ name: "sys" }), q({ name: "ffi" }), q({ name: "import" }),
  ]));
});
`;

Deno.test("testPermissions: deno given its flags gets the permissions the shell gives the command", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${dir}/bin`);
    await Deno.symlink(Deno.execPath(), `${dir}/bin/deno`);
    await Deno.writeTextFile(`${dir}/probe_test.ts`, PROBE);
    const permissions = async (cmd: string, args: string[]) => {
      const out = await new Deno.Command(cmd, {
        args,
        cwd: dir,
        env: { PATH: `${dir}/bin:${Deno.env.get("PATH")}`, NO_COLOR: "1" },
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
      }).output();
      const text = new TextDecoder().decode(out.stdout);
      return text.match(/^PERMISSIONS (.*)$/m)?.[1] ??
        `no permissions printed: ${text}${
          new TextDecoder().decode(out.stderr)
        }`;
    };
    for (
      const [command, flags] of [
        [
          `echo "x && deno test -A" > /dev/null; NO_COLOR=1 deno test -R --filter "probe -A" --allow-write='. x' probe_test.ts # -A`,
          ["-R", "--allow-write=. x"],
        ],
        [
          `printf '%s\\n' 'a;b|c#' | grep -c b > /dev/null && deno test -RE=HOME --deny-env=PATH probe_test.ts 2>&1 | cat`,
          ["-RE=HOME", "--deny-env=PATH"],
        ],
        [
          `deno test \\\n  -N=localhost \\\n  --allow-read="a b" \\\n  probe_test.ts # --allow-all`,
          ["-N=localhost", "--allow-read=a b"],
        ],
        ["deno test --seed 7 \\-S probe_test.ts", ["-S"]],
        // A carriage return is part of a word to sh, not a space.
        ["deno test --junit-path=j\r-A probe_test.ts", []],
      ] as Array<[string, string[]]>
    ) {
      assertEquals(flagsOf(testsIs(command)), flags, command);
      // CI runs the tests command with sh (puddle-tooling's publish.sh).
      const shell = await permissions("sh", ["-c", command]);
      assertEquals(shell.startsWith("["), true, shell);
      assertEquals(
        await permissions(Deno.execPath(), ["test", ...flags, "probe_test.ts"]),
        shell,
        command,
      );
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
