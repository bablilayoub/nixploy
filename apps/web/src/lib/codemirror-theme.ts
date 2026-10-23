import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

/**
 * CodeMirror chrome + syntax colors aligned with `apps/web/src/app/globals.css`
 * (official Neutral light/dark). Editor and terminal engines require concrete color values.
 */
const light = {
	background: "#ffffff",
	foreground: "#181818",
	muted: "#eeeeee",
	mutedForeground: "#666666",
	border: "#dfdfdf",
	accent: "#eeeeee",
	selection: "#dfdfdf",
	cursor: "#181818",
	keyword: "#181818",
	string: "#4d4d4d",
	number: "#4d4d4d",
	comment: "#666666",
	tag: "#4d4d4d",
	property: "#4d4d4d",
	operator: "#666666",
	invalid: "#4d4d4d",
} as const;

const dark = {
	background: "#0f0f0f",
	foreground: "#f5f5f5",
	muted: "#232323",
	mutedForeground: "#a5a5a5",
	border: "#2d2d2d",
	accent: "#232323",
	selection: "#2d2d2d",
	cursor: "#f5f5f5",
	keyword: "#f5f5f5",
	string: "#c7c7c7",
	number: "#c7c7c7",
	comment: "#a5a5a5",
	tag: "#e2e2e2",
	property: "#d4d4d4",
	operator: "#a5a5a5",
	invalid: "#8e8e8e",
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
				backgroundColor: isDark ? "#303030" : "#f2f2f2",
			},
			".cm-searchMatch.cm-searchMatch-selected": {
				backgroundColor: isDark ? "#545454" : "#e4e4e4",
			},
			".cm-activeLine": {
				backgroundColor: palette.accent,
			},
			".cm-selectionMatch": {
				backgroundColor: isDark ? "#2d2d2d" : "#dfdfdf",
			},
			"&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
				backgroundColor: isDark ? "#2d2d2d" : "#dfdfdf",
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
		black: "#181818",
		red: "#4d4d4d",
		green: "#5a5a5a",
		yellow: "#626262",
		blue: "#606060",
		magenta: "#555555",
		cyan: "#767676",
		white: "#eeeeee",
		brightBlack: "#666666",
		brightRed: "#686868",
		brightGreen: "#5a5a5a",
		brightYellow: "#626262",
		brightBlue: "#7b7b7b",
		brightMagenta: "#717171",
		brightCyan: "#939393",
		brightWhite: "#fafafa",
	},
	dark: {
		background: dark.background,
		foreground: dark.foreground,
		cursor: dark.cursor,
		cursorAccent: dark.background,
		selectionBackground: dark.selection,
		black: "#0c0c0c",
		red: "#8e8e8e",
		green: "#b8b8b8",
		yellow: "#c1c1c1",
		blue: "#9c9c9c",
		magenta: "#999999",
		cyan: "#afafaf",
		white: "#eeeeee",
		brightBlack: "#666666",
		brightRed: "#b7b7b7",
		brightGreen: "#d4d4d4",
		brightYellow: "#e4e4e4",
		brightBlue: "#bebebe",
		brightMagenta: "#c1c1c1",
		brightCyan: "#cecece",
		brightWhite: "#fafafa",
	},
} as const;
