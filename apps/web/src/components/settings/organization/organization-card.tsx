"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { SettingsSection } from "@/components/layout/settings-section";
import { useSaveBar } from "@/components/services/save-bar";
import { UnsavedChangesPill } from "@/components/services/unsaved-changes-pill";
import { Button } from "@/components/ui/button";
import { DisabledHint } from "@/components/ui/disabled-hint";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useDraft } from "@/hooks/use-draft";
import { useMounted } from "@/hooks/use-mounted";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { authClient } from "@/lib/auth-client";
import { isOrgAdminRole, missingCapabilityHint } from "@/lib/capabilities";
import { toastError } from "@/lib/describe-error";
import { useTRPC } from "@/lib/trpc";

export function OrganizationCard() {
	const trpc = useTRPC();
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
	const mounted = useMounted();

	// Both drafts stay blank until mount for the same reason: seeding them from
	// an already-resolved store/query on the first client render would not match
	// the server-rendered HTML.
	const nameDraft = useDraft(mounted ? (activeOrganization?.name ?? "") : "");
	const name = nameDraft.value;
	const settings = mounted ? settingsQuery.data : undefined;
	const brandingDraft = useDraft({
		displayName: settings?.branding.displayName ?? "",
		logoUrl: settings?.logo ?? "",
		accentColor: settings?.branding.accentColor ?? "#1c1917",
	});
	const { displayName, logoUrl, accentColor } = brandingDraft.value;
	const [isNamePending, setIsNamePending] = useState(false);

	const saveBranding = useSaveMutation(trpc.organization.updateSettings.mutationOptions(), {
		successMessage: "Branding updated",
		invalidate: [trpc.organization.settings.queryKey()],
		onSuccess: brandingDraft.markSaved,
	});

	async function saveName() {
		if (!activeOrganization) return;
		setIsNamePending(true);
		const { error } = await authClient.organization.update({
			organizationId: activeOrganization.id,
			data: { name },
		});
		setIsNamePending(false);
		if (error) {
			toastError(error, "Failed to update organization");
			return;
		}
		toast.success("Organization updated");
		nameDraft.markSaved();
	}

	function onNameSubmit(event: React.FormEvent) {
		event.preventDefault();
		void saveName();
	}

	function onSaveBranding() {
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

	function onBrandingSubmit(event: React.FormEvent) {
		event.preventDefault();
		onSaveBranding();
	}

	// Never let the form submit values seeded from a failed load — saving
	// would overwrite the real branding with blanks. `mounted` keeps the
	// server-rendered `disabled` attributes in step with the first client
	// paint when the layout already resolved the settings query.
	const brandingReady = mounted && settingsQuery.isSuccess;
	const brandingDisabled = !brandingReady || !canBrand;
	const nameSaveDisabled = !canRename || !name || name === activeOrganization?.name;

	useSaveBar(nameDraft, {
		onSave: () => void saveName(),
		pending: isNamePending,
		disabled: nameSaveDisabled,
	});
	useSaveBar(brandingDraft, {
		onSave: onSaveBranding,
		pending: saveBranding.isPending,
		disabled: brandingDisabled,
	});

	return (
		<>
			{/* Named for what it holds; the page is already titled "Organization". */}
			<SettingsSection title="Name" description="How this organization is addressed and routed.">
				<form onSubmit={onNameSubmit} className="grid gap-4">
					<div className="grid gap-2">
						<Label htmlFor="org-name">Name</Label>
						<Input
							id="org-name"
							required
							disabled={isOrgPending || !activeOrganization || !canRename}
							title={renameHint}
							value={name}
							onChange={(e) => nameDraft.set(e.target.value)}
						/>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="org-slug">Slug</Label>
						<Input id="org-slug" disabled value={activeOrganization?.slug ?? ""} />
						<p className="text-xs text-muted-foreground">
							Set when the organization was created and fixed afterwards — invitation links and API
							references use it.
						</p>
					</div>
					<div className="flex items-center gap-3">
						<DisabledHint hint={renameHint}>
							<Button type="submit" disabled={nameSaveDisabled || isNamePending}>
								{isNamePending && <Loader2 className="size-4 animate-spin" />}
								Save name
							</Button>
						</DisabledHint>
						<UnsavedChangesPill dirty={nameDraft.dirty} />
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
							onChange={(e) => brandingDraft.patch({ displayName: e.target.value })}
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
							onChange={(e) => brandingDraft.patch({ logoUrl: e.target.value })}
						/>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="org-accent">Accent color</Label>
						<p className="text-sm text-muted-foreground">
							Used for primary buttons and the active tab underline. The rest of the panel stays
							monochrome on purpose; text colour on the accent is picked automatically for contrast.
						</p>
						<div className="flex items-center gap-2">
							<Input
								id="org-accent"
								type="color"
								className="h-9 w-14 shrink-0 p-1"
								disabled={brandingDisabled}
								title={brandHint}
								value={accentColor}
								onChange={(e) => brandingDraft.patch({ accentColor: e.target.value })}
							/>
							<Input
								value={accentColor}
								onChange={(e) => brandingDraft.patch({ accentColor: e.target.value })}
								placeholder="#1c1917"
								disabled={brandingDisabled}
								title={brandHint}
							/>
						</div>
					</div>
					<div className="flex items-center gap-3">
						<DisabledHint hint={brandHint}>
							<Button type="submit" disabled={brandingDisabled || saveBranding.isPending}>
								{saveBranding.isPending && <Loader2 className="size-4 animate-spin" />}
								Save branding
							</Button>
						</DisabledHint>
						<UnsavedChangesPill dirty={brandingDraft.dirty} />
					</div>
				</form>
			</SettingsSection>
		</>
	);
}
