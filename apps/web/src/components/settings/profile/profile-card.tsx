"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { SettingsSection } from "@/components/settings/settings-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserAvatar } from "@/components/user-avatar";
import { authClient, useSession } from "@/lib/auth-client";
import {
	GRAVATAR_IMAGE_MARKER,
	isGravatarImage,
	PRESET_AVATARS,
	presetImageValue,
} from "@/lib/user-avatar";
import { cn } from "@/lib/utils";

export function ProfileCard() {
	const { data: session, refetch } = useSession();
	const user = session?.user;
	const [pending, setPending] = useState(false);
	const [name, setName] = useState(user?.name ?? "");

	useEffect(() => {
		setName(user?.name ?? "");
	}, [user?.name]);

	async function saveImage(image: string | null) {
		setPending(true);
		const { error } = await authClient.updateUser({ image });
		setPending(false);
		if (error) {
			toast.error(error.message ?? "Failed to update avatar");
			return;
		}
		await refetch?.();
		toast.success(image ? "Avatar updated" : "Avatar cleared");
	}

	async function saveName(event: React.FormEvent) {
		event.preventDefault();
		const trimmed = name.trim();
		if (!trimmed) {
			toast.error("Name is required");
			return;
		}
		setPending(true);
		const { error } = await authClient.updateUser({ name: trimmed });
		setPending(false);
		if (error) {
			toast.error(error.message ?? "Failed to update name");
			return;
		}
		await refetch?.();
		toast.success("Profile updated");
	}

	const currentImage = user?.image ?? null;
	const usingGravatar = isGravatarImage(currentImage);
	const usingInitials = !currentImage;

	return (
		<SettingsSection title="Profile" description="Your name and avatar.">
			<div className="flex flex-col gap-6">
				<div className="flex items-center gap-4">
					<UserAvatar
						user={user}
						className="size-14"
						fallbackClassName="text-lg font-semibold"
						size={112}
					/>
					<div className="grid gap-1">
						<p className="font-medium">{user?.name ?? "—"}</p>
						<p className="text-sm text-muted-foreground">{user?.email ?? "—"}</p>
					</div>
				</div>

				<form onSubmit={saveName} className="grid max-w-sm gap-3">
					<div className="grid gap-2">
						<Label htmlFor="profile-name">Display name</Label>
						<Input
							id="profile-name"
							value={name}
							onChange={(event) => setName(event.target.value)}
							disabled={pending}
							required
						/>
					</div>
					<div>
						<Button type="submit" size="sm" disabled={pending || name.trim() === user?.name}>
							{pending && <Loader2 className="size-4 animate-spin" />}
							Save name
						</Button>
					</div>
				</form>

				<div className="space-y-3">
					<div className="space-y-1">
						<p className="text-sm font-medium">Avatar</p>
						<p className="text-sm text-muted-foreground">
							Pick a preset, use Gravatar for your email, or fall back to initials.
						</p>
					</div>

					<div className="flex flex-wrap gap-2">
						{PRESET_AVATARS.map((preset) => {
							const selected = currentImage === presetImageValue(preset.id);
							return (
								<button
									key={preset.id}
									type="button"
									title={preset.label}
									disabled={pending}
									onClick={() => void saveImage(presetImageValue(preset.id))}
									className={cn(
										"size-10 overflow-hidden rounded-full border border-border transition-colors hover:border-foreground/40 disabled:opacity-50",
										selected && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
									)}
								>
									{/* biome-ignore lint/performance/noImgElement: inline data-URI presets */}
									<img src={preset.src} alt="" className="size-full object-cover" />
								</button>
							);
						})}
					</div>

					<div className="flex flex-wrap gap-2">
						<Button
							type="button"
							size="sm"
							variant={usingGravatar ? "secondary" : "outline"}
							disabled={pending || !user?.email}
							onClick={() => void saveImage(GRAVATAR_IMAGE_MARKER)}
						>
							{pending && usingGravatar ? <Loader2 className="size-4 animate-spin" /> : null}
							Use Gravatar
						</Button>
						<Button
							type="button"
							size="sm"
							variant={usingInitials ? "secondary" : "outline"}
							disabled={pending || usingInitials}
							onClick={() => void saveImage(null)}
						>
							Initials only
						</Button>
					</div>
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
