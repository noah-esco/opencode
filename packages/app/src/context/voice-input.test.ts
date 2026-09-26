import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { transcribe, sttAvailable, voiceState, resetVoice, STT_ENDPOINT } from "./voice-input"

const realFetch = globalThis.fetch
beforeEach(() => resetVoice())
afterEach(() => {
  globalThis.fetch = realFetch
})

const mock = (impl: (url: string, init?: RequestInit) => Response | Promise<Response>) => {
  // @ts-expect-error narrow test double
  globalThis.fetch = (url: string, init?: RequestInit) => Promise.resolve(impl(String(url), init))
}

describe("voice input", () => {
  test("starts idle", () => {
    expect(voiceState()).toBe("idle")
  })

  test("health check reports availability", async () => {
    mock(() => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    expect(await sttAvailable()).toBe(true)
  })

  test("health check failure is not fatal", async () => {
    mock(() => {
      throw new Error("connection refused")
    })
    expect(await sttAvailable()).toBe(false)
  })

  test("transcribe posts to the local endpoint and returns text", async () => {
    let seen: string | undefined
    mock((url) => {
      seen = url
      return new Response(JSON.stringify({ text: "  hello world  " }), { status: 200 })
    })
    expect(await transcribe(new Blob(["x"]))).toBe("hello world")
    expect(seen).toBe(`${STT_ENDPOINT}/transcribe`)
  })

  test("server-reported errors surface as exceptions", async () => {
    mock(() => new Response(JSON.stringify({ error: "could not decode audio" }), { status: 400 }))
    await expect(transcribe(new Blob(["x"]))).rejects.toThrow("could not decode audio")
  })

  test("non-ok without an error body still throws", async () => {
    mock(() => new Response(JSON.stringify({}), { status: 500 }))
    await expect(transcribe(new Blob(["x"]))).rejects.toThrow("stt failed (500)")
  })

  test("missing text field yields empty string, not undefined", async () => {
    mock(() => new Response(JSON.stringify({}), { status: 200 }))
    expect(await transcribe(new Blob(["x"]))).toBe("")
  })

  test("endpoint is loopback only", () => {
    expect(STT_ENDPOINT.startsWith("http://127.0.0.1")).toBe(true)
  })
})
