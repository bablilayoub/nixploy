"use client";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import React from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";

/*
 * A greyscale Prism theme. The site has no accent colour, and the themes that
 * ship with react-syntax-highlighter are all four-colour — a yellow `curl` on
 * a blue panel was the loudest thing on the page. Tokens differ by lightness
 * here, which is enough to read a command.
 */
const monochrome: Record<string, React.CSSProperties> = {
	'code[class*="language-"]': { color: "var(--foreground)", background: "none" },
	'pre[class*="language-"]': { color: "var(--foreground)", background: "none" },
	comment: { color: "var(--muted-foreground)", fontStyle: "italic" },
	prolog: { color: "var(--muted-foreground)" },
	doctype: { color: "var(--muted-foreground)" },
	cdata: { color: "var(--muted-foreground)" },
	punctuation: { color: "var(--muted-foreground)" },
	property: { color: "var(--foreground)" },
	tag: { color: "var(--foreground)" },
	boolean: { color: "var(--foreground)" },
	number: { color: "var(--foreground)" },
	constant: { color: "var(--foreground)" },
	symbol: { color: "var(--foreground)" },
	selector: { color: "var(--muted-foreground)" },
	"attr-name": { color: "var(--muted-foreground)" },
	string: { color: "var(--muted-foreground)" },
	char: { color: "var(--muted-foreground)" },
	builtin: { color: "var(--foreground)" },
	operator: { color: "var(--muted-foreground)" },
	entity: { color: "var(--foreground)" },
	url: { color: "var(--muted-foreground)" },
	variable: { color: "var(--foreground)" },
	atrule: { color: "var(--foreground)" },
	"attr-value": { color: "var(--muted-foreground)" },
	keyword: { color: "var(--foreground)", fontWeight: "600" },
	function: { color: "var(--foreground)", fontWeight: "600" },
	regex: { color: "var(--muted-foreground)" },
	important: { color: "var(--foreground)", fontWeight: "bold" },
	bold: { fontWeight: "bold" },
	italic: { fontStyle: "italic" },
};

type CodeBlockProps = {
	language: string;
	filename: string;
	highlightLines?: number[];
} & (
	| {
			code: string;
			tabs?: never;
	  }
	| {
			code?: never;
			tabs: Array<{
				name: string;
				code: string;
				language?: string;
				highlightLines?: number[];
			}>;
	  }
);

export const CodeBlock = ({
	language,
	filename,
	code,
	highlightLines = [],
	tabs = [],
}: CodeBlockProps) => {
	const [copied, setCopied] = React.useState(false);
	const [activeTab, setActiveTab] = React.useState(0);

	const tabsExist = tabs.length > 0;

	const copyToClipboard = async () => {
		const textToCopy = tabsExist ? tabs[activeTab].code : code;
		if (textToCopy) {
			await navigator.clipboard.writeText(textToCopy);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		}
	};

	const activeCode = tabsExist ? tabs[activeTab].code : code;
	const activeLanguage = tabsExist ? tabs[activeTab].language || language : language;
	const activeHighlightLines = tabsExist ? tabs[activeTab].highlightLines || [] : highlightLines;

	return (
		<div className="relative w-full rounded-lg border bg-card/60 p-4 font-mono text-sm">
			<div className="flex flex-col gap-2">
				{tabsExist && (
					<div className="flex  overflow-x-auto">
						{tabs.map((tab, index) => (
							<button
								key={index}
								onClick={() => setActiveTab(index)}
								className={`px-3 !py-2 text-xs transition-colors font-sans ${
									activeTab === index ? "text-white" : "text-zinc-400 hover:text-zinc-200"
								}`}
							>
								{tab.name}
							</button>
						))}
					</div>
				)}
				{!tabsExist && filename && (
					<div className="flex justify-between items-center py-2">
						<div className="text-xs text-zinc-400">{filename}</div>
						<button
							onClick={copyToClipboard}
							className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors font-sans"
						>
							{copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
						</button>
					</div>
				)}
			</div>
			<SyntaxHighlighter
				language={activeLanguage}
				style={monochrome}
				customStyle={{
					margin: 0,
					padding: 0,
					background: "transparent",
					fontSize: "0.875rem", // text-sm equivalent
					whiteSpace: "pre-wrap",
					wordBreak: "break-word",
				}}
				wrapLines={true}
				wrapLongLines={true}
				codeTagProps={{
					style: { whiteSpace: "pre-wrap", wordBreak: "break-word" },
				}}
				showLineNumbers={true}
				lineProps={(lineNumber) => ({
					style: {
						backgroundColor: activeHighlightLines.includes(lineNumber)
							? "rgba(255,255,255,0.1)"
							: "transparent",
						display: "block",
						width: "100%",
					},
				})}
				PreTag="div"
			>
				{String(activeCode)}
			</SyntaxHighlighter>
		</div>
	);
};
