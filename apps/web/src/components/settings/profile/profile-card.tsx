"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { SettingsSection } from "@/components/settings/settings-section";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient, useSession } from "@/lib/auth-client";

export function ProfileCard() {
	const { data: session } = useSession();
	const user = session?.user;

	return (
		<SettingsSection title="Profile" description="Your account information.">
			<div className="flex items-center gap-4">
				<Avatar className="size-12">
					<AvatarFallback className="text-lg font-semibold">
						{user?.name?.charAt(0)?.toUpperCase() ?? "?"}
					</AvatarFallback>
				</Avatar>
				<div className="grid gap-1">
					<p className="font-medium">{user?.name ?? "—"}</p>
					<p className="text-sm text-muted-foreground">{user?.email ?? "—"}</p>
				</div>
			</div>
		</SettingsSection>
	);
}

export function ChangePasswordCard() {
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [isPending, setIsPending] = useState(false);

	async function onSubmit(event: React.FormEvent) {
		event.preventDefault();
		if (newPassword !== confirmPassword) {
			toast.error("New passwords do not match");
			return;
		}
		setIsPending(true);
		const { error } = await authClient.changePassword({
			currentPassword,
			newPassword,
			revokeOtherSessions: true,
		});
		setIsPending(false);
		if (error) {
			toast.error(error.message ?? "Failed to change password");
			return;
		}
		toast.success("Password updated");
		setCurrentPassword("");
		setNewPassword("");
		setConfirmPassword("");
	}

	return (
		<SettingsSection
			title="Change password"
			description="Update your password. Other sessions will be signed out."
		>
			<form onSubmit={onSubmit} className="grid max-w-sm gap-4">
				<div className="grid gap-2">
					<Label htmlFor="current-password">Current password</Label>
					<Input
						id="current-password"
						type="password"
						required
						value={currentPassword}
						onChange={(e) => setCurrentPassword(e.target.value)}
					/>
				</div>
				<div className="grid gap-2">
					<Label htmlFor="new-password">New password</Label>
					<Input
						id="new-password"
						type="password"
						required
						minLength={8}
						value={newPassword}
						onChange={(e) => setNewPassword(e.target.value)}
					/>
				</div>
				<div className="grid gap-2">
					<Label htmlFor="confirm-password">Confirm new password</Label>
					<Input
						id="confirm-password"
						type="password"
						required
						minLength={8}
						value={confirmPassword}
						onChange={(e) => setConfirmPassword(e.target.value)}
					/>
				</div>
				<div>
					<Button type="submit" disabled={isPending}>
						{isPending && <Loader2 className="size-4 animate-spin" />}
						Update password
					</Button>
				</div>
			</form>
		</SettingsSection>
	);
}
