import { createMemo, For, Show, type JSX } from "solid-js"
import { useLocation } from "@solidjs/router"
import { useLayout } from "@/context/layout"
import { useServer } from "@/context/server"
import { useServerSync } from "@/context/server-sync"
import { sessionTitle } from "@/utils/session-title"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { tabHref, tabKey, useTabs, type Tab } from "@/context/tabs"
import { activeMode, setActiveMode, sessionMode, SESSION_MODES, type SessionMode } from "@/context/session-mode"

const LABEL: Record<SessionMode, string> = { code: "Code", chat: "Chat" }

/**
 * Sidebar for the new layout (pages/layout-new.tsx), which ships no sidebar of
 * its own - the titlebar tab strip was the only session navigation.
 *
 * Deliberately driven by the SAME tabs context the strip uses (tabs.store,
 * tabs.info, select/closeTab), so this is genuinely the strip relocated
 * vertically rather than a second, divergent notion of "open sessions".
 */
function ModeSwitch(): JSX.Element {
  return (
    <div
      role="tablist"
      aria-label="Session mode"
      class="flex items-center gap-1 rounded-md bg-v2-background-bg-base p-1"
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
              "bg-v2-background-bg-deep text-v2-text-primary": activeMode() === mode,
              "text-v2-text-tertiary hover:text-v2-text-primary": activeMode() !== mode,
            }}
          >
            {LABEL[mode]}
          </button>
        )}
      </For>
    </div>
  )
}

export function LayoutNewSidebar(): JSX.Element {
  const tabs = useTabs()
  const layout = useLayout()
  const server = useServer()
  const serverSync = useServerSync()
  const location = useLocation()

  // navigate("/new-session") lands on Home, not a composer. A new session is a
  // DRAFT: tabs.newDraft creates it, registers the tab and navigates - the same
  // call the titlebar's "+" makes.
  const newSession = () => {
    const project = layout.projects.list()[0]
    if (!project) return
    void tabs.newDraft({ server: server.key, directory: project.worktree }, "")
  }

  // A draft has no session id yet, so it has no recorded mode - show drafts in
  // both modes rather than hiding work the user has started but not sent.
  const visible = createMemo(() =>
    tabs.store.filter((tab) => (tab.type === "draft" ? true : sessionMode(tab.sessionId) === activeMode())),
  )

  // The live title lives in the sync store; tabs.info is only a fallback for
  // tabs whose session has not loaded yet. Same precedence the titlebar strip
  // uses - reading tabs.info first is why every row said "New session".
  const title = (tab: Tab) => {
    const persisted = tabs.info[tabKey(tab)]?.title?.trim()
    if (tab.type === "draft") return persisted || "New session"
    const live = serverSync().session.get(tab.sessionId)?.title?.trim()
    return sessionTitle(live || persisted || "") || "Untitled session"
  }
  const current = (tab: Tab) => location.pathname === tabHref(tab).split("?")[0]

  return (
    <aside
      data-component="layout-new-sidebar"
      class="w-60 shrink-0 h-full flex flex-col border-r border-v2-border-base bg-v2-background-bg-base"
    >
      <div class="p-2 flex flex-col gap-2">
        <ModeSwitch />
        <button
          type="button"
          onClick={newSession}
          class="flex items-center gap-2 rounded-md px-2 py-1.5 text-13-medium text-v2-text-secondary hover:bg-v2-background-bg-deep hover:text-v2-text-primary"
        >
          <IconV2 name="plus" size="small" />
          <span>New {LABEL[activeMode()].toLowerCase()}</span>
        </button>
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto px-2 pb-2 flex flex-col gap-0.5">
        <Show
          when={visible().length > 0}
          fallback={<p class="px-2 py-3 text-12-regular text-v2-text-tertiary">No {LABEL[activeMode()].toLowerCase()} sessions yet.</p>}
        >
          <For each={visible()}>
            {(tab) => (
              <div
                classList={{
                  "group flex items-center gap-1 rounded-md pr-1": true,
                  "bg-v2-background-bg-deep": current(tab),
                  "hover:bg-v2-background-bg-deep/60": !current(tab),
                }}
              >
                <button
                  type="button"
                  onClick={() => tabs.select(tab)}
                  aria-current={current(tab) ? "page" : undefined}
                  class="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-13-regular text-v2-text-primary"
                >
                  {title(tab)}
                </button>
                <IconButtonV2
                  type="button"
                  variant="ghost-muted"
                  size="small"
                  class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  icon={<IconV2 name="xmark-small" />}
                  aria-label={`Close ${title(tab)}`}
                  onClick={() => {
                    const index = tabs.store.findIndex((item) => tabKey(item) === tabKey(tab))
                    if (index !== -1) tabs.closeTab(index)
                  }}
                />
              </div>
            )}
          </For>
        </Show>
      </div>
    </aside>
  )
}
