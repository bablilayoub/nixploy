"use client";

import { Download, Eye, EyeOff, Loader2, Pencil, Save, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { capabilityHint } from "@/components/services/capability-hint";
import { UnsavedChangesPill } from "@/components/services/unsaved-changes-pill";
import { Button } from "@/components/ui/button";
import { CodeEditor } from "@/components/ui/code-editor";
import { DisabledHint } from "@/components/ui/disabled-hint";
import { type EnvEntry, mergeEnvText, parseEnvFile } from "@/lib/env-file";

const MASK = "••••••••";

/**
 * Read-only variables list shown while the editor is locked: keys in the
 * clear, values masked with a per-line reveal toggle so a screen share or
 * a glance over the shoulder does not leak every secret at once.
 */
function EnvRows({
	entries,
	onEdit,
	editHint,
}: {
	entries: EnvEntry[];
	/** Unlock the editor; undefined when the member cannot edit. */
	onEdit?: () => void;
	editHint?: string;
}) {
	const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
	const allRevealed = entries.length > 0 && entries.every((entry) => revealed.has(entry.key));

	const toggle = (key: string) =>
		setRevealed((current) => {
			const next = new Set(current);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});

	return (
		<div className="overflow-hidden rounded-lg border border-border bg-card">
			<div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
				<p className="text-xs text-muted-foreground">
					{entries.length} {entries.length === 1 ? "variable" : "variables"}
				</p>
				<div className="flex items-center gap-1">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() =>
							setRevealed(allRevealed ? new Set() : new Set(entries.map((entry) => entry.key)))
						}
					>
						{allRevealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
						{allRevealed ? "Hide all" : "Reveal all"}
					</Button>
					<DisabledHint hint={onEdit ? undefined : editHint}>
						<Button type="button" size="sm" onClick={onEdit} disabled={!onEdit}>
							<Pencil className="size-3.5" />
							Edit
						</Button>
					</DisabledHint>
				</div>
			</div>
			<ul className="max-h-96 divide-y divide-border overflow-auto">
				{entries.map((entry) => {
					const shown = revealed.has(entry.key);
					return (
						<li key={entry.key} className="flex items-center gap-3 px-3 py-1.5 font-mono text-xs">
							<span className="w-2/5 shrink-0 truncate text-foreground" title={entry.key}>
								{entry.key}
							</span>
							<span
								className="min-w-0 flex-1 truncate text-muted-foreground"
								title={shown ? entry.value : undefined}
							>
								{shown ? entry.value || <span className="italic">(empty)</span> : MASK}
							</span>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="size-6 shrink-0"
								aria-label={shown ? `Hide value of ${entry.key}` : `Reveal value of ${entry.key}`}
								aria-pressed={shown}
								onClick={() => toggle(entry.key)}
							>
								{shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
							</Button>
						</li>
					);
				})}
			</ul>
		</div>
	);
}

export function EnvEditor({
	value,
	onSave,
	loading,
	canRead = true,
	canEdit = true,
	downloadName = ".env",
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
	/** File name used by "Download .env". */
	downloadName?: string;
}) {
	const serverValue = value ?? "";
	const [draft, setDraft] = useState(serverValue);
	const [saving, setSaving] = useState(false);
	const [editing, setEditing] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!editing) setDraft(serverValue);
	}, [serverValue, editing]);

	const dirty = draft !== serverValue;
	const busy = Boolean(loading) || saving;
	// The masked list only guards existing content against accidental edits
	// (and shoulder surfing): an empty editor is editable right away. Members
	// without secrets.write always see the read-only list with its hint.
	const hasContent = serverValue.trim().length > 0;
	const unlocked = canEdit && (editing || !hasContent);

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

	const importFile = async (file: File) => {
		const text = await file.text();
		const entries = parseEnvFile(text);
		if (entries.length === 0) {
			toast.error("No KEY=VALUE lines found in that file");
			return;
		}
		// Merge into whatever the user is looking at; entering edit mode keeps
		// the existing dirty/unsaved wiring (Save / Cancel / pill) in charge.
		const base = editing ? draft : serverValue;
		setEditing(true);
		setDraft(mergeEnvText(base, entries));
		toast.success(
			`Imported ${entries.length} ${entries.length === 1 ? "variable" : "variables"} — review and save`,
		);
	};

	const download = () => {
		const text = unlocked ? draft : serverValue;
		const blob = new Blob([text.endsWith("\n") || text === "" ? text : `${text}\n`], {
			type: "text/plain",
		});
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = downloadName;
		// Firefox/Safari need the anchor in the document and abort the download
		// when the blob URL is revoked synchronously after click().
		document.body.appendChild(anchor);
		anchor.click();
		anchor.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
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
			<div className="flex flex-wrap items-center justify-end gap-2">
				<input
					ref={fileInputRef}
					type="file"
					accept=".env,text/plain"
					className="hidden"
					aria-label="Import .env file"
					onChange={(event) => {
						const file = event.target.files?.[0];
						event.target.value = "";
						if (file) void importFile(file);
					}}
				/>
				<DisabledHint hint={canEdit ? undefined : capabilityHint("secrets.write")}>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={!canEdit || busy}
						onClick={() => fileInputRef.current?.click()}
					>
						<Upload className="size-3.5" />
						Import .env
					</Button>
				</DisabledHint>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={!hasContent && !dirty}
					onClick={download}
				>
					<Download className="size-3.5" />
					Download .env
				</Button>
			</div>
			{unlocked ? (
				<CodeEditor
					value={draft}
					onChange={setDraft}
					protect={false}
					minHeight="16rem"
					placeholder={
						hasContent
							? "KEY=value\nANOTHER_KEY=another value"
							: "No variables yet — one KEY=VALUE per line"
					}
					basicSetup={{
						lineNumbers: true,
						foldGutter: false,
					}}
				/>
			) : (
				<EnvRows
					entries={parseEnvFile(serverValue)}
					onEdit={canEdit ? startEditing : undefined}
					editHint={`Read-only — ${capabilityHint("secrets.write")}.`}
				/>
			)}
			<div className="flex items-center justify-between gap-3">
				<p className="text-xs text-muted-foreground">
					One <code className="font-mono">KEY=VALUE</code> pair per line. Lines starting with{" "}
					<code className="font-mono">#</code> are comments.
				</p>
				{unlocked && (
					<div className="flex items-center gap-2">
						<UnsavedChangesPill dirty={dirty} />
						{(editing || dirty) && (
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
						)}
						<DisabledHint hint={canEdit ? undefined : capabilityHint("secrets.write")}>
							<Button
								onClick={() => void handleSave()}
								disabled={!dirty || busy || !canEdit}
								size="sm"
							>
								{busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
								Save
							</Button>
						</DisabledHint>
					</div>
				)}
			</div>
		</div>
	);
}
