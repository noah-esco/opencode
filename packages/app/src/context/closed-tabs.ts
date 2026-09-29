import type { SessionTab, Tab } from "./tabs"

export type ClosedTab = {
  tab: SessionTab
  index: number
}

const CLOSED_TAB_LIMIT = 25

// Only session tabs are recorded; closing a draft tab deletes its persisted
// state, so a reopened draft would come back empty anyway.
export function pushClosedTab(stack: ClosedTab[], tab: Tab, index: number): ClosedTab[] {
  if (tab.type !== "session") return stack
  return [...stack, { tab: { ...tab }, index }].slice(-CLOSED_TAB_LIMIT)
}

// Pops the most recently closed tab that is not open again,
// discarding stale entries along the way.
export function takeClosedTab(stack: ClosedTab[], tabs: Tab[]): { entry?: ClosedTab; stack: ClosedTab[] } {
  const remaining = [...stack]
  while (remaining.length) {
    const entry = remaining.pop()
    if (entry && !isOpen(tabs, entry.tab)) return { entry, stack: remaining }
  }
  return { stack: remaining }
}

export function removeClosedTabs(stack: ClosedTab[], server: SessionTab["server"], sessionIDs: string[]) {
  const removed = new Set(sessionIDs)
  return stack.filter((entry) => entry.tab.server !== server || !removed.has(entry.tab.sessionId))
}

export function nextTabAfterClose(
  tabs: Tab[],
  index: number,
  active: boolean,
  eligible?: (tab: Tab) => boolean,
) {
  if (!active) return undefined
  // Without an eligibility test this picks the adjacent tab regardless of which
  // mode it belongs to, so closing the last Chat tab could land on a Code
  // session. Returning null sends the caller to a blank session instead.
  const ok = (tab: Tab | undefined) => (tab && (!eligible || eligible(tab)) ? tab : undefined)
  const after = tabs.slice(index + 1).find((tab) => ok(tab))
  const before = [...tabs.slice(0, index)].reverse().find((tab) => ok(tab))
  return after ?? before ?? null
}

function isOpen(tabs: Tab[], tab: SessionTab) {
  return tabs.some((item) => item.type === "session" && item.server === tab.server && item.sessionId === tab.sessionId)
}
