/**
 * Code vs Chat mode.
 *
 * Why a local map instead of a field on Session: neither the v1 nor v2 Session
 * schema carries the agent that produced it (only individual MESSAGES do), and
 * the sidebar's store holds sessions without messages. Deriving a session's mode
 * would therefore cost one message fetch per sidebar row. Adding `agent` to the
 * Session schema would mean editing core + storage + the GENERATED SDK types,
 * which regenerate upstream and would make every rebase conflict.
 *
 * So: the app records the mode when it creates a session, keyed by session id.
 * Sessions we have never seen (e.g. created from the CLI) fall back to "code".
 */
import { createSignal } from "solid-js"

export type SessionMode = "code" | "chat"

export const SESSION_MODES: SessionMode[] = ["code", "chat"]

/** Agent name each mode dispatches to. "chat" is registered in agent.ts. */
export const AGENT_FOR_MODE: Record<SessionMode, string> = {
  code: "build",
  chat: "chat",
}

const STORAGE_KEY = "opencode.session-mode.v1"
const ACTIVE_KEY = "opencode.session-mode.active.v1"

type ModeMap = Record<string, SessionMode>

function read(): ModeMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return {}
    return parsed as ModeMap
  } catch {
    // Private windows / cleared site data / quota errors must not break the sidebar.
    return {}
  }
}

function write(map: ModeMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // Non-fatal: mode reverts to the "code" default next load.
  }
}

export function sessionMode(sessionID: string): SessionMode {
  return read()[sessionID] ?? "code"
}

export function setSessionMode(sessionID: string, mode: SessionMode) {
  const map = read()
  map[sessionID] = mode
  write(map)
}

export function forgetSessionMode(sessionID: string) {
  const map = read()
  if (!(sessionID in map)) return
  delete map[sessionID]
  write(map)
}

function readActive(): SessionMode {
  try {
    return localStorage.getItem(ACTIVE_KEY) === "chat" ? "chat" : "code"
  } catch {
    return "code"
  }
}

/**
 * Which mode the sidebar is filtered to. A signal, not a plain read, so that
 * every session list re-renders when the user flips the switch.
 */
const [activeModeSignal, setActiveModeSignal] = createSignal<SessionMode>(readActive())

export const activeMode = activeModeSignal

export function setActiveMode(mode: SessionMode) {
  setActiveModeSignal(mode)
  try {
    localStorage.setItem(ACTIVE_KEY, mode)
  } catch {
    // Non-fatal: falls back to "code" on next launch.
  }
}

export function filterSessionsByMode<T extends { id: string }>(sessions: T[], mode: SessionMode): T[] {
  const map = read()
  return sessions.filter((s) => (map[s.id] ?? "code") === mode)
}

/**
 * Agent the next new draft should use.
 *
 * The sidebar lives in layout-new.tsx, OUTSIDE LocalProvider, so it cannot call
 * useLocal().agent.set() itself. It records the intent here and the new-session
 * view - which IS inside the provider - applies and clears it.
 */
const [pending, setPending] = createSignal<string | undefined>()
export const pendingAgent = pending
export function requestAgent(name: string) {
  setPending(name)
}
export function takePendingAgent() {
  const value = pending()
  if (value !== undefined) setPending(undefined)
  return value
}
