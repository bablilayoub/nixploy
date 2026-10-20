import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

/**
 * CSS is the palette authority for editors and terminals. CodeMirror accepts
 * custom properties directly; xterm needs their concrete values at creation
 * and on theme changes. Keep the fallback usable before a document exists.
 */
const palette = {
	background: "var(--code-background)",
	foreground: "var(--code-foreground)",
	muted: "var(--code-muted)",
	mutedForeground: "var(--code-muted-foreground)",
	border: "var(--code-border)",
	accent: "var(--code-active)",
	selection: "var(--code-selection)",
	cursor: "var(--code-foreground)",
	keyword: "var(--code-keyword)",
	string: "var(--code-string)",
	number: "var(--code-number)",
	comment: "var(--code-comment)",
	tag: "var(--code-tag)",
	property: "var(--code-property)",
	operator: "var(--code-muted-foreground)",
	invalid: "var(--code-invalid)",
} as const;

type Palette = {
	background: string;
	foreground: string;
	muted: string;
	mutedForeground: string;
	border: string;
	accent: string;
	selection: string;
	cursor: string;
	keyword: string;
	string: string;
	number: string;
	comment: string;
	tag: string;
	property: string;
	operator: string;
	invalid: string;
};

function editorChrome(palette: Palette, isDark: boolean): Extension {
	return EditorView.theme(
		{
			"&": {
				color: palette.foreground,
				backgroundColor: palette.background,
				fontSize: "13px",
				fontFamily:
					"var(--font-plex-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
			},
			".cm-content": {
				caretColor: palette.cursor,
				fontFamily: "inherit",
			},
			".cm-cursor, .cm-dropCursor": {
				borderLeftColor: palette.cursor,
			},
			"&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
				{
					backgroundColor: palette.selection,
				},
			".cm-panels": {
				backgroundColor: palette.muted,
				color: palette.foreground,
			},
			".cm-panels.cm-panels-top": {
				borderBottom: `1px solid ${palette.border}`,
			},
			".cm-panels.cm-panels-bottom": {
				borderTop: `1px solid ${palette.border}`,
			},
			".cm-searchMatch": {
				backgroundColor: "var(--code-active)",
			},
			".cm-searchMatch.cm-searchMatch-selected": {
				backgroundColor: "var(--code-selection)",
				outline: "1px solid var(--code-keyword)",
			},
			".cm-activeLine": {
				backgroundColor: palette.accent,
			},
			".cm-selectionMatch": {
				backgroundColor: palette.selection,
			},
			"&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
				backgroundColor: palette.selection,
				outline: `1px solid ${palette.border}`,
			},
			".cm-gutters": {
				backgroundColor: palette.muted,
				color: palette.mutedForeground,
				border: "none",
				borderRight: `1px solid ${palette.border}`,
			},
			".cm-activeLineGutter": {
				backgroundColor: palette.accent,
				color: palette.foreground,
			},
			".cm-foldPlaceholder": {
				backgroundColor: palette.muted,
				border: `1px solid ${palette.border}`,
				color: palette.mutedForeground,
			},
			".cm-tooltip": {
				border: `1px solid ${palette.border}`,
				backgroundColor: palette.background,
				color: palette.foreground,
			},
			".cm-tooltip .cm-tooltip-arrow:before": {
				borderTopColor: palette.border,
				borderBottomColor: palette.border,
			},
			".cm-tooltip .cm-tooltip-arrow:after": {
				borderTopColor: palette.background,
				borderBottomColor: palette.background,
			},
			".cm-tooltip-autocomplete": {
				"& > ul > li[aria-selected]": {
					backgroundColor: palette.accent,
					color: palette.foreground,
				},
			},
			".cm-placeholder": {
				color: palette.mutedForeground,
			},
		},
		{ dark: isDark },
	);
}

function highlight(palette: Palette): Extension {
	return syntaxHighlighting(
		HighlightStyle.define([
			{ tag: t.keyword, color: palette.keyword, fontWeight: "600" },
			{ tag: [t.name, t.deleted, t.character, t.macroName], color: palette.foreground },
			{ tag: [t.propertyName], color: palette.property },
			{
				tag: [t.processingInstruction, t.string, t.inserted, t.special(t.string)],
				color: palette.string,
			},
			{ tag: [t.function(t.variableName), t.labelName], color: palette.tag },
			{ tag: [t.color, t.constant(t.name), t.standard(t.name)], color: palette.number },
			{ tag: [t.definition(t.name), t.separator], color: palette.foreground },
			{ tag: [t.className], color: palette.tag },
			{
				tag: [t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace],
				color: palette.number,
			},
			{ tag: [t.typeName], color: palette.tag, fontStyle: "italic" },
			{ tag: [t.operator, t.operatorKeyword], color: palette.operator },
			{ tag: [t.url, t.escape, t.regexp, t.link], color: palette.string },
			{ tag: [t.meta, t.comment], color: palette.comment, fontStyle: "italic" },
			{ tag: t.strong, fontWeight: "700" },
			{ tag: t.emphasis, fontStyle: "italic" },
			{ tag: t.strikethrough, textDecoration: "line-through" },
			{ tag: t.link, color: palette.tag, textDecoration: "underline" },
			{ tag: t.heading, fontWeight: "700", color: palette.foreground },
			{ tag: [t.atom, t.bool, t.special(t.variableName)], color: palette.number },
			{ tag: [t.processingInstruction, t.string, t.inserted], color: palette.string },
			{ tag: t.invalid, color: palette.invalid },
			{ tag: t.tagName, color: palette.tag },
			{ tag: t.attributeName, color: palette.property },
		]),
	);
}

export const nixployCodeMirrorLight: Extension = [editorChrome(palette, false), highlight(palette)];
export const nixployCodeMirrorDark: Extension = [editorChrome(palette, true), highlight(palette)];

/** xterm / log surfaces — same palette as the editors. */
function terminalTheme(isDark: boolean) {
	const css = typeof document === "undefined" ? null : getComputedStyle(document.documentElement);
	const color = (name: string, light: string, dark: string) =>
		css?.getPropertyValue(name).trim() || (isDark ? dark : light);
	const background = color("--code-background", "#ffffff", "#25212c");
	const foreground = color("--code-foreground", "#28232d", "#f0eaf4");
	const red = color("--code-invalid", "#b42f4b", "#ff98aa");
	const green = color("--code-string", "#28725c", "#8bd5b7");
	const yellow = color("--code-number", "#855e17", "#e7c083");
	const blue = color("--code-tag", "#366a94", "#9ac8e6");
	const magenta = color("--code-keyword", "#81375d", "#f5a9cc");
	const cyan = color("--info", "#366a94", "#8fbddf");
	return {
		background,
		foreground,
		cursor: foreground,
		cursorAccent: background,
		selectionBackground: color("--code-selection", "#e8ddea", "#4d3a50"),
		black: isDark ? "#17131c" : foreground,
		red,
		green,
		yellow,
		blue,
		magenta,
		cyan,
		white: isDark ? foreground : color("--code-muted", "#f3f0f6", "#f0eaf4"),
		brightBlack: color("--code-muted-foreground", "#73667e", "#b8adc1"),
		brightRed: red,
		brightGreen: green,
		brightYellow: yellow,
		brightBlue: blue,
		brightMagenta: magenta,
		brightCyan: cyan,
		brightWhite: foreground,
	};
}

export const nixployTerminalTheme = {
	get light() {
		return terminalTheme(false);
	},
	get dark() {
		return terminalTheme(true);
	},
};
