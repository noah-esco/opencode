import { createEffect, createSignal, onCleanup, type JSX } from "solid-js"
import { followAgentUrl } from "./browser-pane"

/**
 * Live, interactive view of the browser the AGENT drives.
 *
 * Renders the Page.screencastFrame stream from the dedicated Chromium on 9333
 * and forwards clicks, scrolls and keystrokes back over CDP, so you and the
 * agent share one session.
 *
 * Deliberately 9333 and NOT the Electron app's own CDP on 9222: that endpoint
 * also lists the app's renderer as a target, so anything attached there could
 * drive the UI it is running inside.
 */
export const AGENT_CDP = "http://127.0.0.1:9333"

let socket: WebSocket | undefined
let seq = 0
/** Natural size of the last frame, for mapping click coordinates. */
let frameSize = { w: 0, h: 0 }

function send(method: string, params: Record<string, unknown> = {}) {
  if (socket?.readyState !== WebSocket.OPEN) return
  socket.send(JSON.stringify({ id: ++seq, method, params }))
}

export async function agentNavigate(url: string) {
  send("Page.navigate", { url })
}
export async function agentGoBack() {
  // No CDP "go back"; the page's own history is the reliable route.
  send("Runtime.evaluate", { expression: "history.back()" })
}
export async function agentReload() {
  send("Page.reload", {})
}

export function AgentBrowserView(props: { active: boolean }): JSX.Element {
  const [frame, setFrame] = createSignal<string | undefined>()
  const [status, setStatus] = createSignal("connecting")
  let img: HTMLImageElement | undefined

  createEffect(() => {
    if (!props.active) return
    let cancelled = false

    const start = async () => {
      try {
        const targets = await fetch(`${AGENT_CDP}/json/list`).then((r) => r.json())
        const page = (targets as Array<{ type: string; url?: string; webSocketDebuggerUrl?: string }>).find(
          (t) => t.type === "page" && t.webSocketDebuggerUrl,
        )
        if (!page?.webSocketDebuggerUrl) return setStatus("no page in the agent browser")
        if (cancelled) return

        const ws = new WebSocket(page.webSocketDebuggerUrl)
        socket = ws
        ws.onopen = () => {
          setStatus("live")
          send("Page.enable")
          send("Runtime.enable")
          // Without an explicit viewport the headless shell defaults to a size
          // that does not match the pane, and object-contain letterboxes the
          // frame into a thin band. Pin it to the pane's aspect ratio.
          send("Emulation.setDeviceMetricsOverride", {
            width: 1000,
            height: 1400,
            deviceScaleFactor: 1,
            mobile: false,
          })
          send("Page.startScreencast", { format: "jpeg", quality: 70, maxWidth: 1000, maxHeight: 1400 })
        }
        ws.onmessage = (event) => {
          const msg = JSON.parse(event.data as string)
          if (msg.method === "Page.screencastFrame") {
            frameSize = { w: msg.params.metadata?.deviceWidth ?? 0, h: msg.params.metadata?.deviceHeight ?? 0 }
            setFrame(`data:image/jpeg;base64,${msg.params.data}`)
            // Required, or Chromium stops sending frames.
            send("Page.screencastFrameAck", { sessionId: msg.params.sessionId })
            return
          }
          if (msg.method === "Page.frameNavigated" && !msg.params.frame?.parentId) {
            followAgentUrl(msg.params.frame?.url ?? "")
          }
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
        socket?.close()
      } catch {
        // closing a socket that never opened is fine
      }
      socket = undefined
    })
  })

  /** Map a click on the letterboxed <img> to page coordinates. */
  const toPage = (e: MouseEvent) => {
    if (!img || !frameSize.w || !frameSize.h) return
    const r = img.getBoundingClientRect()
    const scale = Math.min(r.width / frameSize.w, r.height / frameSize.h)
    const offX = (r.width - frameSize.w * scale) / 2
    const offY = (r.height - frameSize.h * scale) / 2
    const x = (e.clientX - r.left - offX) / scale
    const y = (e.clientY - r.top - offY) / scale
    if (x < 0 || y < 0 || x > frameSize.w || y > frameSize.h) return
    return { x, y }
  }

  const mouse = (type: "mousePressed" | "mouseReleased", e: MouseEvent) => {
    const p = toPage(e)
    if (!p) return
    send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", clickCount: 1 })
  }

  return (
    <div
      class="flex-1 min-h-0 w-full flex items-center justify-center bg-v2-background-bg-deep overflow-hidden"
      tabIndex={0}
      onKeyDown={(e) => {
        if (!frame()) return
        e.preventDefault()
        if (e.key.length === 1) send("Input.insertText", { text: e.key })
        else send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: e.key, windowsVirtualKeyCode: e.keyCode })
      }}
      onWheel={(e) => {
        const p = toPage(e)
        if (!p) return
        send("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x: p.x,
          y: p.y,
          deltaX: -e.deltaX,
          deltaY: -e.deltaY,
        })
      }}
    >
      {frame() ? (
        <img
          ref={(el) => (img = el)}
          src={frame()}
          alt="Agent browser"
          draggable={false}
          class="max-h-full max-w-full object-contain cursor-pointer select-none"
          onMouseDown={(e) => mouse("mousePressed", e)}
          onMouseUp={(e) => mouse("mouseReleased", e)}
        />
      ) : (
        <p class="px-4 text-center text-12-regular text-v2-text-tertiary">
          {status() === "live" ? "waiting for a page…" : status()}
        </p>
      )}
    </div>
  )
}
