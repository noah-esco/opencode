import { createSignal } from "solid-js"

/**
 * Push-to-talk voice input.
 *
 * Records from the mic, posts the clip to a local Parakeet service, and hands
 * back text for the user to review before sending - deliberately NOT auto-send,
 * because a misheard prompt costs a full slow turn on a local model.
 *
 * The service is a separate loopback process (stt-server.py) rather than an
 * Electron IPC bridge: MLX models are thread-bound and slow to load, so the
 * model stays resident in its own single-threaded server. Audio never leaves
 * this machine.
 */
export const STT_ENDPOINT = "http://127.0.0.1:8385"

export type VoiceState = "idle" | "recording" | "transcribing" | "unavailable"

const [state, setState] = createSignal<VoiceState>("idle")
const [error, setError] = createSignal<string | undefined>()

export const voiceState = state
export const voiceError = error

let recorder: MediaRecorder | undefined
let chunks: Blob[] = []
let stream: MediaStream | undefined

export async function sttAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${STT_ENDPOINT}/health`, { signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch {
    return false
  }
}

export async function transcribe(blob: Blob): Promise<string> {
  const res = await fetch(`${STT_ENDPOINT}/transcribe`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: blob,
  })
  const data = (await res.json()) as { text?: string; error?: string }
  if (!res.ok || data.error) throw new Error(data.error ?? `stt failed (${res.status})`)
  return (data.text ?? "").trim()
}

export async function startRecording(): Promise<void> {
  if (state() === "recording") return
  setError(undefined)
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch {
    // Denied or no device - macOS shows its own mic prompt on first use.
    setError("Microphone unavailable")
    setState("unavailable")
    return
  }
  chunks = []
  recorder = new MediaRecorder(stream)
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  recorder.start()
  setState("recording")
}

/** Stops recording and resolves with the transcript ("" if nothing usable). */
export async function stopRecording(): Promise<string> {
  const rec = recorder
  if (!rec || state() !== "recording") return ""
  const done = new Promise<void>((resolve) => {
    rec.onstop = () => resolve()
  })
  rec.stop()
  await done
  stream?.getTracks().forEach((t) => t.stop())
  stream = undefined
  recorder = undefined

  setState("transcribing")
  try {
    const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" })
    chunks = []
    if (blob.size === 0) {
      setState("idle")
      return ""
    }
    const text = await transcribe(blob)
    setState("idle")
    return text
  } catch (e) {
    setError(e instanceof Error ? e.message : "Transcription failed")
    setState("idle")
    return ""
  }
}

export async function toggleRecording(): Promise<string> {
  if (state() === "recording") return stopRecording()
  await startRecording()
  return ""
}

/** Test seam. */
export function resetVoice() {
  recorder = undefined
  stream = undefined
  chunks = []
  setState("idle")
  setError(undefined)
}
