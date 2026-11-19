/**
 * Pure helpers shared by the server part and the tests.
 *
 * No OpenCode or pi runtime imports here: everything in this module is plain
 * data in / data out, which keeps the savings estimate easy to reason about
 * and test.
 */

/** Output-token reduction credited to lite mode (the pi original's default). */
export const DEFAULT_SAVINGS_RATE = 0.3

export interface Lifetime {
  turns: number
  outputTokens: number
  savedTokens: number
  savedCost: number
}

/** Per-session tally of assistant replies produced while caveman was on. */
export interface SessionSnapshot {
  replies: number
  outputTokens: number
  outputCost: number
}

export interface CavemanState {
  enabled: boolean
  savingsRate: number
  lifetime: Lifetime
  sessions: Record<string, SessionSnapshot>
}

/** The payload emitted by `/caveman saved`. */
export interface SavingsData {
  at: string
  mode: "on" | "off"
  rate: number
  session: SessionSnapshot & { savedTokens: number; savedCost: number }
  lifetime: Lifetime
}

export function zeroLifetime(): Lifetime {
  return { turns: 0, outputTokens: 0, savedTokens: 0, savedCost: 0 }
}

export function zeroSession(): SessionSnapshot {
  return { replies: 0, outputTokens: 0, outputCost: 0 }
}

export function defaultState(): CavemanState {
  return {
    enabled: false,
    savingsRate: DEFAULT_SAVINGS_RATE,
    lifetime: zeroLifetime(),
    sessions: {},
  }
}

function validRate(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 0.95
    ? value
    : undefined
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function normalizeLifetime(value: unknown): Lifetime {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>
  return {
    turns: finiteNumber(raw.turns),
    outputTokens: finiteNumber(raw.outputTokens),
    savedTokens: finiteNumber(raw.savedTokens),
    savedCost: finiteNumber(raw.savedCost),
  }
}

function normalizeSession(value: unknown): SessionSnapshot {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>
  return {
    replies: finiteNumber(raw.replies),
    outputTokens: finiteNumber(raw.outputTokens),
    outputCost: finiteNumber(raw.outputCost),
  }
}

/**
 * Validate data read from durable storage. `optionRate` (a plugin option) wins
 * over the persisted rate, which wins over the built-in default.
 */
export function normalizeState(raw: unknown, optionRate?: unknown): CavemanState {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const rawSessions = (obj.sessions && typeof obj.sessions === "object" ? obj.sessions : {}) as Record<
    string,
    unknown
  >
  const sessions: Record<string, SessionSnapshot> = {}
  for (const [key, value] of Object.entries(rawSessions)) {
    sessions[key] = normalizeSession(value)
  }
  return {
    enabled: obj.enabled === true,
    savingsRate: validRate(optionRate) ?? validRate(obj.savingsRate) ?? DEFAULT_SAVINGS_RATE,
    lifetime: normalizeLifetime(obj.lifetime),
    sessions,
  }
}

export function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US")
}

export function money(n: number): string {
  return n >= 0.01 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`
}

export function pct(rate: number): string {
  return `${(rate * 100).toFixed(0)}%`
}

/**
 * Credit one assistant reply to the lifetime and per-session estimates.
 * Mutates `state` in place; callers persist it afterwards.
 */
export function credit(state: CavemanState, sessionID: string, outputTokens: number, outputCost: number): void {
  const rate = state.savingsRate
  state.lifetime.turns += 1
  state.lifetime.outputTokens += outputTokens
  state.lifetime.savedTokens += Math.round(outputTokens * rate)
  state.lifetime.savedCost += outputCost * rate

  const session = state.sessions[sessionID] ?? zeroSession()
  session.replies += 1
  session.outputTokens += outputTokens
  session.outputCost += outputCost
  state.sessions[sessionID] = session
}

/** Build the savings snapshot shown by `/caveman saved`. */
export function savingsData(state: CavemanState, sessionID: string, at: Date = new Date()): SavingsData {
  const session = state.sessions[sessionID] ?? zeroSession()
  const rate = state.savingsRate
  return {
    at: at.toISOString(),
    mode: state.enabled ? "on" : "off",
    rate,
    session: {
      ...session,
      savedTokens: Math.round(session.outputTokens * rate),
      savedCost: session.outputCost * rate,
    },
    lifetime: { ...state.lifetime },
  }
}

/** Plain-text rendering of the savings card (the pi original used a TUI Box). */
export function formatSavingsCard(data: SavingsData): string {
  const row = (label: string, value: string) => `  ${label.padEnd(20)}${value}`
  return [
    "🪨 Caveman savings (estimate)",
    `Basis: ${pct(data.rate)} of output tokens while caveman lite is active`,
    "",
    "This session",
    row("Replies while on:", String(data.session.replies)),
    row("Output while on:", `${fmt(data.session.outputTokens)} tokens`),
    row("Saved (est.):", `${fmt(data.session.savedTokens)} tokens ≈ ${money(data.session.savedCost)}`),
    "",
    "Lifetime",
    row("Turns while on:", String(data.lifetime.turns)),
    row("Output while on:", `${fmt(data.lifetime.outputTokens)} tokens`),
    row("Saved (est.):", `${fmt(data.lifetime.savedTokens)} tokens ≈ ${money(data.lifetime.savedCost)}`),
  ].join("\n")
}

/** Normalize the text after `/caveman`. Returns "unknown" for bad arguments. */
export function parseCommand(text: string | undefined): string {
  const raw = (text ?? "").trim().toLowerCase()
  const arg = raw.replace(/^\/?caveman\b/, "").trim()
  if (arg === "" || arg === "status") return "status"
  if (arg === "stats") return "saved"
  if (arg === "on" || arg === "off" || arg === "saved" || arg === "reset") return arg
  return "unknown"
}
