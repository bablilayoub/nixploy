"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { SettingsSection } from "@/components/layout/settings-section";
import { LoadError } from "@/components/query-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toastError } from "@/lib/describe-error";
import { useTRPC } from "@/lib/trpc";

/**
 * Instance whitelabel.
 *
 * Free, because what the panels that charge for this actually ship is a text
 * field and an image upload. The product name and favicon matter most: they
 * are what a customer sees in the browser tab, and they are the two places a
 * half-done whitelabel is always missing.
 */

const DESCRIPTION =
	"The product name, logos and colours of this instance — on the login page, the browser tab and the dashboard. Instance admin only.";

const SLOTS = [
	{ slot: "logoLight" as const, label: "Logo (light background)" },
	{ slot: "logoDark" as const, label: "Logo (dark background)" },
	{ slot: "favicon" as const, label: "Favicon" },
];

interface FormState {
	productName: string;
	accentColor: string;
	footerText: string;
	supportUrl: string;
	docsUrl: string;
	emailFromName: string;
	customCss: string;
}

const EMPTY: FormState = {
	productName: "",
	accentColor: "",
	footerText: "",
	supportUrl: "",
	docsUrl: "",
	emailFromName: "",
	customCss: "",
};

export function BrandingCard() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const settings = useQuery(trpc.branding.settings.queryOptions());
	const [form, setForm] = useState<FormState>(EMPTY);
	const [loaded, setLoaded] = useState(false);

	// Hydrate the form once; re-syncing on every refetch would discard edits
	// the moment an upload invalidates the query.
	useEffect(() => {
		if (loaded || !settings.data) return;
		setForm({
			productName: settings.data.storedProductName ?? "",
			accentColor: settings.data.accentColor ?? "",
			footerText: settings.data.footerText ?? "",
			supportUrl: settings.data.supportUrl ?? "",
			docsUrl: settings.data.docsUrl ?? "",
			emailFromName: settings.data.emailFromName ?? "",
			customCss: settings.data.customCss ?? "",
		});
		setLoaded(true);
	}, [settings.data, loaded]);

	const refresh = () => {
		void queryClient.invalidateQueries({ queryKey: trpc.branding.settings.queryKey() });
		void queryClient.invalidateQueries({ queryKey: trpc.branding.public.queryKey() });
	};

	const save = useMutation(
		trpc.branding.update.mutationOptions({
			onSuccess: () => {
				toast.success("Branding saved — reload to see the tab title and favicon change");
				refresh();
			},
			onError: (error) => toastError(error, "Could not save the branding"),
		}),
	);

	const clearAsset = useMutation(
		trpc.branding.clearAsset.mutationOptions({
			onSuccess: () => {
				toast.success("Asset removed");
				refresh();
			},
			onError: (error) => toastError(error, "Could not remove the asset"),
		}),
	);

	if (settings.isPending) {
		return (
			<SettingsSection wide title="Branding" description={DESCRIPTION}>
				<Skeleton className="h-48 w-full" />
			</SettingsSection>
		);
	}
	if (settings.isError) {
		return (
			<SettingsSection wide title="Branding" description={DESCRIPTION}>
				<LoadError message={settings.error.message} onRetry={() => void settings.refetch()} />
			</SettingsSection>
		);
	}

	const urlFor = (slot: (typeof SLOTS)[number]["slot"]): string | null =>
		slot === "logoLight"
			? (settings.data?.logoLightUrl ?? null)
			: slot === "logoDark"
				? (settings.data?.logoDarkUrl ?? null)
				: (settings.data?.faviconUrl ?? null);

	return (
		<SettingsSection wide title="Branding" description={DESCRIPTION}>
			<form
				className="flex flex-col gap-5"
				onSubmit={(event) => {
					event.preventDefault();
					save.mutate({
						productName: form.productName.trim() || null,
						accentColor: form.accentColor.trim() || null,
						footerText: form.footerText.trim() || null,
						supportUrl: form.supportUrl.trim() || null,
						docsUrl: form.docsUrl.trim() || null,
						emailFromName: form.emailFromName.trim() || null,
						customCss: form.customCss.trim() || null,
					});
				}}
			>
				<div className="grid gap-4 sm:grid-cols-2">
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="branding-product-name">Product name</Label>
						<Input
							id="branding-product-name"
							value={form.productName}
							placeholder="Nixploy"
							maxLength={80}
							onChange={(event) =>
								setForm((current) => ({ ...current, productName: event.target.value }))
							}
						/>
						<p className="text-xs text-muted-foreground">
							Replaces “Nixploy” in the browser tab, the header and outbound mail.
						</p>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="branding-accent">Accent colour</Label>
						<div className="flex items-center gap-2">
							<Input
								id="branding-accent"
								value={form.accentColor}
								placeholder="#4f46e5"
								onChange={(event) =>
									setForm((current) => ({ ...current, accentColor: event.target.value }))
								}
							/>
							<input
								type="color"
								aria-label="Pick an accent colour"
								className="size-9 shrink-0 cursor-pointer rounded-md border border-border bg-transparent"
								value={/^#[0-9A-Fa-f]{6}$/.test(form.accentColor) ? form.accentColor : "#000000"}
								onChange={(event) =>
									setForm((current) => ({ ...current, accentColor: event.target.value }))
								}
							/>
						</div>
					</div>
				</div>

				<div className="grid gap-4 sm:grid-cols-3">
					{SLOTS.map((entry) => (
						<AssetSlot
							key={entry.slot}
							slot={entry.slot}
							label={entry.label}
							url={urlFor(entry.slot)}
							onUploaded={refresh}
							onClear={() => clearAsset.mutate({ slot: entry.slot })}
							clearing={clearAsset.isPending}
						/>
					))}
				</div>

				<div className="grid gap-4 sm:grid-cols-2">
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="branding-support">Support URL</Label>
						<Input
							id="branding-support"
							value={form.supportUrl}
							placeholder="https://support.example.com"
							onChange={(event) =>
								setForm((current) => ({ ...current, supportUrl: event.target.value }))
							}
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="branding-docs">Docs URL</Label>
						<Input
							id="branding-docs"
							value={form.docsUrl}
							placeholder="https://docs.example.com"
							onChange={(event) =>
								setForm((current) => ({ ...current, docsUrl: event.target.value }))
							}
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="branding-footer">Footer text</Label>
						<Input
							id="branding-footer"
							value={form.footerText}
							placeholder="© Acme Ltd"
							maxLength={300}
							onChange={(event) =>
								setForm((current) => ({ ...current, footerText: event.target.value }))
							}
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="branding-email-from">Email from-name</Label>
						<Input
							id="branding-email-from"
							value={form.emailFromName}
							placeholder="Acme Platform"
							maxLength={80}
							onChange={(event) =>
								setForm((current) => ({ ...current, emailFromName: event.target.value }))
							}
						/>
						<p className="text-xs text-muted-foreground">
							The name on outbound mail; the address stays the configured sender.
						</p>
					</div>
				</div>

				<div className="flex flex-col gap-1.5">
					<Label htmlFor="branding-css">Custom CSS</Label>
					<Textarea
						id="branding-css"
						className="h-32 font-mono text-xs"
						value={form.customCss}
						placeholder=".panel-logo { height: 28px }"
						onChange={(event) =>
							setForm((current) => ({ ...current, customCss: event.target.value }))
						}
					/>
					<p className="text-xs text-muted-foreground">
						Injected into every page. <code className="font-mono">@import</code>, scripting
						constructs and anything that could close the tag are stripped on save.
					</p>
				</div>

				<div>
					<Button type="submit" disabled={save.isPending}>
						{save.isPending && <Loader2 className="size-4 animate-spin" />}
						Save branding
					</Button>
				</div>
			</form>
		</SettingsSection>
	);
}

function AssetSlot({
	slot,
	label,
	url,
	onUploaded,
	onClear,
	clearing,
}: {
	slot: string;
	label: string;
	url: string | null;
	onUploaded: () => void;
	onClear: () => void;
	clearing: boolean;
}) {
	const input = useRef<HTMLInputElement>(null);
	const [uploading, setUploading] = useState(false);

	async function upload(file: File) {
		setUploading(true);
		try {
			const body = new FormData();
			body.append("file", file);
			const res = await fetch(`/api/branding/upload/${slot}`, { method: "POST", body });
			const data = (await res.json().catch(() => ({}))) as { message?: string };
			if (!res.ok) {
				toast.error(data.message ?? "Upload failed");
				return;
			}
			toast.success("Uploaded");
			onUploaded();
		} catch {
			toast.error("Upload failed");
		} finally {
			setUploading(false);
			if (input.current) input.current.value = "";
		}
	}

	return (
		<div className="flex flex-col gap-2 rounded-md border border-border p-3">
			<Label>{label}</Label>
			<div className="flex h-12 items-center justify-center rounded border border-dashed border-border bg-muted/40">
				{url ? (
					// A plain <img>: the source is an operator upload served from our
					// own origin, which Next's optimiser cannot help with anyway.
					// biome-ignore lint/performance/noImgElement: runtime-uploaded asset, not a build-time import
					<img src={url} alt={label} className="max-h-10 max-w-full object-contain" />
				) : (
					<span className="text-xs text-muted-foreground">Default</span>
				)}
			</div>
			<input
				ref={input}
				type="file"
				accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/x-icon,.ico"
				className="hidden"
				onChange={(event) => {
					const file = event.target.files?.[0];
					if (file) void upload(file);
				}}
			/>
			<div className="flex items-center gap-1">
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="flex-1"
					disabled={uploading}
					onClick={() => input.current?.click()}
				>
					{uploading ? (
						<Loader2 className="size-3.5 animate-spin" />
					) : (
						<Upload className="size-3.5" />
					)}
					Upload
				</Button>
				{url ? (
					<Button
						type="button"
						variant="ghost"
						size="icon"
						disabled={clearing}
						onClick={onClear}
						title="Remove"
					>
						<Trash2 className="size-4" />
						<span className="sr-only">Remove {label}</span>
					</Button>
				) : null}
			</div>
		</div>
	);
}
