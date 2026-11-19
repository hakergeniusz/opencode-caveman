/**
 * opencode-caveman — TUI part.
 *
 * The pi original used `ctx.ui.setStatus` for a status-bar widget,
 * `ctx.ui.notify` for command feedback and a custom transcript entry renderer
 * for the savings card. OpenCode keeps those concerns in the terminal client,
 * so this part consumes the server's RPC events (`src/rpc.ts`) to provide:
 *   - a "🪨 caveman lite" status contribution in the footer,
 *   - a toast for every command result,
 *   - the savings card in a dialog.
 */
import { Plugin } from "@opencode/plugin/tui"
import { Caveman } from "./rpc"
import { Show, createSignal } from "solid-js"

export default Plugin.define({
  id: "opencode-caveman.cli",

  setup(context) {
    const [enabled, setEnabled] = createSignal(false)

    // Read `context.client` at call time: it is replaced after a server restart.
    function api() {
      return context.client.rpc(Caveman)
    }

    let stopChanged: (() => void) | undefined
    let stopSaved: (() => void) | undefined

    try {
      const caveman = api()

      void (async () => {
        try {
          const result = await caveman.status()
          setEnabled(result.enabled === true)
        } catch {
          // Server not ready yet; the "changed" event will keep us in sync.
        }
      })()

      stopChanged = caveman.events.on("changed", (event) => {
        setEnabled(event.data.enabled === true)
        context.ui.toast.show({
          title: "🪨 Caveman lite",
          message: event.data.message,
          variant: event.data.variant,
        })
      })

      stopSaved = caveman.events.on("saved", (event) => {
        void context.ui.dialog.alert({
          title: "Caveman savings (estimate)",
          message: event.data.text,
        })
      })
    } catch {
      // No reachable server at setup; command events are live-only, so nothing
      // to catch up on. The status widget simply stays hidden until reloaded.
    }

    context.ui.slot({
      append: "home.footer.status",
      render: () => (
        <Show when={enabled()}>
          <text fg={context.theme.text.base}>🪨 caveman lite</text>
        </Show>
      ),
    })

    return () => {
      stopChanged?.()
      stopSaved?.()
    }
  },
})
