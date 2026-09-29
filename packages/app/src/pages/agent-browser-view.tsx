import { createEffect, createSignal, onCleanup, type JSX } from "solid-js"

/**
 * Live view of the browser the AGENT drives.
 *
 * Connects to the dedicated Chromium on 9333 over CDP and renders its
 * Page.screencastFrame stream. This is the same browser Playwright MCP is
 * pointed at, so what you see is literally what the agent sees - no more
 * guessing whether its description matches the page.
 *
 * Deliberately 9333 and not the Electron app's own CDP on 9222: that endpoint
 * also exposes the app's renderer, so anything attached to it could drive the
 * UI it is running inside.
 */
export const AGENT_CDP = "http://127.0.0.1:9333"

export function AgentBrowserView(props: { active: boolean }): JSX.Element {
  const [frame, setFrame] = createSignal<string | undefined>()
  const [status, setStatus] = createSignal("connecting")

  createEffect(() => {
    if (!props.active) return
    let ws: WebSocket | undefined
    let cancelled = false
    let id = 0

    const start = async () => {
      try {
        const targets = await fetch(`${AGENT_CDP}/json/list`).then((r) => r.json())
        const page = (targets as Array<{ type: string; webSocketDebuggerUrl?: string }>).find(
          (t) => t.type === "page" && t.webSocketDebuggerUrl,
        )
        if (!page?.webSocketDebuggerUrl) {
          setStatus("no page open in the agent browser")
          return
        }
        if (cancelled) return
        ws = new WebSocket(page.webSocketDebuggerUrl)
        ws.onopen = () => {
          setStatus("live")
          ws?.send(JSON.stringify({ id: ++id, method: "Page.enable" }))
          ws?.send(
            JSON.stringify({
              id: ++id,
              method: "Page.startScreencast",
              params: { format: "jpeg", quality: 60, maxWidth: 1200, maxHeight: 1600 },
            }),
          )
        }
        ws.onmessage = (event) => {
          const msg = JSON.parse(event.data as string)
          if (msg.method !== "Page.screencastFrame") return
          setFrame(`data:image/jpeg;base64,${msg.params.data}`)
          // Acking is required or Chromium stops sending frames.
          ws?.send(
            JSON.stringify({
              id: ++id,
              method: "Page.screencastFrameAck",
              params: { sessionId: msg.params.sessionId },
            }),
          )
        }
        ws.onerror = () => setStatus("agent browser unreachable")
        ws.onclose = () => setStatus("disconnected")
      } catch {
        setStatus("agent browser unreachable")
      }
    }
    void start()

    onCleanup(() => {
      cancelled = true
      try {
        ws?.close()
      } catch {
        // closing a socket that never opened is fine
      }
    })
  })

  return (
    <div class="flex-1 min-h-0 w-full flex items-center justify-center bg-v2-background-bg-deep overflow-hidden">
      {frame() ? (
        <img src={frame()} alt="Agent browser" class="max-h-full max-w-full object-contain" />
      ) : (
        <p class="px-4 text-center text-12-regular text-v2-text-tertiary">
          {status() === "live" ? "waiting for the agent to navigate…" : status()}
        </p>
      )}
    </div>
  )
}
