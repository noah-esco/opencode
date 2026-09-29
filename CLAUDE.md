# Working on this fork (Claude Code notes)

This file is for Claude Code. OpenCode itself never reads it: project instruction
resolution takes the **first** match of `AGENTS.md` → `CLAUDE.md` and stops
(`packages/opencode/src/session/instruction.ts:122`), and this repo has an
`AGENTS.md`. So notes here cost the local model nothing. Guidance meant for the
local agent belongs in `~/.config/opencode/AGENTS.md` instead — that file
shadows `~/.claude/CLAUDE.md` globally by the same first-match rule.

Follow `AGENTS.md` for style, commits, and branch names. This file only covers
what is specific to the fork.

## The fork

- `origin` = `noah-esco/opencode`, `upstream` = `sst/opencode`, work happens on `custom`.
- Rebase `custom` onto `upstream/dev`. The customizations are deliberately
  additive and localized, which is why 28 commits rebased over 29 upstream ones
  with no conflicts. Keep it that way — prefer new files over edits to shared ones.

## Where the custom work lives

| Area | File |
| --- | --- |
| Sidebar (code/chat switch, session history) | `packages/app/src/pages/layout-new-sidebar.tsx` |
| Close-tab selection + its tests | `packages/app/src/context/closed-tabs.ts` |
| Voice input (push-to-talk → STT) | `packages/app/src/context/voice-input.ts` |
| TTFT / decode-rate readout | `packages/app/src/context/llm-metrics.ts` |
| In-window browser (CDP screencast) | `packages/app/src/pages/browser-pane.tsx`, `agent-browser-view.tsx` |
| Reasoning-only turn rendering | `packages/app/src/pages/session/timeline/rows.ts` (`promoteReasoning`) |
| Tool row styling | `packages/session-ui/src/components/basic-tool.tsx` |
| `chat` agent + `projectContext` flag | `packages/opencode/src/agent/agent.ts`, `prompt/chat.txt` |
| Project-context gating | `packages/opencode/src/session/prompt.ts` |

`packages/app/src/context/session-mode.ts` is mostly vestigial — `Session.agent`
carries the mode now. Its localStorage layer can go.

UI edits must target the **new** layout. `settings.general.newLayoutDesigns` is on
here, which routes to `layout-new.tsx`; editing `layout.tsx` changes nothing you
can see. Check which one is live before editing.

## Local stack (outside the repo)

- `~/.config/opencode/opencode.jsonc` — Ollama provider, model list, the `tools`
  allow/deny map, Playwright MCP wired to `--cdp-endpoint http://127.0.0.1:9333`.
- `~/.config/opencode/AGENTS.md` — guidance for the local model.
- `~/.local/share/voice-env/bin/stt-server.py` — STT on `127.0.0.1:8385`.
- LaunchAgents: `local.ollama.warm`, `local.stt.server`, `local.agent.browser`.
  Use `ProcessType Interactive`; `Background` throttles CPU QoS badly (it was a
  large part of STT taking 5–24s instead of ~1s). launchd also gives a minimal
  PATH, so use absolute binary paths inside these scripts.
- Web search needs `OPENCODE_ENABLE_EXA=1`; `webSearchEnabled()` otherwise gates
  on the LLM provider ID and stays off for Ollama.

## Verifying changes

- Typecheck from the package dir (`cd packages/app && bun typecheck`), never `tsc`.
- Tests cannot run from the repo root; run them from the package dir.
- **Restart the app.** A reload does not pick up main-process or build changes.
- The dev log forwards renderer **errors** only — `console.log` never appears
  there. Adding logs to debug a renderer problem is a wasted round trip; throw,
  or surface state in the UI.

## Lessons paid for once already

**Escalating special cases mean the design is wrong.** The code/chat mode switch
took seven rounds. Each round added a guard to one `createEffect` — exempt
drafts, handle the load race, pick a default for unknown modes — and each guard
created the next bug. What finally worked *removed* capability: the effect may
no longer create sessions, only move between existing ones. After the second
patch to the same logic, stop patching and question the shape.

**Do not assert past the evidence.** Three separate retractions came from this:
a 1.5–2.5x speculative-decoding claim that measured 22.67 vs 22.58 tok/s; an
accusation that the model fabricated multilingual text on example.com, when the
page really does rotate languages via `/s.js` that `curl` never fetches; and a
localStorage workaround for `Session.agent`, a field that already existed and
was only missing from the truncated dump I checked. Measure before quoting
numbers, use a browser for pages that render with JS, and confirm a field is
absent in the schema rather than in a sample.

**Line-anchored edits over string matching.** Whitespace mismatches made
string-replacement edits fail silently here more than once.
