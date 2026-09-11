"use client";

import type { ApiKey } from "@better-auth/api-key";
import {
	API_KEY_SCOPE_DESCRIPTIONS,
	API_KEY_SCOPE_LABELS,
	API_KEY_SCOPES,
	type ApiKeyScope,
	buildApiKeyMetadata,
	describeApiKey,
} from "@nixploy/server/modules/auth/api-key-scopes";
import { format } from "date-fns";
import { Check, Copy, ExternalLink, Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmDeleteDialog } from "@/components/settings/confirm-delete-dialog";
import { SettingsSection } from "@/components/settings/settings-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
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
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { authClient, useSession } from "@/lib/auth-client";
import { toastError } from "@/lib/describe-error";

const DAY = 24 * 60 * 60;

const EXPIRATION_OPTIONS = [
	{ label: "7 days", value: "7d", seconds: 7 * DAY },
	{ label: "30 days", value: "30d", seconds: 30 * DAY },
	{ label: "90 days (recommended)", value: "90d", seconds: 90 * DAY },
	{ label: "1 year", value: "1y", seconds: 365 * DAY },
	// The server refuses this for anyone but the instance admin.
	{ label: "Never", value: "never", seconds: undefined },
];

const DEFAULT_EXPIRATION = "90d";
/** Least privilege by default — widen deliberately in the picker. */
const DEFAULT_SCOPE: ApiKeyScope = "read";

/** List endpoint omits the hashed `key` column. */
type ApiKeyListItem = Omit<ApiKey, "key">;

interface OrganizationOption {
	id: string;
	name: string;
}

export function ApiKeysCard() {
	const { data: session } = useSession();
	const isInstanceAdmin = (session?.user as { role?: string | null } | undefined)?.role
		?.split(",")
		.map((part) => part.trim())
		.includes("admin");

	const [keys, setKeys] = useState<ApiKeyListItem[]>([]);
	const [organizations, setOrganizations] = useState<OrganizationOption[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [createOpen, setCreateOpen] = useState(false);
	const [name, setName] = useState("");
	const [scope, setScope] = useState<ApiKeyScope>(DEFAULT_SCOPE);
	const [organizationId, setOrganizationId] = useState<string>("");
	const [expiration, setExpiration] = useState(DEFAULT_EXPIRATION);
	const [isPending, setIsPending] = useState(false);
	const [createdKey, setCreatedKey] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	const loadKeys = useCallback(async () => {
		setIsLoading(true);
		const { data, error } = await authClient.apiKey.list();
		if (error) {
			// Keep the previous list out of view: a failed fetch must not look
			// like "you have no API keys".
			setLoadError(error.message ?? "Failed to load API keys");
		} else {
			setLoadError(null);
			setKeys(data?.apiKeys ?? []);
		}
		setIsLoading(false);
	}, []);

	const loadOrganizations = useCallback(async () => {
		const { data } = await authClient.organization.list();
		const list = (data ?? []).map((org) => ({ id: org.id, name: org.name }));
		setOrganizations(list);
		setOrganizationId((current) => {
			if (current) return current;
			const active = session?.session?.activeOrganizationId;
			if (active && list.some((org) => org.id === active)) return active;
			return list[0]?.id ?? "";
		});
	}, [session?.session?.activeOrganizationId]);

	useEffect(() => {
		loadKeys();
	}, [loadKeys]);

	useEffect(() => {
		loadOrganizations();
	}, [loadOrganizations]);

	const organizationName = (id: string | null) =>
		id ? (organizations.find((org) => org.id === id)?.name ?? id) : null;

	async function createKey() {
		setIsPending(true);
		const expiresIn = EXPIRATION_OPTIONS.find((option) => option.value === expiration)?.seconds;
		const { data, error } = await authClient.apiKey.create({
			name,
			// Scope and organization binding travel in `metadata`: the api-key
			// plugin treats `permissions` as server-only and rejects it on any
			// request with headers. `lib/auth.ts` mirrors the scope into the
			// `permissions` column right after creation; `buildApiKeyContext`
			// enforces both.
			metadata: {
				...buildApiKeyMetadata(organizationId || null, scope),
				...(expiration === "never" ? { neverExpires: true } : {}),
			},
			...(expiresIn ? { expiresIn } : {}),
		});
		setIsPending(false);
		if (error) {
			toastError(error, "Failed to create API key");
			return;
		}
		toast.success("API key created");
		setCreatedKey(data.key);
		setName("");
		setScope(DEFAULT_SCOPE);
		setExpiration(DEFAULT_EXPIRATION);
		await loadKeys();
	}

	async function deleteKey(keyId: string) {
		const { error } = await authClient.apiKey.delete({ keyId });
		if (error) {
			toastError(error, "Failed to delete API key");
			return;
		}
		toast.success("API key deleted");
		await loadKeys();
	}

	async function copyKey() {
		if (!createdKey) return;
		try {
			await navigator.clipboard.writeText(createdKey);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// Clipboard access is denied on plain-HTTP origins — the key stays
			// visible in the dialog so it can still be copied by hand.
			toast.error("Failed to copy to clipboard — select the key and copy it manually");
		}
	}

	const expirationOptions = EXPIRATION_OPTIONS.filter(
		(option) => option.value !== "never" || isInstanceAdmin,
	);

	return (
		<SettingsSection
			title="API keys"
			description="Personal API keys for the REST API and CLI. A key carries the scope you pick here, never more than your own permissions, and is bound to one organization."
			actions={
				<div className="flex flex-wrap items-center gap-2">
					<Button variant="outline" size="sm" asChild>
						<Link href="/swagger" target="_blank" rel="noreferrer">
							Swagger
							<ExternalLink className="size-3.5" />
						</Link>
					</Button>
					<Dialog
						open={createOpen}
						onOpenChange={(open) => {
							setCreateOpen(open);
							if (!open) setCreatedKey(null);
						}}
					>
						<DialogTrigger asChild>
							<Button size="sm">
								<Plus className="size-4" />
								Create API Key
							</Button>
						</DialogTrigger>
						<DialogContent>
							{createdKey ? (
								<>
									<DialogHeader>
										<DialogTitle>API key created</DialogTitle>
										<DialogDescription>
											Copy this key now — it will not be shown again.
										</DialogDescription>
									</DialogHeader>
									<div className="flex items-center gap-2">
										<code className="flex-1 truncate rounded-md border bg-muted px-3 py-2 text-xs">
											{createdKey}
										</code>
										<Button
											type="button"
											variant="outline"
											size="icon"
											aria-label="Copy API key"
											onClick={copyKey}
										>
											{copied ? <Check className="size-4" /> : <Copy className="size-4" />}
										</Button>
									</div>
									<DialogFooter>
										<Button onClick={() => setCreateOpen(false)}>Done</Button>
									</DialogFooter>
								</>
							) : (
								<>
									<DialogHeader>
										<DialogTitle>Create API key</DialogTitle>
										<DialogDescription>
											Pick the narrowest scope the client needs.
										</DialogDescription>
									</DialogHeader>
									<div className="grid gap-4">
										<div className="grid gap-2">
											<Label htmlFor="api-key-name">Name</Label>
											<Input
												id="api-key-name"
												placeholder="e.g. CLI on my laptop"
												value={name}
												onChange={(e) => setName(e.target.value)}
											/>
										</div>
										<div className="grid gap-2">
											<Label>Scope</Label>
											<Select
												value={scope}
												onValueChange={(value) => setScope(value as ApiKeyScope)}
											>
												<SelectTrigger>
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													{API_KEY_SCOPES.map((option) => (
														<SelectItem key={option} value={option}>
															{API_KEY_SCOPE_LABELS[option]}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
											<p className="text-xs text-muted-foreground">
												{API_KEY_SCOPE_DESCRIPTIONS[scope]}
											</p>
										</div>
										<div className="grid gap-2">
											<Label>Organization</Label>
											<Select value={organizationId} onValueChange={setOrganizationId}>
												<SelectTrigger>
													<SelectValue placeholder="Select an organization" />
												</SelectTrigger>
												<SelectContent>
													{organizations.map((org) => (
														<SelectItem key={org.id} value={org.id}>
															{org.name}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
											<p className="text-xs text-muted-foreground">
												The key can only act for this organization.
											</p>
										</div>
										<div className="grid gap-2">
											<Label>Expires</Label>
											<Select value={expiration} onValueChange={setExpiration}>
												<SelectTrigger>
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													{expirationOptions.map((option) => (
														<SelectItem key={option.value} value={option.value}>
															{option.label}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
											{!isInstanceAdmin && (
												<p className="text-xs text-muted-foreground">
													Keys always expire — only the instance admin can create one that does not.
												</p>
											)}
										</div>
									</div>
									<DialogFooter>
										<Button disabled={isPending || !name || !organizationId} onClick={createKey}>
											{isPending && <Loader2 className="size-4 animate-spin" />}
											Create
										</Button>
									</DialogFooter>
								</>
							)}
						</DialogContent>
					</Dialog>
				</div>
			}
		>
			{isLoading ? (
				<div className="grid gap-2">
					<Skeleton className="h-9 w-full" />
					<Skeleton className="h-9 w-full" />
				</div>
			) : loadError ? (
				<div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-8 text-center">
					<p className="text-sm font-medium">Could not load API keys</p>
					<p className="text-sm text-muted-foreground">{loadError}</p>
					<Button variant="outline" size="sm" onClick={() => void loadKeys()}>
						Retry
					</Button>
				</div>
			) : keys.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					No API keys yet. Create one to use the REST API or CLI.
				</p>
			) : (
				<TableCard>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Name</TableHead>
								<TableHead>Key</TableHead>
								<TableHead>Scope</TableHead>
								<TableHead>Organization</TableHead>
								<TableHead>Last used</TableHead>
								<TableHead>Expires</TableHead>
								<TableHead className="w-12" />
							</TableRow>
						</TableHeader>
						<TableBody>
							{keys.map((key) => {
								const info = describeApiKey(key);
								return (
									<TableRow key={key.id}>
										<TableCell className="font-medium">{key.name ?? "—"}</TableCell>
										<TableCell>
											<code className="text-xs text-muted-foreground">
												{key.start ?? key.prefix ?? "•••"}…
											</code>
										</TableCell>
										<TableCell>
											{info.legacy ? (
												<Badge variant="outline" title="Created before scopes existed">
													Legacy — full access
												</Badge>
											) : info.scope ? (
												<Badge variant="secondary">{API_KEY_SCOPE_LABELS[info.scope]}</Badge>
											) : (
												<Badge variant="outline">Full access</Badge>
											)}
										</TableCell>
										<TableCell className="text-muted-foreground">
											{organizationName(info.organizationId) ?? "Any (owner's)"}
										</TableCell>
										<TableCell className="text-muted-foreground">
											{key.lastRequest ? format(new Date(key.lastRequest), "MMM d, yyyy") : "Never"}
										</TableCell>
										<TableCell className="text-muted-foreground">
											{key.expiresAt ? format(new Date(key.expiresAt), "MMM d, yyyy") : "Never"}
										</TableCell>
										<TableCell>
											<ConfirmDeleteDialog
												title="Delete API key"
												description={`Delete "${key.name ?? "this key"}"? Applications using it will lose access immediately.`}
												onConfirm={() => deleteKey(key.id)}
											/>
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				</TableCard>
			)}
		</SettingsSection>
	);
}
