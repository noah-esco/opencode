import { createSignal } from "solid-js"

/**
 * Live TTFT and generation rate for the debug bar.
 *
 * Why measured here rather than read from the server: AssistantMessage carries
 * time.created / time.completed and token counts, but NO first-token timestamp.
 * On a local model TTFT is dominated by prefill (the build agent's system prompt
 * measured 24,377 tokens ~= 105s at 233 tok/s), so an end-to-end rate hides the
 * thing you actually want to see. We time the first streamed delta instead.
 *
 * tok/s here is DECODE rate: output tokens divided by the time from first token
 * to completion, deliberately excluding prefill so it is comparable to
 * `ollama run --verbose` eval rate.
 */
const [ttft, setTtft] = createSignal<number | undefined>()
const [rate, setRate] = createSignal<number | undefined>()
const [streaming, setStreaming] = createSignal(false)

type Turn = { start: number; first?: number }
const turns = new Map<string, Turn>()

/** An assistant message was created - the clock starts. */
export function markTurnStart(messageID: string, created?: number) {
  if (turns.has(messageID)) return
  turns.set(messageID, { start: created ?? Date.now() })
  setStreaming(true)
  setTtft(undefined)
  setRate(undefined)
}

/** First streamed delta for this message: that is TTFT. */
export function markFirstToken(messageID: string) {
  const turn = turns.get(messageID)
  if (!turn || turn.first !== undefined) return
  turn.first = Date.now()
  setTtft(turn.first - turn.start)
}

/** Message finished: derive decode rate from output tokens since first token. */
export function markTurnEnd(messageID: string, outputTokens?: number, completed?: number) {
  const turn = turns.get(messageID)
  if (!turn) return
  const end = completed ?? Date.now()
  if (turn.first !== undefined && outputTokens && end > turn.first) {
    setRate((outputTokens * 1000) / (end - turn.first))
  }
  turns.delete(messageID)
  if (turns.size === 0) setStreaming(false)
}

export const llmTtft = ttft
export const llmRate = rate
export const llmStreaming = streaming

/** Test seam. */
export function resetLlmMetrics() {
  turns.clear()
  setTtft(undefined)
  setRate(undefined)
  setStreaming(false)
}
