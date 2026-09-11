"use client";

import { KeyRound, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { CopyButton } from "@/components/services/copy-button";
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
import { toastError } from "@/lib/describe-error";

/**
 * "Reveal webhook secret" for providers whose secret is derived server-side
 * (Bitbucket, Gitea). Same one-time-reveal pattern as API keys: the secret is
 * fetched when the dialog opens, shown once with a copy button, and dropped
 * from memory when the dialog closes.
 */
export function WebhookSecretDialog({
	providerLabel,
	webhookUrl,
	fetchSecret,
	instructions,
	disabled,
	disabledReason,
}: {
	providerLabel: string;
	/** Delivery URL to paste into the provider's webhook settings. */
	webhookUrl: string;
	fetchSecret: () => Promise<string>;
	/** Where the secret goes on the provider side. */
	instructions: string;
	disabled?: boolean;
	disabledReason?: string;
}) {
	const [open, setOpen] = useState(false);
	const [secret, setSecret] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (!open) {
			setSecret(null);
			return;
		}
		let cancelled = false;
		setLoading(true);
		fetchSecret()
			.then((value) => {
				if (!cancelled) setSecret(value);
			})
			.catch((error: unknown) => {
				toastError(error, "Could not reveal the secret");
				if (!cancelled) setOpen(false);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [open, fetchSecret]);

	return (
		<>
			<Button
				variant="ghost"
				size="icon"
				title={disabled ? disabledReason : "Reveal webhook secret"}
				disabled={disabled}
				onClick={() => setOpen(true)}
			>
				<KeyRound className="size-4" />
				<span className="sr-only">Reveal webhook secret</span>
			</Button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{providerLabel} webhook</DialogTitle>
						<DialogDescription>
							{instructions} The secret is shown only while this dialog is open — copy it now.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4">
						<div className="grid gap-2">
							<Label htmlFor="webhook-url">Payload URL</Label>
							<div className="flex items-center gap-2">
								<Input id="webhook-url" readOnly value={webhookUrl} className="font-mono text-xs" />
								<CopyButton value={webhookUrl} label="Copy payload URL" />
							</div>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="webhook-secret">Secret</Label>
							{loading || secret === null ? (
								<div className="flex h-9 items-center gap-2 text-sm text-muted-foreground">
									<Loader2 className="size-4 animate-spin" /> Revealing…
								</div>
							) : (
								<div className="flex items-center gap-2">
									<Input
										id="webhook-secret"
										readOnly
										value={secret}
										className="font-mono text-xs"
										onFocus={(event) => event.currentTarget.select()}
									/>
									<CopyButton value={secret} label="Copy webhook secret" />
								</div>
							)}
						</div>
					</div>
					<DialogFooter>
						<Button type="button" variant="secondary" onClick={() => setOpen(false)}>
							Done
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
