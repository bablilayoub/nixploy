"use client";

import { EyeOff, Loader2, Save, X } from "lucide-react";
import { useEffect, useState } from "react";

import { capabilityHint } from "@/components/services/capability-hint";
import { Button } from "@/components/ui/button";
import { CodeEditor } from "@/components/ui/code-editor";

export function EnvEditor({
	value,
	onSave,
	loading,
	canRead = true,
	canEdit = true,
}: {
	/**
	 * Current server value. `null` is ambiguous — it is both "never set" and
	 * "redacted" (the server nulls it for members without `secrets.read`), so
	 * the hidden state is driven by `canRead`, never by the value.
	 */
	value: string | null;
	/**
	 * Persist the draft. Must return the mutation promise (`mutateAsync`) so the
	 * editor only leaves edit mode once the save succeeded; a rejected promise
	 * keeps the draft and stays in edit mode (the caller toasts the error).
	 */
	onSave: (value: string) => Promise<unknown>;
	loading?: boolean;
	/**
	 * Member has `secrets.read`. When false the server redacted the value, so a
	 * read-only notice replaces the editor — otherwise a save could wipe the
	 * stored variables with an empty draft.
	 */
	canRead?: boolean;
	/** Member has `secrets.write`; when false the editor stays locked. */
	canEdit?: boolean;
}) {
	const serverValue = value ?? "";
	const [draft, setDraft] = useState(serverValue);
	const [saving, setSaving] = useState(false);
	const [editing, setEditing] = useState(false);

	useEffect(() => {
		if (!editing) setDraft(serverValue);
	}, [serverValue, editing]);

	const dirty = draft !== serverValue;
	const busy = Boolean(loading) || saving;

	const startEditing = () => {
		if (!canEdit) return;
		setDraft(serverValue);
		setEditing(true);
	};

	const stopEditing = (reset: boolean) => {
		if (reset) setDraft(serverValue);
		setEditing(false);
	};

	const handleSave = async () => {
		setSaving(true);
		try {
			await onSave(draft);
			stopEditing(false);
		} catch {
			// Keep the draft and stay in edit mode; the caller surfaces the error.
		} finally {
			setSaving(false);
		}
	};

	if (!canRead) {
		return (
			<div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-card py-10 text-center">
				<EyeOff className="size-6 text-muted-foreground" />
				<p className="text-sm font-medium">Environment variables are hidden</p>
				<p className="max-w-sm text-sm text-muted-foreground">
					Viewing values requires the "secrets.read" capability. Editing is disabled so the stored
					variables cannot be overwritten blindly.
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-3">
			<CodeEditor
				value={draft}
				onChange={setDraft}
				protect={!editing}
				locked={!editing}
				onLockedChange={(nextLocked) => {
					if (!nextLocked) startEditing();
				}}
				readOnly={!editing}
				minHeight="16rem"
				placeholder={"KEY=value\nANOTHER_KEY=another value"}
				basicSetup={{
					lineNumbers: true,
					foldGutter: false,
				}}
				lockMessage={
					canEdit
						? "Locked to prevent accidental edits."
						: `Read-only — ${capabilityHint("secrets.write")}.`
				}
			/>
			<div className="flex items-center justify-between gap-3">
				<p className="text-xs text-muted-foreground">
					One <code className="font-mono">KEY=VALUE</code> pair per line. Lines starting with{" "}
					<code className="font-mono">#</code> are comments.
				</p>
				{editing && (
					<div className="flex items-center gap-2">
						<Button
							type="button"
							variant="secondary"
							size="sm"
							onClick={() => stopEditing(true)}
							disabled={busy}
						>
							<X className="size-3.5" />
							Cancel
						</Button>
						<Button
							onClick={() => void handleSave()}
							disabled={!dirty || busy || !canEdit}
							size="sm"
							title={canEdit ? undefined : capabilityHint("secrets.write")}
						>
							{busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
							Save
						</Button>
					</div>
				)}
			</div>
		</div>
	);
}
