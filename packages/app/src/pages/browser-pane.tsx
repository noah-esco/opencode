import { createSignal, Show, type JSX } from "solid-js"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { AgentBrowserView, agentNavigate, agentGoBack, agentReload } from "./agent-browser-view"

/**
 * In-app browser pane.
 *
 * There is exactly ONE browser: the Chromium on 9333 that Playwright drives.
 * The pane renders its screencast and forwards your clicks and keystrokes back
 * over CDP, so you and the agent are genuinely in the same session rather than
 * looking at two browsers that happen to share a URL.
 *
 * An earlier version also embedded an Electron <webview> for "your own"
 * browsing. That was redundant - and its getURL() fired before the element was
 * dom-ready, which crashed the renderer.
 */
const [open, setOpen] = createSignal(false)
const [url, setUrl] = createSignal("about:blank")

export const browserOpen = open
export const toggleBrowser = () => setOpen((v) => !v)

/** Reflect a navigation the agent made, so the address bar stays truthful. */
export const followAgentUrl = (next: string) => {
  if (next) setUrl(next)
}

export function BrowserPane(): JSX.Element {
  const [input, setInput] = createSignal("")

  const go = (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) return
    const next = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    setUrl(next)
    void agentNavigate(next)
  }

  return (
    <Show when={open()}>
      <aside
        data-component="browser-pane"
        class="w-[480px] shrink-0 h-full flex flex-col border-l border-v2-border-base bg-v2-background-bg-base"
      >
        <div class="shrink-0 flex items-center gap-1 p-2 border-b border-v2-border-base">
          <IconButtonV2
            type="button"
            variant="ghost-muted"
            size="small"
            aria-label="Back"
            icon={<IconV2 name="outline-chevron-down" class="rotate-90" />}
            onClick={() => void agentGoBack()}
          />
          <IconButtonV2
            type="button"
            variant="ghost-muted"
            size="small"
            aria-label="Reload"
            icon={<IconV2 name="outline-reset" />}
            onClick={() => void agentReload()}
          />
          <input
            value={input() || url()}
            onInput={(e) => setInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                go(e.currentTarget.value)
                setInput("")
                e.currentTarget.blur()
              }
            }}
            spellcheck={false}
            aria-label="Address"
            class="min-w-0 flex-1 rounded-md bg-v2-background-bg-deep px-2 py-1 text-13-regular text-v2-text-text-base focus:outline-none"
          />
          <IconButtonV2
            type="button"
            variant="ghost-muted"
            size="small"
            aria-label="Close browser"
            icon={<IconV2 name="xmark-small" />}
            onClick={() => setOpen(false)}
          />
        </div>
        <AgentBrowserView active={open()} />
      </aside>
    </Show>
  )
}
