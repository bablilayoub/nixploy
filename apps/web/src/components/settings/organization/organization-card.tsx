"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { SettingsSection } from "@/components/settings/settings-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCapabilities } from "@/hooks/use-capabilities";
import { authClient } from "@/lib/auth-client";
import { isOrgAdminRole, missingCapabilityHint } from "@/lib/capabilities";
import { useTRPC } from "@/lib/trpc";

export function OrganizationCard() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const { data: activeOrganization, isPending: isOrgPending } = authClient.useActiveOrganization();
	const settingsQuery = useQuery(trpc.organization.settings.queryOptions());
	const { can, role } = useCapabilities();
	// Renaming goes through better-auth's org plugin (owner/admin); branding
	// through organization.updateSettings (`settings.manage`).
	const canRename = isOrgAdminRole(role);
	const renameHint = canRename ? undefined : "Only organization owners and admins can rename it";
	const canBrand = can("settings.manage");
	const brandHint = canBrand ? undefined : missingCapabilityHint("settings.manage");

	// better-auth's org store can already be populated when React hydrates, so
	// anything derived from `activeOrganization` in the markup (the placeholder
	// below) must wait for mount to match the server-rendered HTML.
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);

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

	// Never let the form submit values seeded from a failed load — saving
	// would overwrite the real branding with blanks. `mounted` keeps the
	// server-rendered `disabled` attributes in step with the first client
	// paint when the layout already resolved the settings query.
	const brandingReady = mounted && settingsQuery.isSuccess;
	const brandingDisabled = !brandingReady || !canBrand;

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
							disabled={isOrgPending || !activeOrganization || !canRename}
							title={renameHint}
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
							title={renameHint}
							disabled={!canRename || isNamePending || !name || name === activeOrganization?.name}
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
				{mounted && settingsQuery.isError && (
					<div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
						<span className="text-destructive">
							Could not load branding: {settingsQuery.error.message || "try again"}
						</span>
						<Button variant="outline" size="sm" onClick={() => void settingsQuery.refetch()}>
							Retry
						</Button>
					</div>
				)}
				<form onSubmit={onBrandingSubmit} className="grid gap-4">
					<div className="grid gap-2">
						<Label htmlFor="org-display-name">Display name</Label>
						<Input
							id="org-display-name"
							placeholder={(mounted && activeOrganization?.name) || "Shown in the shell"}
							disabled={brandingDisabled}
							title={brandHint}
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
							disabled={brandingDisabled}
							title={brandHint}
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
								disabled={brandingDisabled}
								title={brandHint}
								value={accentColor}
								onChange={(e) => setAccentColor(e.target.value)}
							/>
							<Input
								value={accentColor}
								onChange={(e) => setAccentColor(e.target.value)}
								placeholder="#1c1917"
								disabled={brandingDisabled}
								title={brandHint}
							/>
						</div>
					</div>
					<div>
						<Button
							type="submit"
							title={brandHint}
							disabled={brandingDisabled || saveBranding.isPending}
						>
							{saveBranding.isPending && <Loader2 className="size-4 animate-spin" />}
							Save branding
						</Button>
					</div>
				</form>
			</SettingsSection>
		</>
	);
}
