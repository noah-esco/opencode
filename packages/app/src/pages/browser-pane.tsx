import { createEffect, createSignal, Show, type JSX } from "solid-js"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"

/**
 * In-app browser pane.
 *
 * Why a real rendering browser rather than webfetch: example.com serves 713
 * bytes of HTML and loads five of its six languages from /s.js. Static fetching
 * is structurally blind to anything JS builds, and returns confident, wrong-by-
 * omission answers. This pane renders the same page the agent works from.
 *
 * Security: the <webview> runs in its own persist: partition with node
 * integration off and popups denied, so page content cannot reach the app
 * renderer or the preload bridge.
 */
const [open, setOpen] = createSignal(false)
const [url, setUrl] = createSignal("https://example.com")

export const browserOpen = open
export const toggleBrowser = () => setOpen((v) => !v)
export const openBrowserAt = (next: string) => {
  setUrl(next)
  setOpen(true)
}

/**
 * Follow a navigation the AGENT made, so the pane shows the page it is actually
 * working from. Does not force the pane open - if you closed it, it stays shut
 * and simply catches up when you reopen it.
 */
export const followAgentUrl = (next: string) => {
  if (!next || next === url()) return
  setUrl(next)
}

export function BrowserPane(): JSX.Element {
  const [input, setInput] = createSignal(url())
  let view: HTMLElement | undefined

  // <webview> does not reliably reload when its src attribute changes after
  // mount, so drive it explicitly when the url signal moves (e.g. the agent
  // navigated and followAgentUrl fired).
  createEffect(() => {
    const next = url()
    setInput(next)
    // @ts-expect-error webview element API
    if (view?.getURL?.() !== next) view?.loadURL?.(next)
  })

  const go = (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) return
    const next = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    setUrl(next)
    setInput(next)
    // @ts-expect-error webview element API
    view?.loadURL?.(next)
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
            // @ts-expect-error webview element API
            onClick={() => view?.goBack?.()}
          />
          <IconButtonV2
            type="button"
            variant="ghost-muted"
            size="small"
            aria-label="Reload"
            icon={<IconV2 name="outline-reset" />}
            // @ts-expect-error webview element API
            onClick={() => view?.reload?.()}
          />
          <input
            value={input()}
            onInput={(e) => setInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") go(input())
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
        <webview
          ref={(el: HTMLElement) => (view = el)}
          src={url()}
          partition="persist:agent-browser"
          allowpopups={false}
          class="flex-1 min-h-0 w-full bg-white"
        />
      </aside>
    </Show>
  )
}
