"use client";

import { Loader2, Save, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { CodeEditor } from "@/components/ui/code-editor";

export function EnvEditor({
	value,
	onSave,
	loading,
}: {
	value: string;
	onSave: (value: string) => void | Promise<void>;
	loading?: boolean;
}) {
	const [draft, setDraft] = useState(value);
	const [saving, setSaving] = useState(false);
	const [editing, setEditing] = useState(false);

	useEffect(() => {
		if (!editing) setDraft(value);
	}, [value, editing]);

	const dirty = draft !== value;
	const busy = Boolean(loading) || saving;

	const startEditing = () => {
		setDraft(value);
		setEditing(true);
	};

	const stopEditing = (reset: boolean) => {
		if (reset) setDraft(value);
		setEditing(false);
	};

	const handleSave = async () => {
		setSaving(true);
		try {
			await onSave(draft);
			stopEditing(false);
		} finally {
			setSaving(false);
		}
	};

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
				lockMessage="Locked to prevent accidental edits."
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
						<Button onClick={handleSave} disabled={!dirty || busy} size="sm">
							{busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
							Save
						</Button>
					</div>
				)}
			</div>
		</div>
	);
}
