import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

/**
 * CodeMirror chrome + syntax colors aligned with `apps/web/src/app/globals.css`
 * (Studio light and dark). Keep hex values in sync when the design tokens change.
 */
const light = {
	background: "#ffffff",
	foreground: "#20242c",
	muted: "#f4f6fa",
	mutedForeground: "#667081",
	border: "#e5e8ed",
	accent: "#f4f6fa",
	selection: "#e5e8ed",
	cursor: "#20242c",
	keyword: "#20242c",
	string: "#15803d",
	number: "#b45309",
	comment: "#657082",
	tag: "#2563eb",
	property: "#556270",
	operator: "#667081",
	invalid: "#ba4a52",
} as const;

const dark = {
	background: "#1d2027",
	foreground: "#edf0f5",
	muted: "#272d38",
	mutedForeground: "#aeb8c9",
	border: "#343b47",
	accent: "#272d38",
	selection: "#343b47",
	cursor: "#edf0f5",
	keyword: "#edf0f5",
	string: "#4ade80",
	number: "#fbbf24",
	comment: "#9ca9bc",
	tag: "#60a5fa",
	property: "#d4d4d8",
	operator: "#aeb8c9",
	invalid: "#f2a1aa",
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
					"var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
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
				backgroundColor: isDark ? "#3b2f1a" : "#fef3c7",
			},
			".cm-searchMatch.cm-searchMatch-selected": {
				backgroundColor: isDark ? "#854d0e" : "#fde68a",
			},
			".cm-activeLine": {
				backgroundColor: palette.accent,
			},
			".cm-selectionMatch": {
				backgroundColor: isDark ? "#343b47" : "#e5e8ed",
			},
			"&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
				backgroundColor: isDark ? "#343b47" : "#e5e8ed",
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

export const nixployCodeMirrorLight: Extension = [editorChrome(light, false), highlight(light)];
export const nixployCodeMirrorDark: Extension = [editorChrome(dark, true), highlight(dark)];

/** xterm / log surfaces — same palette as the editors. */
export const nixployTerminalTheme = {
	light: {
		background: light.background,
		foreground: light.foreground,
		cursor: light.cursor,
		cursorAccent: light.background,
		selectionBackground: light.selection,
		black: "#20242c",
		red: "#ba4a52",
		green: "#16a34a",
		yellow: "#d97706",
		blue: "#2563eb",
		magenta: "#7c3aed",
		cyan: "#0891b2",
		white: "#f4f6fa",
		brightBlack: "#667081",
		brightRed: "#ef4444",
		brightGreen: "#22c55e",
		brightYellow: "#f59e0b",
		brightBlue: "#3b82f6",
		brightMagenta: "#8b5cf6",
		brightCyan: "#06b6d4",
		brightWhite: "#fafaf9",
	},
	dark: {
		background: dark.background,
		foreground: dark.foreground,
		cursor: dark.cursor,
		cursorAccent: dark.background,
		selectionBackground: dark.selection,
		black: "#0c0c0b",
		red: "#f2a1aa",
		green: "#4ade80",
		yellow: "#fbbf24",
		blue: "#60a5fa",
		magenta: "#c084fc",
		cyan: "#22d3ee",
		white: "#f4f6fa",
		brightBlack: "#657082",
		brightRed: "#fca5a5",
		brightGreen: "#86efac",
		brightYellow: "#fde68a",
		brightBlue: "#93c5fd",
		brightMagenta: "#d8b4fe",
		brightCyan: "#67e8f9",
		brightWhite: "#fafaf9",
	},
} as const;
