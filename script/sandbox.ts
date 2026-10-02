#!/usr/bin/env bun

// Isolated worktrees for changes that should be proven before they reach your
// checkout. Nothing here ever writes to the main working tree or to `custom`:
// a sandbox is a separate worktree on its own branch, and promoting one prints
// a command for you to run rather than merging anything itself.

import path from "node:path"
import fs from "node:fs/promises"

const ROOT = path.resolve(import.meta.dir, "..")
export const SANDBOX_ROOT = process.env["OPENCODE_SANDBOX_DIR"] ?? path.join(path.dirname(ROOT), "opencode-sandboxes")
const META_DIR = path.join(SANDBOX_ROOT, ".meta")

/** Tasks the gate runs, in order. Both must be clean for a pass. */
export const TASKS = ["typecheck", "test"] as const

export type Verdict = {
  at: string
  pass: boolean
  reason: string
  packages: string[]
  /** Failures this change introduced. The only thing the verdict turns on. */
  regressions: string[]
  /** Failures already present at base. Reported, never counted against you. */
  inherited: string[]
}

export type Meta = {
  slug: string
  branch: string
  dir: string
  base: string
  created: string
  /** What already failed at base, or null if never measured. */
  baseline: Failures | null
  verdict?: Verdict
}

export const usage = `Usage: bun run script/sandbox.ts <command> [slug] [options]

  new [slug] [--from <ref>]   create a worktree, install deps, measure the baseline
  gate [slug]                 typecheck + test the packages the sandbox touched
  diff [slug]                 show what the sandbox changed
  list                        every sandbox and its last verdict
  discard [slug]              delete the worktree and its branch
  promote [slug]              print how to land the work (never lands it)

Options:
  --json                      machine-readable output
  --from <ref>                base the new sandbox on <ref> (default: HEAD)
  --no-baseline               skip baseline measurement; every failure reads as new
  --force                     let discard delete commits that exist nowhere else

Sandboxes live in ${SANDBOX_ROOT} and cost about 2.3G each, so reuse a slug
rather than accumulating them.`

export function parseArgs(argv: string[]) {
  const fromIndex = argv.indexOf("--from")
  // Guard on fromIndex: with --from absent it is -1, and fromIndex + 1 would
  // otherwise swallow the command word at index 0.
  const consumed = fromIndex === -1 ? new Set<number>() : new Set([fromIndex, fromIndex + 1])
  const positional = argv.filter((arg, index) => !arg.startsWith("-") && !consumed.has(index))
  const from = fromIndex === -1 ? "HEAD" : argv[fromIndex + 1]
  return {
    json: argv.includes("--json"),
    force: argv.includes("--force"),
    baseline: !argv.includes("--no-baseline"),
    help: argv.includes("--help") || argv.includes("-h"),
    from: from ?? "HEAD",
    command: positional[0],
    slug: positional[1] ?? "default",
    error: fromIndex !== -1 && !from ? "--from needs a ref" : undefined,
  }
}

/** Slugs become directory and branch names, so keep them boring. */
export function validSlug(slug: string) {
  return /^[a-z0-9][a-z0-9-]*$/.test(slug)
}

/**
 * Turbo reports failures as `ERROR  <package>#<task>:`. Every task is collected,
 * not just the one we asked for, because turbo's `dependsOn` can fail a `build`
 * underneath a `test` and that failure has to be comparable across runs too.
 */
export function failedEntries(output: string) {
  const entries = [...output.matchAll(/ERROR\s+(\S+?)#(\S+?):/g)].map((match) => `${match[1]}#${match[2]}`)
  return [...new Set(entries)]
}

/**
 * Individual failing tests, as `package::test name`.
 *
 * Package granularity is not enough. `packages/app` already has one failing
 * test, so comparing at `@opencode-ai/app#test` would excuse every new test
 * failure in the package where all the custom work lives. Bun prints
 * `(fail) <describe> > <name> [1.23ms]` and turbo prefixes it with
 * `<package>:test:`, which is enough to compare run to run.
 */
export function failedTests(output: string) {
  const found = [...output.matchAll(/^(\S+):\S+:\s+\(fail\)\s+(.*?)(?:\s+\[[\d.]+\s*m?s\])?$/gm)].map(
    (match) => `${match[1]}::${match[2]}`,
  )
  return [...new Set(found)]
}

export type Failures = { tasks: string[]; tests: string[] }

/** The workspace package a repo-relative file belongs to, or undefined. */
export function packageOf(file: string, packages: { name: string; dir: string }[]) {
  return packages.find((pkg) => file === pkg.dir || file.startsWith(`${pkg.dir}/`))?.name
}

/**
 * Split failures into ones this change caused and ones it inherited. The repo
 * has failing tests of its own; a gate that cannot tell them apart fails
 * everything and gets ignored.
 */
export function classify(now: Failures, baseline: Failures | null) {
  const base = baseline ?? { tasks: [], tests: [] }
  // Where test-level detail exists, it supersedes the package-level `#test`
  // failure, so one broken test is not also reported as a broken package.
  const explained = new Set(now.tests.map((entry) => `${entry.split("::")[0]}#test`))
  const tasks = now.tasks.filter((entry) => !explained.has(entry))
  return {
    regressions: [
      ...tasks.filter((entry) => !base.tasks.includes(entry)),
      ...now.tests.filter((entry) => !base.tests.includes(entry)),
    ],
    inherited: [
      ...tasks.filter((entry) => base.tasks.includes(entry)),
      ...now.tests.filter((entry) => base.tests.includes(entry)),
    ],
  }
}

export function describeVerdict(regressions: string[], inherited: string[]) {
  if (regressions.length > 0) return `${regressions.length} regression(s): ${regressions.join(", ")}`
  if (inherited.length > 0) return `no regressions (${inherited.length} pre-existing failure(s) ignored)`
  return "typecheck and test passed"
}

const run = async (cmd: string[], cwd: string, quiet = false) => {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" })
  let output = ""
  const tee = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder()
    for await (const chunk of stream) {
      const text = decoder.decode(chunk, { stream: true })
      output += text
      if (!quiet) process.stdout.write(text)
    }
  }
  await Promise.all([tee(proc.stdout), tee(proc.stderr)])
  return { code: await proc.exited, output }
}

const capture = async (cmd: string[], cwd: string) => (await run(cmd, cwd, true)).output.trim()

const exists = async (target: string) =>
  await fs
    .stat(target)
    .then(() => true)
    .catch(() => false)

/** Every workspace package as name + repo-relative dir, longest dir first so nested workspaces win. */
const workspaces = async () => {
  const manifest = await Bun.file(path.join(ROOT, "package.json")).json()
  const globs: string[] = manifest.workspaces.packages
  const found: { name: string; dir: string }[] = []
  for (const glob of globs) {
    for await (const file of new Bun.Glob(`${glob}/package.json`).scan({ cwd: ROOT })) {
      const name = (await Bun.file(path.join(ROOT, file)).json()).name
      if (name) found.push({ name, dir: path.dirname(file) })
    }
  }
  return found.sort((a, b) => b.dir.length - a.dir.length)
}

/** Run the gate tasks and return what failed, at both package and test level. */
const runTasks = async (cwd: string, filters: string[]): Promise<Failures> => {
  const tasks: string[] = []
  const tests: string[] = []
  for (const task of TASKS) {
    console.log(`\n--- turbo ${task} ---`)
    const result = await run(["bun", "turbo", task, ...filters], cwd)
    tests.push(...failedTests(result.output))
    if (result.code !== 0) {
      const entries = failedEntries(result.output)
      // A non-zero exit turbo did not attribute to a package still has to
      // count, or a crash in turbo itself would read as a pass.
      tasks.push(...(entries.length > 0 ? entries : [`unattributed#${task}`]))
    }
  }
  return { tasks: [...new Set(tasks)], tests: [...new Set(tests)] }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.command) {
    console.log(usage)
    process.exit(args.command ? 0 : 1)
  }
  if (args.error) {
    console.error(args.error)
    process.exit(1)
  }
  if (!validSlug(args.slug)) {
    console.error(`Bad slug "${args.slug}": use lowercase letters, digits and hyphens.`)
    process.exit(1)
  }

  const slug = args.slug
  const dir = path.join(SANDBOX_ROOT, slug)
  const branch = `sandbox-${slug}`
  const metaFile = path.join(META_DIR, `${slug}.json`)

  // A path bug here would delete real work, so refuse anything not plainly
  // inside the sandbox root.
  if (path.relative(SANDBOX_ROOT, dir) !== slug || dir === ROOT) {
    console.error(`Refusing to operate on ${dir}: not a sandbox path.`)
    process.exit(1)
  }

  const readMeta = async (file: string): Promise<Meta | undefined> =>
    await Bun.file(file)
      .json()
      .catch(() => undefined)

  const writeMeta = async (meta: Meta) => {
    await fs.mkdir(META_DIR, { recursive: true })
    await Bun.write(metaFile, JSON.stringify(meta, null, 2) + "\n")
  }

  const requireSandbox = async () => {
    const meta = await readMeta(metaFile)
    if (!meta || !(await exists(dir))) {
      console.error(`No sandbox "${slug}". Create it with: bun run script/sandbox.ts new ${slug}`)
      process.exit(1)
    }
    return meta
  }

  const changedPackages = async (base: string) => {
    const tracked = await capture(["git", "diff", "--name-only", base], dir)
    const untracked = await capture(["git", "ls-files", "--others", "--exclude-standard"], dir)
    const files = [...tracked.split("\n"), ...untracked.split("\n")].filter(Boolean)
    const all = await workspaces()
    const names = files.map((file) => packageOf(file, all)).filter((name): name is string => name !== undefined)
    return { files, packages: [...new Set(names)].sort() }
  }

  const emit = (payload: unknown, lines: string[]) => {
    if (args.json) console.log(JSON.stringify(payload, null, 2))
    else lines.forEach((line) => console.log(line))
  }

  if (args.command === "new") {
    if (await exists(dir)) {
      console.error(`Sandbox "${slug}" already exists at ${dir}. Use gate, discard, or pick another slug.`)
      process.exit(1)
    }
    const base = await capture(["git", "rev-parse", args.from], ROOT)
    if (!base) {
      console.error(`Cannot resolve ref "${args.from}".`)
      process.exit(1)
    }
    await fs.mkdir(SANDBOX_ROOT, { recursive: true })
    // -B so a leftover branch of the same name is reset rather than blocking.
    const added = await run(["git", "worktree", "add", "-B", branch, dir, base], ROOT)
    if (added.code !== 0) process.exit(added.code)

    console.log(`\nInstalling dependencies in ${dir} (about 15s)...`)
    const installed = await run(["bun", "install", "--frozen-lockfile"], dir)
    if (installed.code !== 0) {
      console.error("Install failed. The worktree is left in place so you can look at it.")
      process.exit(installed.code)
    }

    if (args.baseline) {
      console.log(`\nMeasuring the baseline. The worktree is pristine, so anything failing now`)
      console.log(`is not your change's fault - the gate needs to know that to judge it later.`)
      console.log(`A few minutes once; it also warms turbo's cache.\n`)
    }
    const baseline = args.baseline ? await runTasks(dir, []) : null

    await writeMeta({ slug, branch, dir, base, created: new Date().toISOString(), baseline })
    emit({ slug, branch, dir, base, baseline }, [
      ``,
      `Sandbox "${slug}" ready.`,
      `  worktree  ${dir}`,
      `  branch    ${branch}`,
      `  base      ${base.slice(0, 10)}`,
      baseline === null
        ? `  baseline  not measured; every failure will read as new`
        : `  baseline  ${baseline.tasks.length + baseline.tests.length} pre-existing failure(s)${
            [...baseline.tasks, ...baseline.tests].length
              ? `: ${[...baseline.tasks, ...baseline.tests].join(", ")}`
              : ""
          }`,
      ``,
      `Make changes in the worktree, then: bun run script/sandbox.ts gate ${slug}`,
    ])
    process.exit(0)
  }

  if (args.command === "gate") {
    const meta = await requireSandbox()
    const changed = await changedPackages(meta.base)

    if (changed.packages.length === 0) {
      const reason = changed.files.length === 0 ? "no changes in the sandbox" : "changes touch no workspace package"
      const verdict: Verdict = {
        at: new Date().toISOString(),
        pass: false,
        reason,
        packages: [],
        regressions: [],
        inherited: [],
      }
      await writeMeta({ ...meta, verdict })
      emit({ slug, ...verdict }, [`Nothing to gate: ${reason}.`])
      process.exit(1)
    }

    console.log(`Gating ${changed.packages.length} package(s): ${changed.packages.join(", ")}`)
    const failed = await runTasks(
      dir,
      changed.packages.flatMap((name) => ["--filter", name]),
    )
    const { inherited, regressions } = classify(failed, meta.baseline)
    const pass = regressions.length === 0

    const verdict: Verdict = {
      at: new Date().toISOString(),
      pass,
      reason: describeVerdict(regressions, inherited),
      packages: changed.packages,
      regressions,
      inherited,
    }
    await writeMeta({ ...meta, verdict })

    emit({ slug, ...verdict }, [
      ``,
      `${pass ? "PASS" : "FAIL"}  ${verdict.reason}`,
      `      packages: ${changed.packages.join(", ")}`,
      ...(inherited.length > 0 ? [`      inherited, not your fault: ${inherited.join(", ")}`] : []),
      ...(meta.baseline === null ? [`      no baseline measured, so every failure above reads as new`] : []),
      ``,
      pass
        ? `A green gate means it compiles and the tests that passed still pass. It is not a review.`
        : `Fix it in ${dir}, or discard: bun run script/sandbox.ts discard ${slug}`,
      ...(pass ? [`See the change: bun run script/sandbox.ts diff ${slug}`] : []),
    ])
    process.exit(pass ? 0 : 1)
  }

  if (args.command === "diff") {
    const meta = await requireSandbox()
    await run(["git", "--no-pager", "diff", "--stat", meta.base], dir)
    const untracked = await capture(["git", "ls-files", "--others", "--exclude-standard"], dir)
    if (untracked) console.log(`\nUntracked:\n${untracked.replace(/^/gm, "  ")}`)
    await run(["git", "--no-pager", "diff", meta.base], dir)
    process.exit(0)
  }

  if (args.command === "list") {
    const files = (await fs.readdir(META_DIR).catch(() => [])).filter((file) => file.endsWith(".json"))
    const all = (await Promise.all(files.map((file) => readMeta(path.join(META_DIR, file))))).filter(
      (meta): meta is Meta => meta !== undefined,
    )
    if (args.json) {
      console.log(JSON.stringify(all, null, 2))
      process.exit(0)
    }
    if (all.length === 0) {
      console.log("No sandboxes. Create one: bun run script/sandbox.ts new <slug>")
      process.exit(0)
    }
    for (const meta of all) {
      const missing = (await exists(meta.dir)) ? "" : "  (worktree missing)"
      const state = meta.verdict ? (meta.verdict.pass ? "PASS" : "FAIL") : "ungated"
      console.log(`${state.padEnd(8)} ${meta.slug.padEnd(20)} ${meta.base.slice(0, 10)}${missing}`)
      if (meta.verdict) console.log(`         ${meta.verdict.reason} (${meta.verdict.at})`)
    }
    process.exit(0)
  }

  if (args.command === "discard") {
    const meta = await requireSandbox()
    // `git branch -D` throws away unmerged commits, so make losing real work an
    // explicit choice rather than the default.
    const commits = await capture(["git", "log", "--oneline", `${meta.base}..HEAD`], dir)
    if (commits && !args.force) {
      console.error(`Sandbox "${slug}" has commits that exist nowhere else:\n`)
      console.error(commits.replace(/^/gm, "  "))
      console.error(`\nLand them first (bun run script/sandbox.ts promote ${slug}),`)
      console.error(`or discard them for good with --force.`)
      process.exit(1)
    }
    const removed = await run(["git", "worktree", "remove", "--force", dir], ROOT)
    if (removed.code !== 0) process.exit(removed.code)
    await run(["git", "branch", "-D", branch], ROOT, true)
    await fs.rm(metaFile, { force: true })
    console.log(`Discarded sandbox "${slug}".`)
    process.exit(0)
  }

  if (args.command === "promote") {
    const meta = await requireSandbox()
    const dirty = await capture(["git", "status", "--porcelain"], dir)
    if (dirty) {
      console.log(`Sandbox "${slug}" has uncommitted changes. Commit them in the worktree first:\n`)
      console.log(`  cd ${dir} && git add -A && git commit\n`)
      process.exit(1)
    }
    const commits = await capture(["git", "log", "--oneline", `${meta.base}..HEAD`], dir)
    if (!commits) {
      console.log(`Sandbox "${slug}" has no commits past its base. Nothing to promote.`)
      process.exit(1)
    }
    if (!meta.verdict?.pass) {
      console.log(`Not gated clean (${meta.verdict?.reason ?? "never gated"}).`)
      console.log(`Run: bun run script/sandbox.ts gate ${slug}\n`)
    }
    console.log(`Commits in "${slug}":\n${commits}\n`)
    console.log(`Read the diff, then land it yourself:\n`)
    console.log(`  bun run script/sandbox.ts diff ${slug}`)
    console.log(`  git cherry-pick ${meta.base}..${branch}\n`)
    console.log(`Nothing was merged, on purpose: the gate proves it compiles, not that it is right.`)
    process.exit(0)
  }

  console.error(`Unknown command "${args.command}"\n`)
  console.error(usage)
  process.exit(1)
}

if (import.meta.main) await main()
