import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

/**
 * CodeMirror chrome + syntax colors aligned with `apps/web/src/app/globals.css`
 * (light: neutral paper, dark: graphite). Keep hex values in sync when the design tokens change.
 */
const light = {
	background: "#ffffff",
	foreground: "#17181b",
	muted: "#eceef0",
	mutedForeground: "#62666f",
	border: "#dedfe3",
	accent: "#eceef0",
	selection: "#dedfe3",
	cursor: "#17181b",
	keyword: "#17181b",
	string: "#484d57",
	number: "#484d57",
	comment: "#62666f",
	tag: "#484d57",
	property: "#484d57",
	operator: "#62666f",
	invalid: "#dc2626",
} as const;

const dark = {
	background: "#0d0f11",
	foreground: "#f5f5f6",
	muted: "#202328",
	mutedForeground: "#a0a5ae",
	border: "#2a2d32",
	accent: "#202328",
	selection: "#2a2d32",
	cursor: "#f5f5f6",
	keyword: "#f5f5f6",
	string: "#c3c7ce",
	number: "#c3c7ce",
	comment: "#a0a5ae",
	tag: "#e0e2e6",
	property: "#d4d4d8",
	operator: "#a0a5ae",
	invalid: "#f87171",
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
					"var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
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
				backgroundColor: isDark ? "#2a2d32" : "#dedfe3",
			},
			"&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
				backgroundColor: isDark ? "#2a2d32" : "#dedfe3",
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
		black: "#17181b",
		red: "#dc2626",
		green: "#187040",
		yellow: "#965b08",
		blue: "#2563eb",
		magenta: "#7c3aed",
		cyan: "#0891b2",
		white: "#eceef0",
		brightBlack: "#62666f",
		brightRed: "#ef4444",
		brightGreen: "#187040",
		brightYellow: "#965b08",
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
		red: "#f87171",
		green: "#4ade80",
		yellow: "#fbbf24",
		blue: "#60a5fa",
		magenta: "#c084fc",
		cyan: "#22d3ee",
		white: "#eceef0",
		brightBlack: "#62666f",
		brightRed: "#fca5a5",
		brightGreen: "#86efac",
		brightYellow: "#fde68a",
		brightBlue: "#93c5fd",
		brightMagenta: "#d8b4fe",
		brightCyan: "#67e8f9",
		brightWhite: "#fafaf9",
	},
} as const;
