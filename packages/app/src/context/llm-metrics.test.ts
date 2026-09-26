import { describe, expect, test, beforeEach } from "bun:test"
import { markTurnStart, markFirstToken, markTurnEnd, llmTtft, llmRate, llmStreaming, resetLlmMetrics } from "./llm-metrics"

beforeEach(() => resetLlmMetrics())

describe("llm metrics", () => {
  test("starts empty", () => {
    expect(llmTtft()).toBeUndefined()
    expect(llmRate()).toBeUndefined()
    expect(llmStreaming()).toBe(false)
  })

  test("marks streaming on turn start", () => {
    markTurnStart("m1", Date.now())
    expect(llmStreaming()).toBe(true)
  })

  test("ttft is measured from turn start to first delta", () => {
    markTurnStart("m1", Date.now() - 500)
    markFirstToken("m1")
    expect(llmTtft()).toBeGreaterThanOrEqual(450)
  })

  test("only the FIRST delta sets ttft", () => {
    markTurnStart("m1", Date.now() - 300)
    markFirstToken("m1")
    const first = llmTtft()
    markFirstToken("m1")
    expect(llmTtft()).toBe(first)
  })

  test("rate excludes prefill: counted from first token, not turn start", () => {
    const now = Date.now()
    markTurnStart("m1", now - 10_000) // 10s of prefill
    markFirstToken("m1")
    // 20 tokens over ~1s of decode => ~20/s, NOT 20/11s
    markTurnEnd("m1", 20, Date.now() + 1000)
    const r = llmRate()!
    expect(r).toBeGreaterThan(15)
    expect(r).toBeLessThan(25)
  })

  test("clears streaming once every turn ends", () => {
    markTurnStart("a", Date.now())
    markTurnStart("b", Date.now())
    markFirstToken("a")
    markTurnEnd("a", 5, Date.now() + 100)
    expect(llmStreaming()).toBe(true)
    markFirstToken("b")
    markTurnEnd("b", 5, Date.now() + 100)
    expect(llmStreaming()).toBe(false)
  })

  test("a turn that never streamed yields no rate", () => {
    markTurnStart("m1", Date.now())
    markTurnEnd("m1", 20, Date.now() + 1000)
    expect(llmRate()).toBeUndefined()
  })

  test("unknown message ids are ignored", () => {
    expect(() => markFirstToken("nope")).not.toThrow()
    expect(() => markTurnEnd("nope", 1, Date.now())).not.toThrow()
  })
})
