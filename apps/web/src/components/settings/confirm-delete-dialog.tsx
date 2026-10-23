"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

interface ConfirmDeleteDialogProps {
	title: string;
	description: string;
	/**
	 * Runs the deletion. Return the mutation promise (`mutateAsync`) and the
	 * dialog stays open with a spinner until it settles, closing only on
	 * success — a rejected promise keeps it open so the user can retry.
	 */
	onConfirm: () => unknown;
	/** Extra pending flag from the caller (legacy); the dialog tracks its own. */
	isPending?: boolean;
	/** Disable the trigger, e.g. when the caller lacks the capability. */
	disabled?: boolean;
	/** Native tooltip explaining why the trigger is disabled. */
	disabledReason?: string;
}

export function ConfirmDeleteDialog({
	title,
	description,
	onConfirm,
	isPending,
	disabled,
	disabledReason,
}: ConfirmDeleteDialogProps) {
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const mountedRef = useRef(true);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	const pending = busy || Boolean(isPending);

	const confirm = async () => {
		setBusy(true);
		try {
			await onConfirm();
			if (mountedRef.current) setOpen(false);
		} catch {
			// The caller's mutation already toasts the error; keep the dialog open.
		} finally {
			if (mountedRef.current) setBusy(false);
		}
	};

	return (
		<AlertDialog
			open={open}
			onOpenChange={(next) => {
				// Ignore outside clicks / escape while the deletion is in flight.
				if (!next && pending) return;
				setOpen(next);
			}}
		>
			<AlertDialogTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					disabled={disabled}
					title={disabled ? disabledReason : undefined}
				>
					<Trash2 className="size-4 text-destructive" />
					<span className="sr-only">Delete</span>
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					<AlertDialogDescription>{description}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
					<Button variant="destructive" disabled={pending} onClick={() => void confirm()}>
						{pending && <Loader2 className="size-4 animate-spin" />}
						Delete
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
