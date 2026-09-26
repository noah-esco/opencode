import { For, type JSX } from "solid-js"
import { activeMode, setActiveMode, SESSION_MODES, type SessionMode } from "@/context/session-mode"

const LABEL: Record<SessionMode, string> = {
  code: "Code",
  chat: "Chat",
}

/**
 * Code / Chat switch at the top of the sidebar panel.
 *
 * Code dispatches to the `build` agent (full tools). Chat dispatches to the
 * `chat` agent, which has every tool denied - see packages/opencode/src/agent/agent.ts.
 * Flipping this also filters the session lists below, via sortedRootSessions.
 */
export const ModeSwitch = (): JSX.Element => (
  <div
    data-component="sidebar-mode-switch"
    role="tablist"
    aria-label="Session mode"
    class="mx-3 mt-3 mb-1 shrink-0 flex items-center gap-1 rounded-md bg-background-element p-1"
  >
    <For each={SESSION_MODES}>
      {(mode) => (
        <button
          type="button"
          role="tab"
          aria-selected={activeMode() === mode}
          onClick={() => setActiveMode(mode)}
          classList={{
            "flex-1 rounded px-2 py-1 text-13-medium transition-colors": true,
            "bg-background-base text-text-strong": activeMode() === mode,
            "text-text-weak hover:text-text-strong": activeMode() !== mode,
          }}
        >
          {LABEL[mode]}
        </button>
      )}
    </For>
  </div>
)
