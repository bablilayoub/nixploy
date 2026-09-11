"use client";

import type { Extension } from "@codemirror/state";
import CodeMirror, { type ReactCodeMirrorProps } from "@uiw/react-codemirror";
import { Eye, Pencil } from "lucide-react";
import { useTheme } from "next-themes";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useMounted } from "@/hooks/use-mounted";
import { nixployCodeMirrorDark, nixployCodeMirrorLight } from "@/lib/codemirror-theme";
import { cn } from "@/lib/utils";

export type CodeEditorProps = Omit<ReactCodeMirrorProps, "theme" | "editable" | "readOnly"> & {
	className?: string;
	/**
	 * Soft-lock with a blurred overlay until the user clicks Edit/View.
	 * Default true. Permanently read-only surfaces still use a View unlock.
	 */
	protect?: boolean;
	/** Controlled lock; when set, pairs with `onLockedChange`. */
	locked?: boolean;
	onLockedChange?: (locked: boolean) => void;
	/** Force read-only even after unlock (e.g. Traefik static config). */
	readOnly?: boolean;
	/** Extra controls on the lock overlay. */
	overlayActions?: ReactNode;
	lockMessage?: string;
};

/**
 * CodeMirror wrapper that follows the Nixploy light/dark stone theme
 * and soft-locks with a blur overlay until Edit/View.
 */
export function CodeEditor({
	className,
	extensions,
	protect = true,
	locked: lockedProp,
	onLockedChange,
	readOnly = false,
	overlayActions,
	lockMessage = "Locked to prevent accidental edits.",
	basicSetup,
	onChange,
	...props
}: CodeEditorProps) {
	const { resolvedTheme } = useTheme();
	const mounted = useMounted();
	const [unlockedInternal, setUnlockedInternal] = useState(!protect);

	const isControlled = lockedProp !== undefined;
	const locked = isControlled ? lockedProp : !unlockedInternal;

	const setLocked = useCallback(
		(next: boolean) => {
			onLockedChange?.(next);
			if (!isControlled) setUnlockedInternal(!next);
		},
		[isControlled, onLockedChange],
	);

	useEffect(() => {
		if (!protect) setLocked(false);
	}, [protect, setLocked]);

	const isDark = mounted ? resolvedTheme === "dark" : true;
	const theme = isDark ? nixployCodeMirrorDark : nixployCodeMirrorLight;
	const mergedExtensions: Extension[] = [
		...(Array.isArray(extensions) ? extensions : extensions ? [extensions] : []),
	];

	const canEdit = !readOnly && !locked;
	const unlockLabel = readOnly ? "View" : "Edit";
	const UnlockIcon = readOnly ? Eye : Pencil;
	const setup =
		typeof basicSetup === "object" && basicSetup
			? { ...basicSetup, highlightActiveLine: canEdit }
			: basicSetup === false
				? false
				: { highlightActiveLine: canEdit };

	return (
		<div
			className={cn(
				"relative overflow-hidden rounded-lg border border-border bg-card [&_.cm-editor]:outline-none",
				className,
			)}
		>
			<CodeMirror
				theme={theme}
				extensions={mergedExtensions}
				editable={canEdit}
				readOnly={!canEdit}
				basicSetup={setup}
				onChange={canEdit ? onChange : () => undefined}
				{...props}
			/>
			{protect && locked && (
				<div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/60 backdrop-blur-sm">
					<div className="flex flex-wrap items-center justify-center gap-2">
						<Button type="button" size="sm" onClick={() => setLocked(false)}>
							<UnlockIcon className="size-3.5" />
							{unlockLabel}
						</Button>
						{overlayActions}
					</div>
					{lockMessage ? (
						<p className="max-w-xs px-4 text-center text-xs text-muted-foreground">{lockMessage}</p>
					) : null}
				</div>
			)}
		</div>
	);
}
