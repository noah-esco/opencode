import { describe, expect, test } from "bun:test"
import { classify, describeVerdict, failedEntries, failedTests, packageOf, parseArgs, validSlug } from "./sandbox"

describe("sandbox args", () => {
  test("keeps the command word when --from is absent", () => {
    // Regression: fromIndex of -1 made fromIndex + 1 point at index 0, so the
    // command was filtered out and every invocation looked unknown.
    expect(parseArgs(["new", "my-box"])).toMatchObject({ command: "new", slug: "my-box", from: "HEAD" })
  })

  test("consumes --from and its value without losing positionals", () => {
    expect(parseArgs(["new", "my-box", "--from", "origin/custom"])).toMatchObject({
      command: "new",
      slug: "my-box",
      from: "origin/custom",
    })
  })

  test("--from before the positionals still leaves them intact", () => {
    expect(parseArgs(["--from", "HEAD~3", "gate", "my-box"])).toMatchObject({
      command: "gate",
      slug: "my-box",
      from: "HEAD~3",
    })
  })

  test("reports a dangling --from instead of treating the next flag as a ref", () => {
    expect(parseArgs(["new", "--from"]).error).toBe("--from needs a ref")
  })

  test("defaults the slug and reads the flags", () => {
    expect(parseArgs(["gate", "--json", "--no-baseline"])).toMatchObject({
      command: "gate",
      slug: "default",
      json: true,
      baseline: false,
    })
  })

  test("--force is off unless asked for, since it lets discard delete commits", () => {
    expect(parseArgs(["discard", "my-box"]).force).toBe(false)
    expect(parseArgs(["discard", "my-box", "--force"]).force).toBe(true)
  })

  test("no arguments yields no command so the caller can print usage", () => {
    expect(parseArgs([]).command).toBeUndefined()
  })
})

describe("slugs", () => {
  test("accepts lowercase words and hyphens", () => {
    expect(validSlug("fix-scroll-2")).toBe(true)
  })

  test("rejects anything that could escape the sandbox root or break a branch name", () => {
    for (const bad of ["../escape", "Caps", "under_score", "-leading", "has space", ""]) {
      expect(validSlug(bad)).toBe(false)
    }
  })
})

describe("turbo output", () => {
  const output = `
@opencode-ai/app:test:  1 fail
@opencode-ai/http-recorder:build: error: script "build" exited with code 1
 ERROR  @opencode-ai/app#test: command (/tmp/box/packages/app) bun run test exited (1)
 ERROR  @opencode-ai/http-recorder#build: command (/tmp/box) bun run build exited (1)
 Tasks:    5 successful, 8 total
Failed:    @opencode-ai/app#test
`

  test("collects every failing package#task, including tasks it did not ask for", () => {
    // A build failing underneath a test via dependsOn has to be comparable too,
    // otherwise it is invisible to the baseline.
    expect(failedEntries(output)).toEqual(["@opencode-ai/app#test", "@opencode-ai/http-recorder#build"])
  })

  test("does not invent failures from clean output", () => {
    expect(failedEntries(" Tasks:    30 successful, 30 total\n")).toEqual([])
  })

  test("reports each failure once", () => {
    expect(failedEntries(` ERROR  a#test: x\n ERROR  a#test: y\n`)).toEqual(["a#test"])
  })
})

describe("bun test output", () => {
  const output = `@opencode-ai/app:test: (fail) desktop native locale detection > uses Unicode likely subtags [0.66ms]
@opencode-ai/app:test: (fail) closed tabs > falls back to the previous tab [12ms]
@opencode-ai/app:test:  2 fail
@opencode-ai/ui:test: (fail) button > renders
`

  test("names each failing test with its package, timing stripped", () => {
    expect(failedTests(output)).toEqual([
      "@opencode-ai/app::desktop native locale detection > uses Unicode likely subtags",
      "@opencode-ai/app::closed tabs > falls back to the previous tab",
      "@opencode-ai/ui::button > renders",
    ])
  })

  test("ignores passing output", () => {
    expect(failedTests("@opencode-ai/app:test:  752 pass\n@opencode-ai/app:test: (pass) a > b [1ms]\n")).toEqual([])
  })
})

describe("package ownership", () => {
  const packages = [
    { name: "@opencode-ai/sdk", dir: "packages/sdk/js" },
    { name: "@opencode-ai/app", dir: "packages/app" },
    { name: "opencode", dir: "packages/opencode" },
  ].sort((a, b) => b.dir.length - a.dir.length)

  test("maps a file to its package", () => {
    expect(packageOf("packages/app/src/context/closed-tabs.ts", packages)).toBe("@opencode-ai/app")
  })

  test("prefers the nested workspace over its parent path", () => {
    expect(packageOf("packages/sdk/js/src/index.ts", packages)).toBe("@opencode-ai/sdk")
  })

  test("does not match a directory that merely shares a prefix", () => {
    expect(packageOf("packages/application/src/index.ts", packages)).toBeUndefined()
  })

  test("returns undefined for files outside any package", () => {
    expect(packageOf("script/sandbox.ts", packages)).toBeUndefined()
    expect(packageOf("AGENTS.md", packages)).toBeUndefined()
  })
})

describe("verdicts", () => {
  const base = { tasks: ["@opencode-ai/app#test"], tests: ["@opencode-ai/app::locale > uses subtags"] }

  test("the test that was already failing is inherited, not a regression", () => {
    expect(
      classify({ tasks: ["@opencode-ai/app#test"], tests: ["@opencode-ai/app::locale > uses subtags"] }, base),
    ).toEqual({ inherited: ["@opencode-ai/app::locale > uses subtags"], regressions: [] })
  })

  test("a DIFFERENT failing test in the same package is a regression", () => {
    // The hole this exists to close: comparing at `@opencode-ai/app#test` would
    // excuse this, because that package already fails one test at base.
    expect(
      classify(
        {
          tasks: ["@opencode-ai/app#test"],
          tests: ["@opencode-ai/app::locale > uses subtags", "@opencode-ai/app::closed tabs > picks the next tab"],
        },
        base,
      ),
    ).toEqual({
      inherited: ["@opencode-ai/app::locale > uses subtags"],
      regressions: ["@opencode-ai/app::closed tabs > picks the next tab"],
    })
  })

  test("a newly failing task is a regression", () => {
    expect(classify({ tasks: ["@opencode-ai/app#typecheck"], tests: [] }, base)).toEqual({
      inherited: [],
      regressions: ["@opencode-ai/app#typecheck"],
    })
  })

  test("test-level detail supersedes the package-level test failure", () => {
    // Reported once as the failing test, never also as a failing package.
    expect(classify({ tasks: ["a#test"], tests: ["a::one > two"] }, { tasks: [], tests: [] })).toEqual({
      inherited: [],
      regressions: ["a::one > two"],
    })
  })

  test("a package-level test failure with no detail still counts, e.g. a crash before any test ran", () => {
    expect(classify({ tasks: ["a#test"], tests: [] }, { tasks: [], tests: [] })).toEqual({
      inherited: [],
      regressions: ["a#test"],
    })
  })

  test("without a baseline everything counts, so the gate cannot silently excuse a break", () => {
    expect(classify({ tasks: ["a#typecheck"], tests: ["a::x > y"] }, null)).toEqual({
      inherited: [],
      regressions: ["a#typecheck", "a::x > y"],
    })
  })

  test("clean is clean", () => {
    expect(classify({ tasks: [], tests: [] }, base)).toEqual({ inherited: [], regressions: [] })
  })

  test("the reason names regressions first, then explains an ignored baseline", () => {
    expect(describeVerdict(["b#test"], ["a#test"])).toBe("1 regression(s): b#test")
    expect(describeVerdict([], ["a#test"])).toBe("no regressions (1 pre-existing failure(s) ignored)")
    expect(describeVerdict([], [])).toBe("typecheck and test passed")
  })
})
