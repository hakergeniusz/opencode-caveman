/**
 * Typed RPC contract shared by the server part (`index.ts`) and the TUI part
 * (`tui.tsx`).
 *
 * - `status` lets the TUI seed its status widget and toast state on load.
 * - `changed` is emitted by the server-side `/caveman` command so the TUI can
 *   update the widget and show the result as a toast.
 * - `saved` carries the rendered savings card for the TUI to display.
 */
import { Rpc } from "@opencode/plugin/rpc"

export const Caveman = Rpc.define({
  id: "opencode-caveman",
  methods: {
    status: {
      output: {
        type: "object",
        properties: {
          enabled: { type: "boolean" },
          savingsRate: { type: "number" },
        },
        required: ["enabled", "savingsRate"],
        additionalProperties: false,
      },
    },
  },
  events: {
    changed: {
      schema: {
        type: "object",
        properties: {
          enabled: { type: "boolean" },
          message: { type: "string" },
          variant: { type: "string", enum: ["info", "success", "warning", "error"] },
        },
        required: ["enabled", "message", "variant"],
        additionalProperties: false,
      },
    },
    saved: {
      schema: {
        type: "object",
        properties: {
          text: { type: "string" },
        },
        required: ["text"],
        additionalProperties: false,
      },
    },
  },
})
