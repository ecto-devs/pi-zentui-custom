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
import { resolveAccentRailGlyph } from "./rail-glyph.ts";
import { renderStyleForSourceOrFallback, type SourceStyleFallback } from "./style.ts";

export const ACCENT_RAIL_CHROME_WIDTH = 2;

const ACCENT_RAIL_FALLBACK: SourceStyleFallback = {
	theme: "syntaxNumber",
	terminal: "fg:215",
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
}: AccentRailEditorFrameOptions): string[] {
	const chromeWidth = accentRailChromeWidth(config);
	if (width < chromeWidth + 1) {
		return clampLines([...editorLines, ...autocompleteLines], width);
	}

	// The rail owns the first chromeWidth - 1 columns; the final chrome column
	// stays a space so the body begins one column in, exactly like the original
	// rail. Usable body text width is the space column plus what follows it.
	const contentWidth = Math.max(0, width - chromeWidth - 1);
	const rail = renderStyleForSourceOrFallback(
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
