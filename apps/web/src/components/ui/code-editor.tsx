"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";

export type { CodeEditorProps } from "./code-editor-impl";

function EditorFallback({ className }: { className?: string }) {
	return <Skeleton className={className ?? "min-h-64 w-full rounded-lg"} />;
}

/** Lazy CodeMirror — keeps unrelated tabs free of the editor bundle. */
export const CodeEditor = dynamic(() => import("./code-editor-impl").then((m) => m.CodeEditor), {
	ssr: false,
	loading: () => <EditorFallback />,
});
