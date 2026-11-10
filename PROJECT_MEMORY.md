# Project Memory — pi-zentui-custom

_Last updated: 2026-11-10_

## What this is

Zentui is a Pi extension package (npm: `pi-zentui`) with independently configurable terminal UI components: footer, editor frame, user-message styling, selector borders, working line, Bash tool display. Shows session/project state at a glance: cwd, git branch/status, runtime, context usage, tokens, cost, model/provider.

## Architecture

- Entry: `package.json` → `extensions/zentui/index.ts` (orchestration-only; Pi event wiring)
- `footer.ts` — footer/statusline rendering (Starship-style)
- `config.ts` — config path (`~/.pi/agent/zentui.json`), defaults, merging
- `component-colors.ts` — per-owner color resolution: local `components.<owner>.colors.<key>` → shared legacy `colors.<key>` fallback; `editorSharedDefaults` keeps editor roles styled when shared values are empty
- `style.ts` — Starship-style string rendering (`bold purple`, `fg:202`, `bg:blue`); empty spec → unstyled (system theme default)
- `format.ts`, `state.ts`, `git.ts`, `runtime.ts` — formatting, footer state, git porcelain parsing, runtime detection
- `ui.ts` — custom editor frame; `user-message.ts` — prompt-box user messages (fragile: patches `UserMessageComponent`)
- `settings-command.ts` — `/zentui` settings UI

## Key product decisions

- Components are independently selectable — enabling one never restyles another
- Disabled/native leaves a surface alone; fail open to native
- Unkeyed Working line = controlled exclusivity with best-effort release
- All Working line segments (incl. telemetry) participate in Classic/KITT animation; per-segment color overrides only in Static mode

## Recent decisions

- **2026-11-10: Footer follows the system color theme.** `components.footer.colorSource` now defaults to `"theme"` (was `"terminal"`), so every footer segment resolves through the active Pi theme's semantic tokens via `themeColorNameMap` instead of emitting fixed ANSI literals. The shared `colors` values stay as color _names_ (`bold purple`, `bold green`, …) because the name is what gets mapped — blanking them defeats the mechanism and yields a uniformly unstyled footer. `packageVersion` changed from the raw 256-index `"208"` to `"bold yellow"`, since numeric indices have no theme token and `safeThemeFg` silently falls back to unstyled. `defaultConfig.colorSources.starship` (legacy mirror) kept in sync.
- Superseded an earlier attempt that blanked all 20 `colors` values, the hardcoded check `"green"`, and all 57 runtime `style` fields; that produced a colorless footer and was fully reverted.

## Gotchas

- Nerd Font icons are private-use Unicode (e.g. up-to-date check U+EC14, bytes `ee b0 94`) — invisible in text views; inspect with `od -An -tx1` and edit via byte-exact scripts, never text-match across PUA lines
- Shipped sources must use explicit `.ts` import specifiers (jiti); `test/import-specifiers.test.ts` guards this
- 9 pre-existing test failures on `main` (baseline): 5 in `test/editor-viewport-indicators.test.ts`, 4 in `test/extension-compliance.test.ts` (accent-rail compose)
- `componentColor()` returns `undefined` for absent keys and `renderStyle` throws on `undefined` — blank defaults must be `""`, never key removal
- `defaultConfig` is a shared mutable object — tests that mutate it pollute later tests; clone with `structuredClone`
- Under `colorSource: "theme"`, only _named_ colors map to theme tokens. Raw 256-color indices (`"208"`) and hex values have no mapping; `safeThemeFg` swallows the throw and renders unstyled. Use names in shared defaults
- `colorSources` (legacy, flat) is a derived mirror of the canonical `components.<owner>.colorSource` values; the runtime value self-syncs, but the `defaultConfig` literal must be updated by hand

## Workflow

- Before shipping: `npm run fmt` · `npm run verify` · `npm run pack:check`
- Local testing: `npm run pi:dev` · `npm run pi:install-local`
- Conventional commits, lowercase subject, no trailing period
