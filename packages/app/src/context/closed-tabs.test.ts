import { describe, expect, test } from "bun:test"
import { nextTabAfterClose } from "./closed-tabs"

describe("nextTabAfterClose mode awareness", () => {
  const code = (id: string) => ({ type: "session" as const, server: "s" as never, sessionId: id })
  const draft = (id: string) => ({ type: "draft" as const, draftID: id, server: "s" as never, directory: "/d" })
  const chatIds = new Set(["chat1", "chat2"])
  const eligible = (tab: any) => (tab.type === "draft" ? true : chatIds.has(tab.sessionId))

  test("skips a tab from the other mode and keeps looking", () => {
    const tabs = [code("chat1"), code("code1"), code("chat2")] as any[]
    expect(nextTabAfterClose(tabs, 0, true, eligible)).toEqual(tabs[2])
  })

  test("returns null when the mode has nothing left, so the caller goes blank", () => {
    const tabs = [code("chat1"), code("code1"), code("code2")] as any[]
    expect(nextTabAfterClose(tabs, 0, true, eligible)).toBeNull()
  })

  test("a draft counts for either mode", () => {
    const tabs = [code("chat1"), draft("d1")] as any[]
    expect(nextTabAfterClose(tabs, 0, true, eligible)).toEqual(tabs[1])
  })

  test("falls back to an earlier eligible tab when none follow", () => {
    const tabs = [code("chat2"), code("chat1"), code("code1")] as any[]
    expect(nextTabAfterClose(tabs, 1, true, eligible)).toEqual(tabs[0])
  })

  test("without a predicate it keeps the old adjacent behaviour", () => {
    const tabs = [code("a"), code("b"), code("c")] as any[]
    expect(nextTabAfterClose(tabs, 0, true)).toEqual(tabs[1])
  })

  test("inactive tab close does not navigate at all", () => {
    const tabs = [code("chat1"), code("chat2")] as any[]
    expect(nextTabAfterClose(tabs, 0, false, eligible)).toBeUndefined()
  })
})
