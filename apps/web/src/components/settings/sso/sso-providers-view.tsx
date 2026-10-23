"use client";

import type { SsoPreset } from "@nixploy/server/modules/auth/sso-presets";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, Pencil, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { SettingsSection } from "@/components/layout/settings-section";
import { LoadError } from "@/components/query-state";
import { CopyButton } from "@/components/services/copy-button";
import { EmptyState } from "@/components/services/empty-state";
import { ConfirmDeleteDialog } from "@/components/settings/confirm-delete-dialog";
import { Badge } from "@/components/ui/badge";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toastError } from "@/lib/describe-error";
import { useTRPC } from "@/lib/trpc";

/**
 * Identity providers, instance-wide.
 *
 * SSO used to be four environment variables: changing an IdP meant editing a
 * unit file and restarting, and there could only ever be one. This is the same
 * configuration as rows, plus the two things env vars could never express —
 * which organization a new user lands in, and which IdP group maps to which
 * role.
 */

const DESCRIPTION =
	"Identity providers for this whole instance. They appear on the login page for everyone, so only instance admins can change them.";

type ProviderRow = {
	ssoProviderId: string;
	providerId: string;
	preset: string;
	name: string;
	issuer: string | null;
	authorizationUrl: string | null;
	tokenUrl: string | null;
	userInfoUrl: string | null;
	clientId: string;
	scopes: string[];
	allowedEmailDomains: string[];
	defaultOrganizationId: string | null;
	defaultRole: string;
	groupClaim: string | null;
	groupMappings: Record<string, string>;
	syncRoleOnLogin: boolean;
	enabled: boolean;
};

const ROLES = ["viewer", "member", "deployer", "admin", "owner"] as const;

interface FormState {
	providerId: string;
	preset: SsoPreset;
	name: string;
	issuer: string;
	authorizationUrl: string;
	tokenUrl: string;
	userInfoUrl: string;
	clientId: string;
	clientSecret: string;
	scopes: string;
	allowedEmailDomains: string;
	defaultOrganizationId: string;
	defaultRole: string;
	groupClaim: string;
	groupMappings: string;
	syncRoleOnLogin: boolean;
	enabled: boolean;
}

const EMPTY_FORM: FormState = {
	providerId: "",
	preset: "custom",
	name: "",
	issuer: "",
	authorizationUrl: "",
	tokenUrl: "",
	userInfoUrl: "",
	clientId: "",
	clientSecret: "",
	scopes: "openid, profile, email",
	allowedEmailDomains: "",
	defaultOrganizationId: "",
	defaultRole: "member",
	groupClaim: "",
	groupMappings: "",
	syncRoleOnLogin: false,
	enabled: true,
};

const splitList = (value: string): string[] =>
	value
		.split(/[,\n]/)
		.map((entry) => entry.trim())
		.filter(Boolean);

/**
 * `group = role` per line, which is the shape an operator can paste from their
 * IdP's group list. A line without `=` is ignored rather than rejected: the
 * form should not refuse to save because somebody left a note in the box.
 */
function parseGroupMappings(value: string): Record<string, string> {
	const mappings: Record<string, string> = {};
	for (const line of value.split("\n")) {
		const index = line.indexOf("=");
		if (index <= 0) continue;
		const group = line.slice(0, index).trim();
		const role = line.slice(index + 1).trim();
		if (group && (ROLES as readonly string[]).includes(role)) mappings[group] = role;
	}
	return mappings;
}

const formatGroupMappings = (mappings: Record<string, string>): string =>
	Object.entries(mappings)
		.map(([group, role]) => `${group} = ${role}`)
		.join("\n");

export function SsoProvidersView() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const providersQuery = useQuery(trpc.sso.all.queryOptions());
	const presetsQuery = useQuery(trpc.sso.presets.queryOptions());
	const organizationsQuery = useQuery(trpc.organization.list.queryOptions());

	const [editing, setEditing] = useState<ProviderRow | null>(null);
	const [creating, setCreating] = useState(false);
	const [form, setForm] = useState<FormState>(EMPTY_FORM);

	const presets = presetsQuery.data ?? [];
	const presetInfo = useMemo(
		() => presets.find((entry) => entry.preset === form.preset),
		[presets, form.preset],
	);

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: trpc.sso.all.queryKey() });
	};

	const create = useMutation(
		trpc.sso.create.mutationOptions({
			onSuccess: () => {
				toast.success("Identity provider added");
				setCreating(false);
				invalidate();
			},
			onError: (error) => toastError(error, "Could not add the provider"),
		}),
	);
	const update = useMutation(
		trpc.sso.update.mutationOptions({
			onSuccess: () => {
				toast.success("Identity provider updated");
				setEditing(null);
				invalidate();
			},
			onError: (error) => toastError(error, "Could not update the provider"),
		}),
	);
	const remove = useMutation(
		trpc.sso.delete.mutationOptions({
			onSuccess: () => {
				toast.success("Identity provider removed");
				invalidate();
			},
			onError: (error) => toastError(error, "Could not remove the provider"),
		}),
	);

	const openCreate = () => {
		setForm(EMPTY_FORM);
		setCreating(true);
	};

	const openEdit = (row: ProviderRow) => {
		setForm({
			providerId: row.providerId,
			preset: row.preset as SsoPreset,
			name: row.name,
			issuer: row.issuer ?? "",
			authorizationUrl: row.authorizationUrl ?? "",
			tokenUrl: row.tokenUrl ?? "",
			userInfoUrl: row.userInfoUrl ?? "",
			clientId: row.clientId,
			// Never pre-filled: the panel does not read a stored secret back, and
			// an empty field here means "keep the one you have".
			clientSecret: "",
			scopes: row.scopes.join(", "),
			allowedEmailDomains: row.allowedEmailDomains.join(", "),
			defaultOrganizationId: row.defaultOrganizationId ?? "",
			defaultRole: row.defaultRole,
			groupClaim: row.groupClaim ?? "",
			groupMappings: formatGroupMappings(row.groupMappings),
			syncRoleOnLogin: row.syncRoleOnLogin,
			enabled: row.enabled,
		});
		setEditing(row);
	};

	const payload = () => ({
		preset: form.preset,
		name: form.name.trim(),
		issuer: form.issuer.trim() || null,
		authorizationUrl: form.authorizationUrl.trim() || null,
		tokenUrl: form.tokenUrl.trim() || null,
		userInfoUrl: form.userInfoUrl.trim() || null,
		clientId: form.clientId.trim(),
		scopes: splitList(form.scopes),
		allowedEmailDomains: splitList(form.allowedEmailDomains),
		defaultOrganizationId: form.defaultOrganizationId || null,
		defaultRole: form.defaultRole,
		groupClaim: form.groupClaim.trim() || null,
		groupMappings: parseGroupMappings(form.groupMappings),
		syncRoleOnLogin: form.syncRoleOnLogin,
		enabled: form.enabled,
	});

	const dialogOpen = creating || editing !== null;
	const pending = create.isPending || update.isPending;

	return (
		<SettingsSection
			wide
			title="Single sign-on"
			description={DESCRIPTION}
			actions={
				<Button size="sm" onClick={openCreate}>
					<Plus className="size-4" />
					Add provider
				</Button>
			}
		>
			{providersQuery.isPending ? (
				<Skeleton className="h-24 w-full" />
			) : providersQuery.isError ? (
				<LoadError
					message={providersQuery.error.message}
					onRetry={() => void providersQuery.refetch()}
				/>
			) : (providersQuery.data ?? []).length === 0 ? (
				<EmptyState
					icon={KeyRound}
					title="No identity provider yet"
					description="Add one and a “Continue with …” button appears on the login page. Password sign-in keeps working alongside it."
					action={
						<Button size="sm" onClick={openCreate}>
							<Plus className="size-4" />
							Add provider
						</Button>
					}
				/>
			) : (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							<TableHead className="hidden md:table-cell">Id</TableHead>
							<TableHead className="hidden md:table-cell">Issuer</TableHead>
							<TableHead>Status</TableHead>
							<TableHead className="w-20" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{(providersQuery.data ?? []).map((row) => (
							<TableRow key={row.ssoProviderId}>
								<TableCell className="font-medium">{row.name}</TableCell>
								<TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
									{row.providerId}
								</TableCell>
								<TableCell className="hidden max-w-64 truncate text-xs text-muted-foreground md:table-cell">
									{row.issuer ?? row.authorizationUrl ?? "—"}
								</TableCell>
								<TableCell>
									<Badge variant={row.enabled ? "default" : "outline"}>
										{row.enabled ? "Enabled" : "Disabled"}
									</Badge>
								</TableCell>
								<TableCell>
									<div className="flex items-center justify-end gap-1">
										<Button
											variant="ghost"
											size="icon"
											onClick={() => openEdit(row as ProviderRow)}
										>
											<Pencil className="size-4" />
											<span className="sr-only">Edit provider</span>
										</Button>
										<ConfirmDeleteDialog
											title="Remove this identity provider?"
											description={`Anyone who signs in with ${row.name} will no longer be able to. Their accounts stay, but they need a password or another provider.`}
											onConfirm={() => remove.mutateAsync({ ssoProviderId: row.ssoProviderId })}
											isPending={remove.isPending}
										/>
									</div>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			)}

			<Dialog
				open={dialogOpen}
				onOpenChange={(open) => {
					if (open) return;
					setCreating(false);
					setEditing(null);
				}}
			>
				<DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-2xl">
					<DialogHeader>
						<DialogTitle>
							{editing ? "Edit identity provider" : "Add identity provider"}
						</DialogTitle>
						<DialogDescription>
							{presetInfo?.note ?? "Any OpenID Connect provider with a discovery document."}
						</DialogDescription>
					</DialogHeader>

					<form
						className="flex flex-col gap-4"
						onSubmit={(event) => {
							event.preventDefault();
							if (editing) {
								update.mutate({
									ssoProviderId: editing.ssoProviderId,
									...payload(),
									...(form.clientSecret ? { clientSecret: form.clientSecret } : {}),
								});
							} else {
								create.mutate({
									providerId: form.providerId.trim(),
									clientSecret: form.clientSecret,
									...payload(),
								});
							}
						}}
					>
						<div className="grid gap-4 sm:grid-cols-2">
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="sso-preset">Provider</Label>
								<Select
									value={form.preset}
									onValueChange={(preset) => {
										const info = presets.find((entry) => entry.preset === preset);
										setForm((current) => ({
											...current,
											preset: preset as SsoPreset,
											scopes: info ? info.defaultScopes.join(", ") : current.scopes,
											groupClaim: info?.defaultGroupClaim ?? current.groupClaim,
											name: current.name || (info?.label ?? ""),
										}));
									}}
								>
									<SelectTrigger id="sso-preset">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{presets.map((entry) => (
											<SelectItem key={entry.preset} value={entry.preset}>
												{entry.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="sso-name">Button label</Label>
								<Input
									id="sso-name"
									value={form.name}
									onChange={(event) =>
										setForm((current) => ({ ...current, name: event.target.value }))
									}
									placeholder="Acme SSO"
									required
								/>
							</div>
						</div>

						{editing ? null : (
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="sso-provider-id">Provider id</Label>
								<Input
									id="sso-provider-id"
									value={form.providerId}
									onChange={(event) =>
										setForm((current) => ({ ...current, providerId: event.target.value }))
									}
									placeholder="okta"
									pattern="[a-z][a-z0-9-]*"
									required
								/>
								<RedirectUriHint providerId={form.providerId} />
							</div>
						)}

						{presetInfo?.kind === "fixed" ? null : (
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="sso-issuer">Issuer URL</Label>
								<Input
									id="sso-issuer"
									value={form.issuer}
									onChange={(event) =>
										setForm((current) => ({ ...current, issuer: event.target.value }))
									}
									placeholder={presetInfo?.issuerHint ?? "https://idp.example.com"}
								/>
								<p className="text-xs text-muted-foreground">
									Its discovery document supplies every endpoint. Leave empty to enter them by hand
									below.
								</p>
							</div>
						)}

						{presetInfo?.kind !== "fixed" && !form.issuer ? (
							<div className="grid gap-4 sm:grid-cols-2">
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="sso-auth-url">Authorization URL</Label>
									<Input
										id="sso-auth-url"
										value={form.authorizationUrl}
										onChange={(event) =>
											setForm((current) => ({ ...current, authorizationUrl: event.target.value }))
										}
									/>
								</div>
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="sso-token-url">Token URL</Label>
									<Input
										id="sso-token-url"
										value={form.tokenUrl}
										onChange={(event) =>
											setForm((current) => ({ ...current, tokenUrl: event.target.value }))
										}
									/>
								</div>
								<div className="flex flex-col gap-1.5 sm:col-span-2">
									<Label htmlFor="sso-userinfo-url">Userinfo URL</Label>
									<Input
										id="sso-userinfo-url"
										value={form.userInfoUrl}
										onChange={(event) =>
											setForm((current) => ({ ...current, userInfoUrl: event.target.value }))
										}
									/>
								</div>
							</div>
						) : null}

						<div className="grid gap-4 sm:grid-cols-2">
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="sso-client-id">Client ID</Label>
								<Input
									id="sso-client-id"
									value={form.clientId}
									onChange={(event) =>
										setForm((current) => ({ ...current, clientId: event.target.value }))
									}
									required
								/>
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="sso-client-secret">Client secret</Label>
								<Input
									id="sso-client-secret"
									type="password"
									value={form.clientSecret}
									onChange={(event) =>
										setForm((current) => ({ ...current, clientSecret: event.target.value }))
									}
									placeholder={editing ? "Leave blank to keep the current secret" : ""}
									required={!editing}
								/>
							</div>
						</div>

						<div className="grid gap-4 sm:grid-cols-2">
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="sso-scopes">Scopes</Label>
								<Input
									id="sso-scopes"
									value={form.scopes}
									onChange={(event) =>
										setForm((current) => ({ ...current, scopes: event.target.value }))
									}
								/>
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="sso-domains">Allowed email domains</Label>
								<Input
									id="sso-domains"
									value={form.allowedEmailDomains}
									onChange={(event) =>
										setForm((current) => ({
											...current,
											allowedEmailDomains: event.target.value,
										}))
									}
									placeholder="example.com, acme.dev"
								/>
								<p className="text-xs text-muted-foreground">
									Empty admits any domain the provider authenticates.
								</p>
							</div>
						</div>

						<div className="grid gap-4 sm:grid-cols-2">
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="sso-default-org">New users join</Label>
								<Select
									value={form.defaultOrganizationId || "none"}
									onValueChange={(value) =>
										setForm((current) => ({
											...current,
											defaultOrganizationId: value === "none" ? "" : value,
										}))
									}
								>
									<SelectTrigger id="sso-default-org">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="none">No organization</SelectItem>
										{(organizationsQuery.data ?? []).map((organization) => (
											<SelectItem
												key={organization.organizationId}
												value={organization.organizationId}
											>
												{organization.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="sso-default-role">…as</Label>
								<Select
									value={form.defaultRole}
									onValueChange={(defaultRole) =>
										setForm((current) => ({ ...current, defaultRole }))
									}
								>
									<SelectTrigger id="sso-default-role">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{ROLES.map((role) => (
											<SelectItem key={role} value={role}>
												{role}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</div>

						<div className="grid gap-4 sm:grid-cols-2">
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="sso-group-claim">Group claim</Label>
								<Input
									id="sso-group-claim"
									value={form.groupClaim}
									onChange={(event) =>
										setForm((current) => ({ ...current, groupClaim: event.target.value }))
									}
									placeholder="groups"
								/>
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="sso-group-mappings">Group → role</Label>
								<Textarea
									id="sso-group-mappings"
									className="h-20 font-mono text-xs"
									value={form.groupMappings}
									onChange={(event) =>
										setForm((current) => ({ ...current, groupMappings: event.target.value }))
									}
									placeholder={"platform-admins = admin\ndevelopers = deployer"}
								/>
							</div>
						</div>

						<div className="flex items-center justify-between rounded-md border p-3">
							<div className="flex flex-col gap-1 pe-4">
								<Label htmlFor="sso-sync-role">Re-apply the mapping on every sign-in</Label>
								<p className="text-xs text-muted-foreground">
									Removing someone from a group in the identity provider demotes them here too. Off
									by default, because it also overrides a role an owner set by hand.
								</p>
							</div>
							<Switch
								id="sso-sync-role"
								checked={form.syncRoleOnLogin}
								onCheckedChange={(syncRoleOnLogin) =>
									setForm((current) => ({ ...current, syncRoleOnLogin }))
								}
							/>
						</div>

						<div className="flex items-center justify-between rounded-md border p-3">
							<Label htmlFor="sso-enabled">Show on the login page</Label>
							<Switch
								id="sso-enabled"
								checked={form.enabled}
								onCheckedChange={(enabled) => setForm((current) => ({ ...current, enabled }))}
							/>
						</div>

						<DialogFooter>
							<Button type="submit" disabled={pending}>
								{pending && <Loader2 className="size-4 animate-spin" />}
								{editing ? "Save provider" : "Add provider"}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</SettingsSection>
	);
}

/**
 * The redirect URI to register at the IdP, resolved server-side from the
 * panel's configured base URL — the browser's own origin is not necessarily
 * the one better-auth will build the callback from.
 */
function RedirectUriHint({ providerId }: { providerId: string }) {
	const trpc = useTRPC();
	const [debounced, setDebounced] = useState(providerId);
	useEffect(() => {
		const timer = setTimeout(() => setDebounced(providerId), 300);
		return () => clearTimeout(timer);
	}, [providerId]);

	const valid = /^[a-z][a-z0-9-]{1,39}$/.test(debounced);
	const query = useQuery({
		...trpc.sso.redirectUri.queryOptions({ providerId: debounced }),
		enabled: valid,
	});

	if (!valid) {
		return (
			<p className="text-xs text-muted-foreground">
				Lowercase letters, digits and dashes. It becomes part of the redirect URI, so it cannot be
				changed later.
			</p>
		);
	}
	const redirectUri = query.data?.redirectUri;
	return (
		<div className="flex items-center gap-2">
			<code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs">
				{redirectUri ?? "…"}
			</code>
			{redirectUri ? <CopyButton value={redirectUri} label="Copy the redirect URI" /> : null}
		</div>
	);
}
