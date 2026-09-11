"use client";

import { Loader2, Pencil } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface EditProviderField {
	key: string;
	label: string;
	placeholder?: string;
	/** Password inputs start empty and are only sent when typed (token rotation). */
	secret?: boolean;
	/** Explanatory line under the input. */
	hint?: string;
}

/**
 * Generic "Edit provider" dialog for the four git-provider panels: text
 * fields are pre-filled from the row, secret fields start blank and are
 * only included in `onSubmit` when the user typed a replacement.
 */
export function EditProviderDialog({
	title,
	description,
	fields,
	initialValues,
	onSubmit,
	disabled,
	disabledReason,
}: {
	title: string;
	description?: string;
	fields: EditProviderField[];
	initialValues: Record<string, string>;
	/**
	 * Receives the trimmed values; secret fields are omitted when left blank.
	 * Return the mutation promise so the dialog stays open on failure.
	 */
	onSubmit: (values: Record<string, string>) => Promise<unknown>;
	disabled?: boolean;
	disabledReason?: string;
}) {
	const [open, setOpen] = useState(false);
	const [values, setValues] = useState<Record<string, string>>({});
	const [pending, setPending] = useState(false);

	useEffect(() => {
		if (!open) return;
		const seeded: Record<string, string> = {};
		for (const field of fields) {
			seeded[field.key] = field.secret ? "" : (initialValues[field.key] ?? "");
		}
		setValues(seeded);
	}, [open, fields, initialValues]);

	const submit = async () => {
		const payload: Record<string, string> = {};
		for (const field of fields) {
			const value = (values[field.key] ?? "").trim();
			if (field.secret && !value) continue;
			payload[field.key] = value;
		}
		setPending(true);
		try {
			await onSubmit(payload);
			setOpen(false);
		} catch {
			// The caller toasts; keep the dialog open for a retry.
		} finally {
			setPending(false);
		}
	};

	return (
		<>
			<Button
				variant="ghost"
				size="icon"
				title={disabled ? disabledReason : "Edit provider"}
				disabled={disabled}
				onClick={() => setOpen(true)}
			>
				<Pencil className="size-4" />
				<span className="sr-only">Edit provider</span>
			</Button>
			<Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{title}</DialogTitle>
						{description ? <DialogDescription>{description}</DialogDescription> : null}
					</DialogHeader>
					<form
						className="grid gap-4"
						onSubmit={(event) => {
							event.preventDefault();
							void submit();
						}}
					>
						{fields.map((field) => {
							const id = `edit-provider-${field.key}`;
							return (
								<div key={field.key} className="grid gap-2">
									<Label htmlFor={id}>{field.label}</Label>
									<Input
										id={id}
										type={field.secret ? "password" : "text"}
										placeholder={
											field.secret
												? "Leave blank to keep the current value"
												: (field.placeholder ?? "")
										}
										autoComplete={field.secret ? "new-password" : "off"}
										value={values[field.key] ?? ""}
										onChange={(event) =>
											setValues((current) => ({ ...current, [field.key]: event.target.value }))
										}
									/>
									{field.hint ? (
										<p className="text-xs text-muted-foreground">{field.hint}</p>
									) : null}
								</div>
							);
						})}
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								disabled={pending}
								onClick={() => setOpen(false)}
							>
								Cancel
							</Button>
							<Button type="submit" disabled={pending || !(values.name ?? "").trim()}>
								{pending && <Loader2 className="size-4 animate-spin" />}
								Save changes
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</>
	);
}
