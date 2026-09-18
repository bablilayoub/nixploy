"use client";

import { useQuery } from "@tanstack/react-query";
import { Fingerprint, Loader2, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { SettingsSection } from "@/components/layout/settings-section";
import { EmptyState } from "@/components/services/empty-state";
import { ConfirmDeleteDialog } from "@/components/settings/confirm-delete-dialog";
import { Button } from "@/components/ui/button";
import { DateTime } from "@/components/ui/date-time";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { authClient } from "@/lib/auth-client";
import { toastError } from "@/lib/describe-error";
import { useTRPC } from "@/lib/trpc";

/**
 * Passkeys for this account.
 *
 * A passkey replaces the password, not the second factor: the authenticator
 * verifies the user (biometric or PIN) and proves possession in one step. The
 * organization's require-2FA gate is unchanged by enrolling one — that gate is
 * about TOTP, and a passkey does not satisfy it.
 *
 * The card hides itself when the instance has no domain, because WebAuthn binds
 * every credential to one and there would be nothing to bind to.
 */

interface PasskeyRow {
	id: string;
	name?: string | null;
	createdAt?: string | Date | null;
	deviceType?: string | null;
	backedUp?: boolean | null;
}

export function PasskeysCard() {
	const trpc = useTRPC();
	const availability = useQuery(trpc.setup.authConfig.queryOptions());
	const available = availability.data?.passkeysAvailable ?? false;

	const [rows, setRows] = useState<PasskeyRow[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [name, setName] = useState("");
	const [isPending, setIsPending] = useState(false);

	const load = useCallback(async () => {
		setIsLoading(true);
		const { data, error } = await authClient.passkey.listUserPasskeys();
		if (error) {
			// A failed fetch must not read as "you have no passkeys".
			setLoadError(error.message ?? "Could not load your passkeys");
		} else {
			setLoadError(null);
			setRows((data ?? []) as PasskeyRow[]);
		}
		setIsLoading(false);
	}, []);

	useEffect(() => {
		if (available) void load();
		else setIsLoading(false);
	}, [available, load]);

	async function register() {
		setIsPending(true);
		try {
			const result = await authClient.passkey.addPasskey({ name: name.trim() || undefined });
			if (result?.error) {
				toastError(result.error, "Could not add the passkey");
				return;
			}
			toast.success("Passkey added");
			setDialogOpen(false);
			setName("");
			await load();
		} catch (error) {
			// Dismissing the system sheet throws NotAllowedError. That is the user
			// changing their mind, not something to show as a failure.
			if (error instanceof DOMException && error.name === "NotAllowedError") {
				setDialogOpen(false);
				return;
			}
			toastError(error, "Could not add the passkey");
		} finally {
			setIsPending(false);
		}
	}

	async function remove(row: PasskeyRow) {
		const { error } = await authClient.passkey.deletePasskey({ id: row.id });
		if (error) {
			toastError(error, "Could not remove the passkey");
			throw new Error(error.message ?? "Could not remove the passkey");
		}
		toast.success("Passkey removed");
		await load();
	}

	if (availability.isPending) {
		return (
			<SettingsSection
				title="Passkeys"
				description="Sign in with Touch ID, Windows Hello or a security key."
			>
				<Skeleton className="h-16 w-full" />
			</SettingsSection>
		);
	}

	if (!available) {
		return (
			<SettingsSection
				title="Passkeys"
				description="Sign in with Touch ID, Windows Hello or a security key."
			>
				<p className="text-sm text-muted-foreground">
					Passkeys need the panel to have a domain name. A credential is bound to a domain, and an
					instance reached by IP address has none to bind to — set the panel domain under Settings →
					Platform first.
				</p>
			</SettingsSection>
		);
	}

	return (
		<>
			<SettingsSection
				bare
				title="Passkeys"
				description="Sign in with Touch ID, Windows Hello or a security key instead of your password. A passkey does not replace two-factor authentication — the organization's requirement still applies."
				actions={
					<Button size="sm" onClick={() => setDialogOpen(true)}>
						<Plus className="size-4" />
						Add a passkey
					</Button>
				}
			>
				{isLoading ? (
					<Skeleton className="h-20 w-full" />
				) : loadError ? (
					<p className="text-sm text-destructive">{loadError}</p>
				) : rows.length === 0 ? (
					<EmptyState
						icon={Fingerprint}
						title="No passkeys yet"
						description="Add one and you can sign in on this device without typing a password."
					/>
				) : (
					<TableCard>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Name</TableHead>
									<TableHead>Added</TableHead>
									<TableHead>Synced</TableHead>
									<TableHead className="w-px" />
								</TableRow>
							</TableHeader>
							<TableBody>
								{rows.map((row) => (
									<TableRow key={row.id}>
										<TableCell className="text-sm font-medium">
											{row.name?.trim() || "Unnamed passkey"}
										</TableCell>
										<TableCell className="text-muted-foreground">
											{row.createdAt ? <DateTime value={row.createdAt} /> : "—"}
										</TableCell>
										<TableCell className="text-muted-foreground">
											{/* A multi-device credential lives in a cloud keychain and
											    survives losing the device it was made on. */}
											{row.backedUp ? "Yes" : "This device only"}
										</TableCell>
										<TableCell>
											<div className="flex justify-end">
												<ConfirmDeleteDialog
													title="Remove passkey"
													description="You will no longer be able to sign in with this device. Make sure you still know your password, or have another passkey."
													onConfirm={() => remove(row)}
												/>
											</div>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</TableCard>
				)}
			</SettingsSection>

			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Add a passkey</DialogTitle>
						<DialogDescription>
							Your browser will ask you to confirm with Touch ID, Windows Hello, a phone or a
							security key. Nothing secret leaves the device — the panel only stores a public key.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-2">
						<Label htmlFor="passkey-name">Name</Label>
						<Input
							id="passkey-name"
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder="MacBook Touch ID"
						/>
						<p className="text-xs text-muted-foreground">
							So you can tell it apart later. Optional.
						</p>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setDialogOpen(false)}>
							Cancel
						</Button>
						<Button disabled={isPending} onClick={() => void register()}>
							{isPending ? <Loader2 className="size-4 animate-spin" /> : null}
							Continue
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
