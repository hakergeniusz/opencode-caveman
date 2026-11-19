/**
 * opencode-caveman — server part.
 *
 * Native OpenCode V2 rewrite of the pi extension `pi-caveman`. It applies the
 * "lite" level of caveman (https://github.com/JuliusBrussee/caveman, Apache-2.0):
 * the model answers in tight, professional prose — no filler, no hedging, no
 * tool-call narration — while code, commands, file paths, and error strings
 * stay exact.
 *
 * Mapping from the pi original:
 *   - `before_agent_start` prompt append -> `ctx.session.hook("context", ...)`
 *   - `agent_end` usage accounting -> `ctx.event.subscribe("session.step.ended")`
 *   - `~/.pi/agent/caveman.json` -> `ctx.storage` (durable plugin JSON)
 *   - `pi.registerCommand` -> `ctx.command.transform(... editor.add(...))`
 *   - `ctx.ui.notify` / status bar / entry renderer -> RPC events consumed by
 *     the TUI part (`src/tui.tsx`): toasts, a footer status widget and a card.
 *
 * Savings are an estimate: lite mode shortens what the model writes, so the
 * plugin credits a configurable fraction (default 30%) of the output tokens
 * and cost produced while the mode was active.
 */
import { Plugin } from "@opencode/plugin"
import { Caveman } from "./rpc"
import {
  CavemanState,
  credit,
  formatSavingsCard,
  normalizeState,
  parseCommand,
  savingsData,
  zeroLifetime,
  zeroSession,
} from "./logic"

const STATE_KEY = "caveman/state"

/**
 * Caveman lite rules, adapted from the project's SKILL.md (Apache-2.0):
 * "No filler/hedging. Keep articles + full sentences. Professional but tight."
 */
const LITE_PROMPT = `

## Caveman lite mode (ACTIVE until the user turns it off)

Answer in tight, professional prose for every response this session. Drop filler, hedging, pleasantries ("sure", "of course", "happy to"), and tool-call narration. Keep articles and complete sentences. Terse means less filler, not less grammar: connect related statements into flowing sentences and group them into short paragraphs — a wall of isolated one-clause sentences is a style failure. When giving instructions, use the imperative ("Run X", not "X should be run"). Use the same term for the same thing every time.

Compression must never grow the output: if a shorter phrasing would not actually be shorter, write it plainly, and never invent abbreviations. Code blocks, commands, file paths, API names, technical terms, and error strings stay exact and unchanged. Never drop or alter negations (not, never, no, only); numbers and units stay exact. Security warnings and irreversible-action confirmations revert to full normal prose, then resume the terse style afterward.

Start every reply with the answer itself, never with a note about the style. Never describe, acknowledge, or justify this mode — no "Adopting a concise style…", no formatting or token-savings remarks, no italic meta lines. No preamble before tool calls, no announcing next steps, no decorative tables or emoji, no restating the question — just answer in the style.
`

export default Plugin.define({
  id: "opencode-caveman",
  async setup(ctx) {
    const optionRate = (ctx.options as { savingsRate?: unknown } | undefined)?.savingsRate

    let stored: unknown
    try {
      stored = await ctx.storage.get(STATE_KEY)
    } catch {
      stored = undefined
    }
    const state: CavemanState = normalizeState(stored, optionRate)

    async function persist(): Promise<void> {
      try {
        await ctx.storage.set(STATE_KEY, state)
      } catch {
        // Stats persistence is best effort; the session must never break over it.
      }
    }

    // Sessions whose most recent model request was dispatched with caveman on.
    // Pairing a `context` hook with `session.step.ended` keeps accounting tied
    // to the styled replies only (title/compaction/generate requests are never
    // armed, so they cannot pollute the estimate).
    const armed = new Set<string>()
    const controller = new AbortController()

    const rpc = await ctx.rpc.register(Caveman, {
      status: async () => ({ enabled: state.enabled, savingsRate: state.savingsRate }),
    })

    const command = await ctx.command.transform((editor) => {
      editor.add({
        name: "caveman",
        description: "Toggle caveman lite mode and show estimated token savings",
        execute: async ({ sessionID, prompt }) => {
          const arg = parseCommand(prompt.text)
          switch (arg) {
            case "on": {
              state.enabled = true
              // "This session" numbers start at the most recent ON marker.
              state.sessions[sessionID] = zeroSession()
              await persist()
              await rpc.events.emit("changed", {
                enabled: true,
                message: "🪨 Caveman lite ON. Tight prose, full accuracy. /caveman off | saved",
                variant: "success",
              })
              break
            }
            case "off": {
              state.enabled = false
              await persist()
              await rpc.events.emit("changed", {
                enabled: false,
                message: "Caveman lite off. Full prose restored.",
                variant: "info",
              })
              break
            }
            case "saved": {
              const data = savingsData(state, sessionID)
              await rpc.events.emit("saved", { text: formatSavingsCard(data) })
              break
            }
            case "reset": {
              state.lifetime = zeroLifetime()
              await persist()
              await rpc.events.emit("changed", {
                enabled: state.enabled,
                message: "Lifetime caveman savings reset.",
                variant: "info",
              })
              break
            }
            case "status": {
              await rpc.events.emit("changed", {
                enabled: state.enabled,
                message: state.enabled
                  ? "🪨 Caveman lite: ON — answers tight. /caveman off, saved."
                  : "Caveman lite: off. /caveman on",
                variant: "info",
              })
              break
            }
            default: {
              await rpc.events.emit("changed", {
                enabled: state.enabled,
                message: "Usage: /caveman on | off | saved | status | reset",
                variant: "warning",
              })
            }
          }
        },
      })
    })

    // Deterministic string: the provider's cached prompt prefix survives from
    // turn to turn while the mode stays on; only the on/off transition re-bills.
    const hook = await ctx.session.hook("context", (event) => {
      if (!state.enabled) {
        armed.delete(event.sessionID)
        return
      }
      armed.add(event.sessionID)
      event.system.push({ type: "text", text: LITE_PROMPT })
    })

    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({
          types: ["session.step.ended", "session.step.failed"],
          signal: controller.signal,
        })) {
          const sessionID = (event.data as { sessionID?: string }).sessionID
          if (!sessionID) continue

          if (event.type === "session.step.failed") {
            armed.delete(sessionID)
            continue
          }

          // Only replies that were actually dispatched with the lite prompt.
          if (!armed.delete(sessionID)) continue

          const tokens = (event.data.tokens ?? {}) as { output?: number }
          const outputTokens = Number(tokens.output) || 0
          const outputCost = Number(event.data.cost) || 0
          if (outputTokens <= 0 && outputCost <= 0) continue

          credit(state, sessionID, outputTokens, outputCost)
          await persist()
        }
      } catch {
        // Subscription aborted during cleanup, or the event stream ended.
      }
    })()

    return async () => {
      controller.abort()
      await command.dispose()
      await hook.dispose()
      await rpc.dispose()
    }
  },
})
