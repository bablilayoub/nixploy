"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { SettingsSection } from "@/components/settings/settings-section";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function DangerZone({
	title,
	description,
	actionLabel,
	onConfirm,
	requireText,
}: {
	title: string;
	description: string;
	actionLabel: string;
	onConfirm: () => void | Promise<void>;
	/** When set, the user must type this exact text to enable the action. */
	requireText?: string;
}) {
	const [open, setOpen] = useState(false);
	const [confirmation, setConfirmation] = useState("");
	const [pending, setPending] = useState(false);

	const confirmed = !requireText || confirmation === requireText;

	const handleConfirm = async () => {
		setPending(true);
		try {
			await onConfirm();
			setOpen(false);
			setConfirmation("");
		} finally {
			setPending(false);
		}
	};

	return (
		<SettingsSection
			danger
			title={title}
			description={description}
			actions={
				<AlertDialog
					open={open}
					onOpenChange={(next) => {
						setOpen(next);
						if (!next) setConfirmation("");
					}}
				>
					<AlertDialogTrigger asChild>
						<Button
							variant="outline"
							size="sm"
							className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
						>
							{actionLabel}
						</Button>
					</AlertDialogTrigger>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>{title}</AlertDialogTitle>
							<AlertDialogDescription>{description}</AlertDialogDescription>
						</AlertDialogHeader>
						{requireText ? (
							<div className="space-y-1.5">
								<Label htmlFor="danger-zone-confirm">
									Type <span className="font-mono font-semibold">{requireText}</span> to confirm
								</Label>
								<Input
									id="danger-zone-confirm"
									value={confirmation}
									onChange={(event) => setConfirmation(event.target.value)}
									placeholder={requireText}
									autoComplete="off"
								/>
							</div>
						) : null}
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction
								variant="destructive"
								disabled={!confirmed || pending}
								onClick={(event) => {
									event.preventDefault();
									void handleConfirm();
								}}
							>
								{pending && <Loader2 className="size-4 animate-spin" />}
								{actionLabel}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			}
		/>
	);
}
