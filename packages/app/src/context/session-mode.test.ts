import { describe, expect, test, beforeEach, afterAll } from "bun:test"
import {
  sessionMode,
  setSessionMode,
  forgetSessionMode,
  filterSessionsByMode,
  activeMode,
  setActiveMode,
  AGENT_FOR_MODE,
} from "./session-mode"

// Bun provides a real (readonly) localStorage global; use it rather than stubbing.
beforeEach(() => localStorage.clear())
// Do not leak an active mode into other test files sharing this localStorage.
afterAll(() => {
  setActiveMode("code")
  localStorage.clear()
})

describe("session mode", () => {
  test("unknown sessions default to code", () => {
    expect(sessionMode("never-seen")).toBe("code")
  })

  test("records and reads back a mode", () => {
    setSessionMode("s1", "chat")
    expect(sessionMode("s1")).toBe("chat")
  })

  test("filters a mixed list by mode", () => {
    setSessionMode("a", "chat")
    setSessionMode("b", "code")
    const list = [{ id: "a" }, { id: "b" }, { id: "c" }]
    expect(filterSessionsByMode(list, "chat").map((s) => s.id)).toEqual(["a"])
    // "c" was never recorded, so it falls back to code
    expect(filterSessionsByMode(list, "code").map((s) => s.id)).toEqual(["b", "c"])
  })

  test("forgetting reverts to the default", () => {
    setSessionMode("s2", "chat")
    forgetSessionMode("s2")
    expect(sessionMode("s2")).toBe("code")
  })

  test("active mode persists and defaults to code", () => {
    expect(activeMode()).toBe("code")
    setActiveMode("chat")
    expect(activeMode()).toBe("chat")
  })

  test("each mode maps to a registered agent", () => {
    expect(AGENT_FOR_MODE.code).toBe("build")
    expect(AGENT_FOR_MODE.chat).toBe("chat")
  })

  test("survives localStorage throwing", () => {
    const getItem = localStorage.getItem.bind(localStorage)
    const setItem = localStorage.setItem.bind(localStorage)
    localStorage.getItem = () => {
      throw new Error("denied")
    }
    localStorage.setItem = () => {
      throw new Error("denied")
    }
    expect(() => sessionMode("x")).not.toThrow()
    expect(sessionMode("x")).toBe("code")
    expect(() => setSessionMode("x", "chat")).not.toThrow()
    expect(() => activeMode()).not.toThrow()
    localStorage.getItem = getItem
    localStorage.setItem = setItem
  })
})
