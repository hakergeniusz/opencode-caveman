/**
 * Dependency-free tests for the pure savings logic. `bun test`
 *
 * The pi original had a smoke test that drove a fake ExtensionAPI. That shape
 * does not exist in OpenCode V2, so instead the port extracts the pure helpers
 * into `src/logic.ts` and tests them directly — no pi or OpenCode runtime, no
 * network, no model. The event/hook wiring itself is covered by the README's
 * mapping notes rather than by a mock-heavy integration test.
 */
import { describe, expect, test } from "bun:test"
import {
  credit,
  defaultState,
  formatSavingsCard,
  normalizeState,
  parseCommand,
  pct,
  savingsData,
} from "../src/logic"

describe("parseCommand", () => {
  test("bare command and status mean status", () => {
    expect(parseCommand("")).toBe("status")
    expect(parseCommand("  ")).toBe("status")
    expect(parseCommand("status")).toBe("status")
    expect(parseCommand("/caveman")).toBe("status")
  })

  test("accepts every subcommand, case-insensitively", () => {
    expect(parseCommand("ON")).toBe("on")
    expect(parseCommand("off")).toBe("off")
    expect(parseCommand("saved")).toBe("saved")
    expect(parseCommand("reset")).toBe("reset")
    expect(parseCommand("/caveman saved")).toBe("saved")
  })

  test("stats is an alias for saved", () => {
    expect(parseCommand("stats")).toBe("saved")
  })

  test("unknown arguments are flagged", () => {
    expect(parseCommand("bogus")).toBe("unknown")
    expect(parseCommand(undefined)).toBe("status")
  })
})

describe("normalizeState", () => {
  test("falls back to defaults", () => {
    expect(normalizeState(undefined)).toEqual(defaultState())
  })

  test("option rate overrides persisted rate; invalid rates are ignored", () => {
    expect(normalizeState({ savingsRate: 0.5 }, 0.1).savingsRate).toBe(0.1)
    expect(normalizeState({ savingsRate: 0.5 }, 1.5).savingsRate).toBe(0.5)
    expect(normalizeState({ savingsRate: 2 }, -1).savingsRate).toBe(0.3)
  })

  test("repairs malformed stored numbers", () => {
    const state = normalizeState({
      enabled: true,
      lifetime: { turns: "x", savedCost: 0.42 },
      sessions: { s1: { replies: 3, outputTokens: null } },
    })
    expect(state.enabled).toBe(true)
    expect(state.lifetime.turns).toBe(0)
    expect(state.lifetime.savedCost).toBe(0.42)
    expect(state.sessions.s1.replies).toBe(3)
    expect(state.sessions.s1.outputTokens).toBe(0)
  })
})

describe("credit and savingsData", () => {
  test("credits lifetime and the current session at the configured rate", () => {
    const at = new Date("2026-01-01T00:00:00.000Z")
    const state = defaultState()
    state.savingsRate = 0.5
    credit(state, "session-1", 1000, 0.02)
    credit(state, "session-1", 500, 0.01)

    expect(state.lifetime.turns).toBe(2)
    expect(state.lifetime.outputTokens).toBe(1500)
    expect(state.lifetime.savedTokens).toBe(750)
    expect(state.lifetime.savedCost).toBeCloseTo(0.015)

    const data = savingsData(state, "session-1", at)
    expect(data.at).toBe(at.toISOString())
    expect(data.mode).toBe("off")
    expect(data.rate).toBe(0.5)
    expect(data.session.replies).toBe(2)
    expect(data.session.outputTokens).toBe(1500)
    expect(data.session.savedTokens).toBe(750)
    expect(data.session.savedCost).toBeCloseTo(0.015)
    expect(data.lifetime.savedTokens).toBe(750)
  })

  test("an unknown session produces an empty snapshot", () => {
    const data = savingsData(defaultState(), "missing")
    expect(data.session.replies).toBe(0)
    expect(data.session.savedTokens).toBe(0)
  })

  test("reset clears lifetime but keeps the mode", () => {
    const state = defaultState()
    state.enabled = true
    credit(state, "s", 100, 0.001)
    state.lifetime = { turns: 0, outputTokens: 0, savedTokens: 0, savedCost: 0 }
    expect(savingsData(state, "s").lifetime.savedTokens).toBe(0)
    expect(savingsData(state, "s").mode).toBe("on")
  })
})

describe("formatSavingsCard", () => {
  test("renders the session and lifetime blocks and the rate basis", () => {
    const state = defaultState()
    credit(state, "s", 1500, 0.01)
    const card = formatSavingsCard(savingsData(state, "s"))
    expect(card).toContain("Caveman savings (estimate)")
    expect(card).toContain(pct(0.3))
    expect(card).toContain("This session")
    expect(card).toContain("Lifetime")
    expect(card).toContain("1,500 tokens")
    expect(card).toContain("450 tokens")
  })
})
