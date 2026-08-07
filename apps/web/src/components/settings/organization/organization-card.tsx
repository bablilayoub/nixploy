"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { SettingsSection } from "@/components/settings/settings-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { useTRPC } from "@/lib/trpc";

export function OrganizationCard() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const { data: activeOrganization, isPending: isOrgPending } = authClient.useActiveOrganization();
	const settingsQuery = useQuery(trpc.organization.settings.queryOptions());

	const [name, setName] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [logoUrl, setLogoUrl] = useState("");
	const [accentColor, setAccentColor] = useState("#1c1917");
	const [isNamePending, setIsNamePending] = useState(false);

	useEffect(() => {
		if (activeOrganization?.name) {
			setName(activeOrganization.name);
		}
	}, [activeOrganization?.name]);

	useEffect(() => {
		if (!settingsQuery.data) return;
		setDisplayName(settingsQuery.data.branding.displayName ?? "");
		setLogoUrl(settingsQuery.data.logo ?? "");
		setAccentColor(settingsQuery.data.branding.accentColor ?? "#1c1917");
	}, [settingsQuery.data]);

	const saveBranding = useMutation({
		...trpc.organization.updateSettings.mutationOptions(),
		onSuccess: async () => {
			toast.success("Branding updated");
			await queryClient.invalidateQueries({ queryKey: trpc.organization.settings.queryKey() });
		},
		onError: (error) => toast.error(error.message),
	});

	async function onNameSubmit(event: React.FormEvent) {
		event.preventDefault();
		if (!activeOrganization) return;
		setIsNamePending(true);
		const { error } = await authClient.organization.update({
			organizationId: activeOrganization.id,
			data: { name },
		});
		setIsNamePending(false);
		if (error) {
			toast.error(error.message ?? "Failed to update organization");
			return;
		}
		toast.success("Organization updated");
	}

	function onBrandingSubmit(event: React.FormEvent) {
		event.preventDefault();
		const accent =
			accentColor.trim() && /^#[0-9A-Fa-f]{6}$/.test(accentColor.trim())
				? accentColor.trim()
				: null;
		saveBranding.mutate({
			logo: logoUrl.trim() || null,
			branding: {
				displayName: displayName.trim() || null,
				accentColor: accent,
			},
		});
	}

	return (
		<>
			<SettingsSection
				title="Organization"
				description="General settings for your active organization."
			>
				<form onSubmit={onNameSubmit} className="grid gap-4">
					<div className="grid gap-2">
						<Label htmlFor="org-name">Name</Label>
						<Input
							id="org-name"
							required
							disabled={isOrgPending || !activeOrganization}
							value={name}
							onChange={(e) => setName(e.target.value)}
						/>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="org-slug">Slug</Label>
						<Input id="org-slug" disabled value={activeOrganization?.slug ?? ""} />
					</div>
					<div>
						<Button
							type="submit"
							disabled={isNamePending || !name || name === activeOrganization?.name}
						>
							{isNamePending && <Loader2 className="size-4 animate-spin" />}
							Save name
						</Button>
					</div>
				</form>
			</SettingsSection>

			<SettingsSection
				title="White-label branding"
				description="Customize how your organization appears in the shell."
			>
				<form onSubmit={onBrandingSubmit} className="grid gap-4">
					<div className="grid gap-2">
						<Label htmlFor="org-display-name">Display name</Label>
						<Input
							id="org-display-name"
							placeholder={activeOrganization?.name ?? "Shown in the shell"}
							disabled={settingsQuery.isPending}
							value={displayName}
							onChange={(e) => setDisplayName(e.target.value)}
						/>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="org-logo">Logo URL</Label>
						<Input
							id="org-logo"
							type="url"
							placeholder="https://…"
							disabled={settingsQuery.isPending}
							value={logoUrl}
							onChange={(e) => setLogoUrl(e.target.value)}
						/>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="org-accent">Accent color</Label>
						<div className="flex items-center gap-2">
							<Input
								id="org-accent"
								type="color"
								className="h-9 w-14 shrink-0 p-1"
								disabled={settingsQuery.isPending}
								value={accentColor}
								onChange={(e) => setAccentColor(e.target.value)}
							/>
							<Input
								value={accentColor}
								onChange={(e) => setAccentColor(e.target.value)}
								placeholder="#1c1917"
								disabled={settingsQuery.isPending}
							/>
						</div>
					</div>
					<div>
						<Button type="submit" disabled={saveBranding.isPending || settingsQuery.isPending}>
							{saveBranding.isPending && <Loader2 className="size-4 animate-spin" />}
							Save branding
						</Button>
					</div>
				</form>
			</SettingsSection>
		</>
	);
}
