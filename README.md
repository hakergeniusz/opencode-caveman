# opencode-caveman

A native **OpenCode V2** plugin: caveman *lite* mode. When it is on, the model
answers in tight, professional prose — no filler, no hedging, no tool-call
narration — while code, commands, file paths, and error strings stay exact.
`/caveman saved` reports the estimated output-token savings.

The style rules come from [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman)'s
**lite** level (Apache-2.0): *"No filler/hedging. Keep articles + full sentences.
Professional but tight."* Lite never breaks grammar — it reads like a senior
engineer writing under deadline, not like a caveman.

## Origin: mapping from the pi extension

This is a rewrite of `pi-caveman`. The behavior is preserved; the host APIs are
not. Concretely:

| pi original | OpenCode V2 |
|---|---|
| `pi.on("before_agent_start")` prompt append | `ctx.session.hook("context", …)` pushes the same `LITE_PROMPT` onto `event.system` |
| `pi.on("agent_end")` usage accounting | `ctx.event.subscribe(["session.step.ended", …])`, armed by the `context` hook so only styled replies are counted |
| `~/.pi/agent/caveman.json` state file | `ctx.storage` key `caveman/state` (durable plugin JSON) |
| `pi.registerCommand("caveman", …)` | `ctx.command.transform(editor => editor.add({ name: "caveman", … }))` |
| `ctx.ui.setStatus` / `notify` / entry renderer | Server emits RPC events; `src/tui.tsx` shows a footer status widget, toasts and a savings dialog |
| `pi.appendEntry` custom transcript entries | No equivalent — the card is TUI-only (see gaps) |

The prompt text is deterministic, so the provider's cached prompt prefix keeps
serving for free while the mode stays on; only the on/off transition re-bills.

## Commands

| Command | What it does |
|---|---|
| `/caveman on` | Turn caveman lite on (footer shows 🪨); "this session" totals restart here |
| `/caveman off` | Turn it off, full prose restored |
| `/caveman saved` | Estimated token savings — this session and lifetime — shown as a card (`stats` is an alias) |
| `/caveman status` | Show current mode (bare `/caveman` works too) |
| `/caveman reset` | Zero the lifetime savings counters |

The mode is persisted and re-applied on the next load. Command results are
shown as toasts; `/caveman saved` opens a dialog with the card.

## How the savings estimate works

```
saved ≈ Σ output_tokens(assistant replies while on) × savingsRate
```

The default rate is **30%**. Caveman's own measurements span roughly 8.5%
(JetBrains study, skill only) to 50% (repo eval), so treat the number as an
estimate, not a meter reading — the card says so on it. Only output tokens and
their cost are credited; prompt-cache reads and tool steps are not.

## Load

Add the package to `opencode.json(c)` (it has both a server and a TUI part):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-caveman"]
}
```

Local checkout:

```jsonc
{
  "plugins": ["/home/hakergeniusz/Projects/opencode-caveman"]
}
```

## Options

Configured through the `plugins` object form. `savingsRate` must be between 0
and 0.95:

```jsonc
{
  "plugins": [
    {
      "package": "opencode-caveman",
      "options": { "savingsRate": 0.4 }
    }
  ]
}
```

The option wins over the value stored in plugin storage. With no option, the
stored rate is used; with neither, the default 0.3 applies.

To change the persisted rate directly, set `savingsRate` in the plugin-storage
value under the key `caveman/state`.

## OpenCode APIs used

- Server (`src/index.ts`, `@opencode/plugin`): `ctx.storage`,
  `ctx.command.transform`, `ctx.session.hook("context")`,
  `ctx.event.subscribe`, `ctx.rpc.register`.
- TUI (`src/tui.tsx`, `@opencode/plugin/tui`): `context.client.rpc`,
  `context.ui.slot`, `context.ui.toast.show`, `context.ui.dialog.alert`,
  `context.theme`.
- Contract (`src/rpc.ts`, `@opencode/plugin/rpc`): `Rpc.define`.

## Known gaps / differences from the pi original

1. **No persistent transcript card.** pi's `appendEntry` + entry renderer made
   `/caveman saved` a custom block that never reached the model. OpenCode V2 has
   no custom-entry API, so the card is rendered in a TUI dialog only; it is not
   stored in the transcript and is not replayable later.
2. **Storage location changed.** State lives in OpenCode plugin storage, not
   `~/.pi/agent/caveman.json`; the `PI_CAVEMAN_STATE` path override no longer
   applies. Use the `savingsRate` plugin option instead.
3. **Session accounting is per sessionID, not per branch.** pi reconstructed
   session numbers from toggle markers on the session branch, so they survived
   forks and branch switches. Here they are tallied in plugin storage keyed by
   sessionID; a fork starts fresh and history rewrites are not re-attributed.
4. **"Turns" means model steps.** pi counted one turn per agent run; OpenCode
   reports per-step token usage, so a run with multiple tool-driven steps counts
   as multiple entries. The total output tokens (and therefore saved tokens) are
   still summed correctly.
5. **Cost basis is approximate.** OpenCode's `session.step.ended` reports one
   total cost per step rather than an output-only split, so `savedCost` uses that
   total. The token-based estimate is unaffected.
6. **Command feedback is live-only.** RPC events are not replayed: if the TUI is
   disconnected when a command runs, its toast/card is missed. The status widget
   seeds itself from the `status()` RPC method on load, so it stays correct.
7. **Headless use.** Without the TUI part (for example against a remote server
   with no terminal client), commands still change state and inject the prompt,
   but there is no visible notification.

## Tests

The pi original had a smoke test driven by a fake `ExtensionAPI`. That host type
does not exist here, so only the pure logic (`src/logic.ts`) was ported, as
`test/logic.test.ts` (`bun test`). No mock-heavy integration test was added.

## Credits

- [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) — original
  project; the lite rules are adapted from its `SKILL.md` (Apache-2.0).
- [v2nic/pi-caveman](https://github.com/v2nic/pi-caveman) — earlier `/caveman`
  toggle for pi (MIT).
- [pi-caveman](https://github.com/hakergeniusz/pi-caveman) — the extension this
  plugin rewrites.

## License

MIT — 2026 hakergeniusz.
