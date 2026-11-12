import { stripVTControlCharacters } from "node:util";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { renderAccentRailEditorFrame } from "../extensions/zentui/accent-rail-editor";
import {
	mergeConfig,
	setSessionClosing,
	type PolishedTuiConfig,
} from "../extensions/zentui/config";
import { WrappedPolishedEditor } from "../extensions/zentui/ui";

function theme(calls: Array<{ color: string; text: string }> = []): Theme {
	return {
		fg(color: string, text: string) {
			calls.push({ color, text });
			return `\x1b[38;5;215m${text}\x1b[39m`;
		},
		bg(_color: string, text: string) {
			return `\x1b[48;5;234m${text}\x1b[49m`;
		},
		getBgAnsi() {
			return "\x1b[48;5;234m";
		},
		bold: (text: string) => text,
		italic: (text: string) => text,
		underline: (text: string) => text,
		strikethrough: (text: string) => text,
	} as unknown as Theme;
}

function config(overrides: Partial<PolishedTuiConfig["colors"]> = {}): PolishedTuiConfig {
	const current = mergeConfig(
		{ icons: { mode: "nerd" }, components: { editor: { colorSource: "theme" } } },
		{},
	);
	current.components.editor.style = "accent-rail";
	current.colors = { ...current.colors, ...overrides };
	return current;
}

function plain(value: string): string {
	return stripVTControlCharacters(value);
}

describe("accent rail editor frame", () => {
	it("renders one input row without private host layout padding", () => {
		const rows = renderAccentRailEditorFrame({
			width: 20,
			editorLines: ["draft"],
			uiTheme: theme(),
			config: config(),
		});
		expect(rows.map(plain)).toEqual(["▎ draft             "]);
	});

	it("renders a full-width filled rail surface for every input row", () => {
		const rows = renderAccentRailEditorFrame({
			width: 20,
			editorLines: ["Ask anything", "continuation"],
			uiTheme: theme(),
			config: config(),
		});

		expect(rows.map(plain)).toEqual(["▎ Ask anything      ", "▎ continuation      "]);
		for (const row of rows) {
			expect(visibleWidth(row)).toBe(20);
			expect(row).toContain("\x1b[48;5;234m");
		}
	});

	it("keeps blank buffer rows above and below multi-line input when padding is requested", () => {
		const rows = renderAccentRailEditorFrame({
			width: 20,
			editorLines: ["Ask anything", "continuation", "third"],
			autocompleteLines: ["→ pick"],
			padText: true,
			uiTheme: theme(),
			config: config(),
		});

		expect(rows.map(plain)).toEqual([
			"▎                   ",
			"▎ Ask anything      ",
			"▎ continuation      ",
			"▎ third             ",
			"▎                   ",
			"▎ pick              ",
		]);
		for (const row of rows) {
			expect(visibleWidth(row)).toBe(20);
			expect(row).toContain("\x1b[48;5;234m");
		}
	});

	it("fills autocomplete and replaces only the native selected prefix", () => {
		const selected = "\x1b[38;5;39m→ settings\x1b[0m";
		const unusual = "\x1b]8;;https://example.com\x07→ linked\x1b]8;;\x07";
		const rows = renderAccentRailEditorFrame({
			width: 20,
			editorLines: ["draft"],
			autocompleteLines: [selected, "  files", unusual],
			uiTheme: theme(),
			config: config(),
		});
		expect(rows).toHaveLength(4);
		expect(rows.slice(1).map(plain)).toEqual([
			"▎ settings          ",
			"  files             ",
			"→ linked            ",
		]);
		expect(rows[1]).toContain("\x1b[38;5;242m▎\x1b[0m\x1b[48;5;234m \x1b[38;5;39msettings");
		for (const row of rows.slice(1)) {
			expect(row).toContain("\x1b[48;5;234m");
			expect(visibleWidth(row)).toBe(20);
		}
	});

	it("replaces C1 SGR selection while preserving control-CSI rows unchanged", () => {
		const c1Selected = "\u009b38;5;39m→ settings\u009b0m";
		const erased = "\x1b[2K→ unsafe";
		const c1Erased = "\u009b2K→ c1-unsafe";
		const rows = renderAccentRailEditorFrame({
			width: 20,
			editorLines: ["draft"],
			autocompleteLines: [c1Selected, erased, c1Erased],
			uiTheme: theme(),
			config: config(),
		});
		expect(rows[1]).toContain(
			"\x1b[38;5;242m▎\x1b[0m\x1b[48;5;234m \u009b38;5;39msettings\u009b0m",
		);
		expect(rows[2]).toContain(erased);
		expect(plain(rows[2] ?? "")).toContain("→ unsafe");
		expect(rows[3]).toContain(c1Erased);
		expect(plain(rows[3] ?? "")).toContain("→ c1-unsafe");
	});

	it("fails open at width two and decorates one content cell at width three", () => {
		const narrow = renderAccentRailEditorFrame({
			width: 2,
			editorLines: ["draft"],
			autocompleteLines: ["pick"],
			uiTheme: theme(),
			config: config(),
		});
		expect(narrow.map(plain)).toEqual(["dr", "pi"]);

		const minimum = renderAccentRailEditorFrame({
			width: 3,
			editorLines: ["draft"],
			uiTheme: theme(),
			config: config(),
		});
		expect(minimum.map(plain)).toEqual(["▎ d"]);
	});

	it("keeps ANSI, combining text, and emoji within the requested width", () => {
		const rows = renderAccentRailEditorFrame({
			width: 12,
			editorLines: ["\x1b[1mé\u0301dit\x1b[0m 🧠 data"],
			uiTheme: theme(),
			config: config(),
		});
		expect(plain(rows[0] ?? "")).toContain("▎ é\u0301dit");
		expect(visibleWidth(rows[0] ?? "")).toBe(12);
		expect(rows[0]).toContain("\x1b[0m\x1b[48;5;234m");
	});

	it.each([
		["an unavailable getBgAnsi", undefined],
		[
			"a throwing getBgAnsi",
			() => {
				throw new Error("background unavailable");
			},
		],
	] as const)("reapplies the theme.bg fallback after resets with %s", (_name, getBgAnsi) => {
		for (const reset of ["\x1b[0m", "\x1b[m", "\x1b[49m"]) {
			const fallbackTheme = { ...theme(), getBgAnsi } as unknown as Theme;
			const [row] = renderAccentRailEditorFrame({
				width: 14,
				editorLines: [`draft${reset}█`],
				uiTheme: fallbackTheme,
				config: config(),
			});

			expect(visibleWidth(row ?? "")).toBe(14);
			expect(row).toContain(`${reset}\x1b[48;5;234m█`);
			expect(row).toMatch(/\x1b\[48;5;234m█ +\x1b\[49m$/);
		}
	});

	it("uses the style-owned ASCII rail", () => {
		const current = config();
		current.icons.mode = "ascii";
		current.icons.effectiveMode = "ascii";
		current.components.editor.styles["accent-rail"].asciiRail = "!";
		const rows = renderAccentRailEditorFrame({
			width: 10,
			editorLines: ["draft"],
			autocompleteLines: ["→ pick"],
			uiTheme: theme(),
			config: current,
		});
		expect(rows.map(plain)).toEqual(["! draft   ", "! pick    "]);
	});

	it("uses the fixed grey rail default and an explicit editor-only override", () => {
		const [themeRow] = renderAccentRailEditorFrame({
			width: 10,
			editorLines: ["draft"],
			uiTheme: theme(),
			config: config(),
		});
		expect(themeRow).toContain("\x1b[38;5;242m▎\x1b[0m");

		const terminal = config();
		terminal.components.editor.colorSource = "terminal";
		const [terminalRow] = renderAccentRailEditorFrame({
			width: 10,
			editorLines: ["draft"],
			uiTheme: theme(),
			config: terminal,
		});
		expect(terminalRow).toContain("\x1b[38;5;242m▎\x1b[0m");

		const overrideCalls: Array<{ color: string; text: string }> = [];
		const independent = config({ editorRail: "success", editorAccent: "error" });
		independent.components.userMessages.enabled = false;
		independent.components.userMessages.style = "labeled";
		independent.components.userMessages.colorSource = "terminal";
		renderAccentRailEditorFrame({
			width: 10,
			editorLines: ["draft"],
			uiTheme: theme(overrideCalls),
			config: independent,
		});
		expect(overrideCalls).toContainEqual({ color: "success", text: "▎" });
		expect(overrideCalls).not.toContainEqual({ color: "error", text: "▎" });
	});

	it("colors the rail glyph with the fixed terminal thinking heat scale", () => {
		const levels: Array<[string, string]> = [
			["minimal", "\x1b[38;5;242m"],
			["low", "\x1b[38;5;150m"],
			["medium", "\x1b[38;5;215m"],
			["high", "\x1b[38;5;209m"],
			["xhigh", "\x1b[38;5;1m"],
			["max", "\x1b[38;5;9m"],
		];
		for (const [level, code] of levels) {
			const [row] = renderAccentRailEditorFrame({
				width: 10,
				editorLines: ["draft"],
				uiTheme: theme(),
				config: config(),
				thinkingLevel: level,
			});
			expect(row).toContain(`${code}▎\x1b[0m`);
		}
	});

	it("keeps the fixed thinking colors in terminal color source mode", () => {
		const terminal = config();
		terminal.components.editor.colorSource = "terminal";
		const [row] = renderAccentRailEditorFrame({
			width: 10,
			editorLines: ["draft"],
			uiTheme: theme(),
			config: terminal,
			thinkingLevel: "high",
		});
		expect(row).toContain("\x1b[38;5;209m▎\x1b[0m");
	});

	it("lets a thinking-level color override win over the rail color", () => {
		const overrideCalls: Array<{ color: string; text: string }> = [];
		const independent = config({ editorRail: "success", editorThinkingHigh: "warning" });
		renderAccentRailEditorFrame({
			width: 10,
			editorLines: ["draft"],
			uiTheme: theme(overrideCalls),
			config: independent,
			thinkingLevel: "high",
		});
		expect(overrideCalls).toContainEqual({ color: "warning", text: "▎" });
		expect(overrideCalls).not.toContainEqual({ color: "success", text: "▎" });
	});

	it("keeps the grey rail color while thinking is off", () => {
		const [row] = renderAccentRailEditorFrame({
			width: 10,
			editorLines: ["draft"],
			uiTheme: theme(),
			config: config(),
			thinkingLevel: "off",
		});
		expect(row).toContain("\x1b[38;5;242m▎\x1b[0m");
	});

	it("removes only owned backgrounds in transparent mode", () => {
		const current = config();
		current.components.editor.styles["accent-rail"].transparent = true;
		const nativeBackground = "\x1b[48;5;52m  warning\x1b[49m";
		const rows = renderAccentRailEditorFrame({
			width: 16,
			editorLines: ["draft"],
			autocompleteLines: [nativeBackground],
			uiTheme: theme(),
			config: current,
		});
		expect(rows.map(plain)).toEqual(["▎ draft         ", "  warning       "]);
		expect(rows[0]).not.toContain("\x1b[48;5;234m");
		expect(rows[1]).not.toContain("\x1b[48;5;234m");
		expect(rows[1]).toContain("\x1b[48;5;52m");
	});

	it("renders compact viewport indicators only when enabled", () => {
		const current = config();
		const render = () =>
			renderAccentRailEditorFrame({
				width: 16,
				editorLines: ["draft"],
				viewport: { above: "2", below: "3" },
				uiTheme: theme(),
				config: current,
			}).map(plain);
		expect(render()).toEqual(["▎ ↑ 2 more      ", "▎ draft         ", "▎ ↓ 3 more      "]);
		current.components.editor.viewportIndicators = false;
		expect(render()).toEqual(["▎ draft         "]);
	});
});

describe("accent rail editor frame metadata and rail width", () => {
	function railConfig(): PolishedTuiConfig {
		const current = config();
		current.components.editor.style = "accent-rail";
		return current;
	}

	function baseEditor(text = "draft") {
		return {
			render: (width: number) => ["─".repeat(width), text, "─".repeat(width)],
			invalidate() {},
			handleInput() {},
			getText: () => text,
			setText() {},
		};
	}

	it("keeps the reserved rail block around multi-line input", () => {
		const editor = new WrappedPolishedEditor(
			{
				render: (width: number) => ["─".repeat(width), "first", "second", "─".repeat(width)],
				invalidate() {},
				handleInput() {},
				getText: () => "first\nsecond",
				setText() {},
			} as never,
			theme(),
			() => railConfig(),
			() => ({ modelLabel: "sonnet-4", providerLabel: "anthropic" }),
			() => "high",
		);
		const rows = editor.render(28);
		expect(rows.map(plain)).toEqual([
			"  sonnet-4  anthropic  high",
			"▎                           ",
			"▎ first                     ",
			"▎ second                    ",
			"▎                           ",
		]);
		// The rail glyph follows the active thinking level (high → fg:209).
		expect(rows[2]).toContain("\x1b[38;5;209m▎\x1b[0m");
	});

	it("renders the metadata row as plain text above the reserved rail block when it fits", () => {
		const editor = new WrappedPolishedEditor(
			baseEditor() as never,
			theme(),
			() => railConfig(),
			() => ({ modelLabel: "sonnet-4", providerLabel: "anthropic" }),
			() => "high",
		);
		const rows = editor.render(28).map(plain);
		expect(rows[0]).toBe("  sonnet-4  anthropic  high");
		expect(rows.slice(1)).toEqual([
			"▎                           ",
			"▎ draft                     ",
			"▎                           ",
		]);
		// Metadata is plain text: no rail glyph, no filled background.
		expect(editor.render(28)[0]).not.toContain("▎");
		expect(editor.render(28)[0]).not.toContain("\x1b[48;5;234m");
	});

	it("renders plain rows without rail or owned background while the session is closing", () => {
		const current = railConfig();
		const editor = new WrappedPolishedEditor(
			baseEditor() as never,
			theme(),
			() => current,
			() => ({ modelLabel: "sonnet-4", providerLabel: "anthropic" }),
			() => "high",
		);
		setSessionClosing(current, true);
		const rows = editor.render(28);
		for (const row of rows) {
			expect(row).not.toContain("▎");
			expect(row).not.toContain("\x1b[48;5;234m");
		}
		expect(rows.map(plain)).toEqual(["─".repeat(28), "draft", "─".repeat(28)]);
		setSessionClosing(current, false);
		expect(editor.render(28)[1]).toContain("▎");
	});

	it("hides the metadata row when it does not fit the width", () => {
		const editor = new WrappedPolishedEditor(
			baseEditor() as never,
			theme(),
			() => railConfig(),
			() => ({ modelLabel: "sonnet-4", providerLabel: "anthropic" }),
			() => "high",
		);
		const rows = editor.render(10).map(plain);
		expect(rows.some((row) => row.includes("sonnet-4"))).toBe(false);
	});

	it("repeats the rail glyph for wider rails", () => {
		const current = railConfig();
		current.components.editor.styles["accent-rail"].railWidth = 4;
		const rows = renderAccentRailEditorFrame({
			width: 20,
			editorLines: ["draft"],
			uiTheme: theme(),
			config: current,
		});
		expect(rows.map(plain)).toEqual(["▎▎▎ draft           "]);
		expect(visibleWidth(rows[0])).toBe(20);
	});

	it("falls back to plain rows when the rail leaves no content width", () => {
		const current = railConfig();
		current.components.editor.styles["accent-rail"].railWidth = 4;
		const rows = renderAccentRailEditorFrame({
			width: 4,
			editorLines: ["draft"],
			uiTheme: theme(),
			config: current,
		});
		expect(rows.map(plain)).toEqual(["draf"]);
	});

	it("metadata stays plain text regardless of the transparent surface setting", () => {
		const current = railConfig();
		current.components.editor.styles["accent-rail"].transparent = true;
		const editor = new WrappedPolishedEditor(
			baseEditor() as never,
			theme(),
			() => current,
			() => ({ modelLabel: "sonnet-4", providerLabel: "anthropic" }),
			() => "high",
		);
		const rows = editor.render(28);
		expect(rows[0]).not.toContain("\x1b[48;5;234m");
		expect(plain(rows[0])).toBe("  sonnet-4  anthropic  high");
	});
});
