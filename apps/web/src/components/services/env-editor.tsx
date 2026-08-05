"use client";

import CodeMirror from "@uiw/react-codemirror";
import { Loader2, Save } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

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

	// Re-sync when the server value changes (e.g. after refetch).
	useEffect(() => {
		setDraft(value);
	}, [value]);

	const dirty = draft !== value;
	const busy = Boolean(loading) || saving;

	const handleSave = async () => {
		setSaving(true);
		try {
			await onSave(draft);
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="space-y-3">
			<div className="overflow-hidden rounded-lg border border-border [&_.cm-editor]:bg-transparent [&_.cm-editor]:text-[13px] [&_.cm-gutters]:bg-transparent [&_.cm-gutters]:border-r-border">
				<CodeMirror
					value={draft}
					onChange={setDraft}
					theme="dark"
					minHeight="16rem"
					placeholder={"KEY=value\nANOTHER_KEY=another value"}
					basicSetup={{
						lineNumbers: true,
						foldGutter: false,
						highlightActiveLine: true,
					}}
				/>
			</div>
			<div className="flex items-center justify-between gap-3">
				<p className="text-xs text-muted-foreground">
					One <code className="font-mono">KEY=VALUE</code> pair per line. Lines starting with{" "}
					<code className="font-mono">#</code> are comments.
				</p>
				<Button onClick={handleSave} disabled={!dirty || busy} size="sm">
					{busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
					Save
				</Button>
			</div>
		</div>
	);
}
