"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { SettingsSection } from "@/components/layout/settings-section";
import { useSaveBar } from "@/components/services/save-bar";
import { SESSIONS_QUERY_KEY } from "@/components/settings/profile/sessions-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserAvatar } from "@/components/user-avatar";
import { useDraft } from "@/hooks/use-draft";
import { useMounted } from "@/hooks/use-mounted";
import { authClient, useSession } from "@/lib/auth-client";
import { toastError } from "@/lib/describe-error";
import {
	GRAVATAR_IMAGE_MARKER,
	isGravatarImage,
	PRESET_AVATARS,
	presetImageValue,
} from "@/lib/user-avatar";
import { cn } from "@/lib/utils";

export function ProfileCard() {
	const { data: session, refetch } = useSession();
	// The session store can already be populated when React hydrates while
	// the server rendered without one — initials, name and email would then
	// differ between the two and React re-renders the whole tree. Use the
	// session only after mount so both paints agree.
	const mounted = useMounted();
	const user = mounted ? session?.user : undefined;
	const [pending, setPending] = useState(false);
	const nameDraft = useDraft(user?.name ?? "");
	const name = nameDraft.value;

	async function saveImage(image: string | null) {
		setPending(true);
		const { error } = await authClient.updateUser({ image });
		setPending(false);
		if (error) {
			toastError(error, "Failed to update avatar");
			return;
		}
		await refetch?.();
		toast.success(image ? "Avatar updated" : "Avatar cleared");
	}

	async function saveName() {
		const trimmed = name.trim();
		if (!trimmed) {
			toast.error("Name is required");
			return;
		}
		setPending(true);
		const { error } = await authClient.updateUser({ name: trimmed });
		setPending(false);
		if (error) {
			toastError(error, "Failed to update name");
			return;
		}
		await refetch?.();
		toast.success("Profile updated");
		nameDraft.markSaved();
	}

	function onNameSubmit(event: React.FormEvent) {
		event.preventDefault();
		void saveName();
	}

	const currentImage = user?.image ?? null;
	const usingGravatar = isGravatarImage(currentImage);
	const usingInitials = !currentImage;
	const nameUnchanged = name.trim() === user?.name;

	useSaveBar(nameDraft, {
		onSave: () => void saveName(),
		pending,
		disabled: nameUnchanged,
	});

	// The page is already titled "Profile"; the card names what it holds.
	return (
		<SettingsSection title="Name and avatar">
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

				<form onSubmit={onNameSubmit} className="grid max-w-sm gap-3">
					<div className="grid gap-2">
						<Label htmlFor="profile-name">Display name</Label>
						<Input
							id="profile-name"
							value={name}
							onChange={(event) => nameDraft.set(event.target.value)}
							disabled={pending}
							required
						/>
					</div>
					<div>
						<Button type="submit" size="sm" disabled={pending || nameUnchanged}>
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
	const queryClient = useQueryClient();
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
			toastError(error, "Failed to change password");
			return;
		}
		toast.success("Password updated");
		setCurrentPassword("");
		setNewPassword("");
		setConfirmPassword("");
		// `revokeOtherSessions` just signed every other device out — refresh the
		// Active sessions card on this page so it stops listing them.
		await queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
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
