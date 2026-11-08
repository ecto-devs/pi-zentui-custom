import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { CodexQuota } from "./codex-quota.ts";
import { renderCodexQuota } from "./codex-quota-display.ts";
import {
	applyOwnedSurfaceBackground,
	fillTerminalLine,
	renderCompletionRows,
} from "./completion-menu.ts";
import { componentColor } from "./component-colors.ts";
import type { ZentuiConfig } from "./config.ts";
import { editorThinkingStyle } from "./editor-metadata-format.ts";
import { resolveAccentRailGlyph } from "./rail-glyph.ts";
import { renderStyleForSourceOrFallback, type SourceStyleFallback } from "./style.ts";

export const ACCENT_RAIL_CHROME_WIDTH = 2;

// Neutral grey while thinking is off, the coldest end of the heat scale.
const ACCENT_RAIL_FALLBACK: SourceStyleFallback = {
	theme: "fg:242",
	terminal: "fg:242",
};

/**
 * Fixed heat-scale rail colors while a thinking level is active. Explicit
 * terminal values are honored verbatim in both color sources, so the rail
 * stays theme-independent; per-level config overrides still win.
 */
const ACCENT_RAIL_THINKING_FALLBACKS: Record<string, SourceStyleFallback> = {
	minimal: { theme: "fg:242", terminal: "fg:242" },
	low: { theme: "fg:150", terminal: "fg:150" },
	medium: { theme: "fg:215", terminal: "fg:215" },
	high: { theme: "fg:209", terminal: "fg:209" },
	xhigh: { theme: "fg:1", terminal: "fg:1" },
	max: { theme: "fg:9", terminal: "fg:9" },
};

export type AccentRailViewport = {
	above?: string;
	below?: string;
};

export type AccentRailEditorFrameOptions = {
	codexQuota?: CodexQuota;
	width: number;
	editorLines: string[];
	autocompleteLines?: string[];
	viewport?: AccentRailViewport;
	uiTheme: Theme;
	config: ZentuiConfig;
	/**
	 * Reserve a blank rail row on each side of the input text (rendered through
	 * the same surface as the text) so the block always keeps visual buffer
	 * space above and below the text, no matter how many lines it holds.
	 * Off by default to keep pure/preview renders tight.
	 */
	padText?: boolean;
	/**
	 * Active thinking level. When set (and not "off") the rail glyph takes the
	 * level's thinking color; otherwise the configured rail color applies.
	 */
	thinkingLevel?: string;
};

export function accentRailChromeWidth(config: ZentuiConfig): number {
	return config.components.editor.styles["accent-rail"].railWidth;
}

function clampLines(lines: string[], width: number): string[] {
	const maxWidth = Math.max(0, width);
	return lines.map((line) => truncateToWidth(line, maxWidth, ""));
}

function selectedRail(config: ZentuiConfig): string {
	return resolveAccentRailGlyph(config);
}

export function viewportLabel(
	direction: "above" | "below",
	count: string | undefined,
): string | undefined {
	if (!count || !/^[1-9]\d*$/.test(count)) return undefined;
	return `${direction === "above" ? "↑" : "↓"} ${count} more`;
}

/** Pure compact accent-rail composition shared by live rendering and settings previews. */
export function renderAccentRailEditorFrame({
	codexQuota,
	width,
	editorLines,
	autocompleteLines = [],
	viewport = {},
	uiTheme,
	config,
	padText = false,
	thinkingLevel,
}: AccentRailEditorFrameOptions): string[] {
	const chromeWidth = accentRailChromeWidth(config);
	if (width < chromeWidth + 1) {
		return clampLines([...editorLines, ...autocompleteLines], width);
	}

	// The rail owns the first chromeWidth - 1 columns; the final chrome column
	// stays a space so the body begins one column in, exactly like the original
	// rail. Usable body text width is the space column plus what follows it.
	const contentWidth = Math.max(0, width - chromeWidth - 1);
	const activeThinking =
		thinkingLevel && thinkingLevel.toLowerCase() !== "off" ? thinkingLevel : "";
	const rail = activeThinking
		? renderStyleForSourceOrFallback(
				uiTheme,
				config.components.editor.colorSource,
				editorThinkingStyle(config, activeThinking),
				ACCENT_RAIL_THINKING_FALLBACKS[activeThinking.toLowerCase()] ?? ACCENT_RAIL_FALLBACK,
				selectedRail(config),
			)
		: renderStyleForSourceOrFallback(
				uiTheme,
				config.components.editor.colorSource,
				componentColor(config, "editor", "rail"),
				ACCENT_RAIL_FALLBACK,
				selectedRail(config),
			);
	const above = config.components.editor.viewportIndicators
		? viewportLabel("above", viewport.above)
		: undefined;
	const below = config.components.editor.viewportIndicators
		? viewportLabel("below", viewport.below)
		: undefined;
	const quota = renderCodexQuota(codexQuota, uiTheme, config, "editor");
	const quotaVisible = Boolean(quota && visibleWidth(quota) <= contentWidth);
	// Reserved blank rows sit between the viewport/quota rows and the text so
	// the block always reads as one continuous rail with buffer space.
	const paddedEditorLines = padText ? ["", ...editorLines, ""] : editorLines;
	const rows = [
		...(above ? [above] : []),
		...paddedEditorLines,
		...(below ? [below] : []),
		...(quotaVisible ? [quota as string] : []),
	];
	const transparent = config.components.editor.styles["accent-rail"].transparent;
	// The rail owns the first chromeWidth - 1 columns; the final column stays a
	// space so the body begins one column in, exactly like the original rail.
	const railCell = transparent
		? rail.repeat(Math.max(0, chromeWidth - 1))
		: applyOwnedSurfaceBackground(uiTheme, rail.repeat(Math.max(0, chromeWidth - 1)));
	const surface = rows.map((line) => {
		const bodyText = ` ${fillTerminalLine(line, contentWidth + 1)}`;
		const body = transparent ? bodyText : applyOwnedSurfaceBackground(uiTheme, bodyText);
		return `${railCell}${body}`;
	});
	const autocompleteSurface = renderCompletionRows({
		lines: autocompleteLines,
		width,
		theme: uiTheme,
		selectedPrefix: `${rail} `,
		ownedBackground: !transparent,
	});

	return clampLines([...surface, ...autocompleteSurface], width);
}
