"use client";

import type { ApiKey } from "@better-auth/api-key";
import { format } from "date-fns";
import { Check, Copy, KeyRound, Loader2, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmDeleteDialog } from "@/components/settings/confirm-delete-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { authClient } from "@/lib/auth-client";

const EXPIRATION_OPTIONS = [
	{ label: "Never", value: "never", seconds: undefined },
	{ label: "7 days", value: "7d", seconds: 7 * 24 * 60 * 60 },
	{ label: "30 days", value: "30d", seconds: 30 * 24 * 60 * 60 },
	{ label: "90 days", value: "90d", seconds: 90 * 24 * 60 * 60 },
	{ label: "1 year", value: "1y", seconds: 365 * 24 * 60 * 60 },
];

/** List endpoint omits the hashed `key` column. */
type ApiKeyListItem = Omit<ApiKey, "key">;

export function ApiKeysCard() {
	const [keys, setKeys] = useState<ApiKeyListItem[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [createOpen, setCreateOpen] = useState(false);
	const [name, setName] = useState("");
	const [expiration, setExpiration] = useState("never");
	const [isPending, setIsPending] = useState(false);
	const [createdKey, setCreatedKey] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	const loadKeys = useCallback(async () => {
		const { data, error } = await authClient.apiKey.list();
		if (error) {
			toast.error(error.message ?? "Failed to load API keys");
		} else {
			setKeys(data?.apiKeys ?? []);
		}
		setIsLoading(false);
	}, []);

	useEffect(() => {
		loadKeys();
	}, [loadKeys]);

	async function createKey() {
		setIsPending(true);
		const expiresIn = EXPIRATION_OPTIONS.find((option) => option.value === expiration)?.seconds;
		const { data, error } = await authClient.apiKey.create({
			name,
			...(expiresIn ? { expiresIn } : {}),
		});
		setIsPending(false);
		if (error) {
			toast.error(error.message ?? "Failed to create API key");
			return;
		}
		toast.success("API key created");
		setCreatedKey(data.key);
		setName("");
		setExpiration("never");
		await loadKeys();
	}

	async function deleteKey(keyId: string) {
		const { error } = await authClient.apiKey.delete({ keyId });
		if (error) {
			toast.error(error.message ?? "Failed to delete API key");
			return;
		}
		toast.success("API key deleted");
		await loadKeys();
	}

	async function copyKey() {
		if (!createdKey) return;
		await navigator.clipboard.writeText(createdKey);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<div>
						<CardTitle className="flex items-center gap-2">
							<KeyRound className="size-4 text-muted-foreground" />
							API Keys
						</CardTitle>
						<CardDescription>Personal API keys for the REST API and CLI.</CardDescription>
					</div>
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
										<Button type="button" variant="outline" size="icon" onClick={copyKey}>
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
											Give the key a name and an optional expiration.
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
											<Label>Expires</Label>
											<Select value={expiration} onValueChange={setExpiration}>
												<SelectTrigger>
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													{EXPIRATION_OPTIONS.map((option) => (
														<SelectItem key={option.value} value={option.value}>
															{option.label}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>
									</div>
									<DialogFooter>
										<Button disabled={isPending || !name} onClick={createKey}>
											{isPending && <Loader2 className="size-4 animate-spin" />}
											Create
										</Button>
									</DialogFooter>
								</>
							)}
						</DialogContent>
					</Dialog>
				</div>
			</CardHeader>
			<CardContent>
				{isLoading ? (
					<div className="grid gap-2">
						<Skeleton className="h-9 w-full" />
						<Skeleton className="h-9 w-full" />
					</div>
				) : keys.length === 0 ? (
					<div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-10 text-center">
						<KeyRound className="size-8 text-muted-foreground" />
						<p className="text-sm text-muted-foreground">
							No API keys yet. Create one to use the REST API or CLI.
						</p>
					</div>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Name</TableHead>
								<TableHead>Key</TableHead>
								<TableHead>Created</TableHead>
								<TableHead>Expires</TableHead>
								<TableHead className="w-12" />
							</TableRow>
						</TableHeader>
						<TableBody>
							{keys.map((key) => (
								<TableRow key={key.id}>
									<TableCell className="font-medium">{key.name ?? "—"}</TableCell>
									<TableCell>
										<code className="text-xs text-muted-foreground">
											{key.start ?? key.prefix ?? "•••"}…
										</code>
									</TableCell>
									<TableCell className="text-muted-foreground">
										{format(new Date(key.createdAt), "MMM d, yyyy")}
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
							))}
						</TableBody>
					</Table>
				)}
			</CardContent>
		</Card>
	);
}
