"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	CheckCircle2,
	Globe,
	Loader2,
	Lock,
	Pencil,
	Plus,
	RefreshCw,
	Trash2,
	XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { QueryState } from "@/components/query-state";
import { capabilityHint } from "@/components/services/capability-hint";
import { EmptyState } from "@/components/services/empty-state";
import { SettingsSection } from "@/components/settings/settings-section";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { Switch } from "@/components/ui/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useTRPC, useTRPCClient } from "@/lib/trpc";

type CertificateType = "letsencrypt" | "none" | "custom";

export function DomainManager({
	serviceType,
	serviceId,
	composeServices,
}: {
	serviceType: "application" | "compose";
	serviceId: string;
	composeServices?: string[];
}) {
	const trpc = useTRPC();
	const trpcClient = useTRPCClient();
	const queryClient = useQueryClient();
	const { can } = useCapabilities();
	const canManage = can("domains.manage");
	const manageHint = canManage ? undefined : capabilityHint("domains.manage");
	// Uptime probes are project settings (project.write on the server).
	const canProbe = can("project.write");

	const domainsQuery = useQuery(
		serviceType === "application"
			? trpc.domain.byApplication.queryOptions({ applicationId: serviceId })
			: trpc.domain.byCompose.queryOptions({ composeId: serviceId }),
	);
	const certificatesQuery = useQuery(trpc.certificate.all.queryOptions());
	const probesQuery = useQuery(trpc.observability.uptimeProbes.queryOptions());
	const setProbe = useMutation(
		trpc.observability.setUptimeProbe.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: trpc.observability.uptimeProbes.pathKey() });
				toast.success("Uptime probe updated");
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	type DomainRow = NonNullable<typeof domainsQuery.data>[number];

	const [dialogOpen, setDialogOpen] = useState(false);
	const [editing, setEditing] = useState<DomainRow | null>(null);
	const [deleting, setDeleting] = useState<DomainRow | null>(null);

	const [host, setHost] = useState("");
	const [path, setPath] = useState("/");
	const [port, setPort] = useState("");
	const [https, setHttps] = useState(false);
	const [certificateType, setCertificateType] = useState<CertificateType>("none");
	const [certificateId, setCertificateId] = useState<string | null>(null);
	const [serviceName, setServiceName] = useState<string | null>(null);
	const [hostCheck, setHostCheck] = useState<"idle" | "checking" | "available" | "taken">("idle");

	// Reset the form whenever the dialog closes.
	useEffect(() => {
		if (!dialogOpen) {
			setEditing(null);
			setHost("");
			setPath("/");
			setPort("");
			setHttps(false);
			setCertificateType("none");
			setCertificateId(null);
			setServiceName(composeServices?.[0] ?? null);
			setHostCheck("idle");
		}
	}, [dialogOpen, composeServices]);

	// Debounced host-uniqueness hint while the dialog is open.
	useEffect(() => {
		if (!dialogOpen || !host.trim()) {
			setHostCheck("idle");
			return;
		}
		setHostCheck("checking");
		const timer = setTimeout(() => {
			trpcClient.domain.validateHost
				.query({ host: host.trim(), domainId: editing?.domainId })
				.then((available) => setHostCheck(available ? "available" : "taken"))
				.catch(() => setHostCheck("idle"));
		}, 400);
		return () => clearTimeout(timer);
	}, [dialogOpen, host, editing, trpcClient]);

	const invalidate = () => {
		if (serviceType === "application") {
			void queryClient.invalidateQueries({
				queryKey: trpc.domain.byApplication.queryKey({ applicationId: serviceId }),
			});
		} else {
			void queryClient.invalidateQueries({
				queryKey: trpc.domain.byCompose.queryKey({ composeId: serviceId }),
			});
		}
	};

	const onMutationError = (error: { message?: string }) => {
		toast.error(error.message ?? "Something went wrong");
	};

	const createMutation = useMutation(
		trpc.domain.create.mutationOptions({
			onSuccess: () => {
				toast.success("Domain created");
				invalidate();
				setDialogOpen(false);
			},
			onError: onMutationError,
		}),
	);
	const updateMutation = useMutation(
		trpc.domain.update.mutationOptions({
			onSuccess: () => {
				toast.success("Domain updated");
				invalidate();
				setDialogOpen(false);
			},
			onError: onMutationError,
		}),
	);
	const deleteMutation = useMutation(
		trpc.domain.delete.mutationOptions({
			onSuccess: () => {
				toast.success("Domain deleted");
				invalidate();
				setDeleting(null);
			},
			onError: onMutationError,
		}),
	);

	const openCreate = () => {
		setEditing(null);
		setHost("");
		setPath("/");
		setPort("");
		setHttps(false);
		setCertificateType("none");
		setCertificateId(null);
		setServiceName(composeServices?.[0] ?? null);
		setDialogOpen(true);
	};

	const openEdit = (domain: DomainRow) => {
		setEditing(domain);
		setHost(domain.host);
		setPath(domain.path ?? "/");
		setPort(domain.port != null ? String(domain.port) : "");
		setHttps(domain.https);
		setCertificateType(domain.certificateType as CertificateType);
		setCertificateId(domain.certificateId);
		setServiceName(domain.serviceName);
		setDialogOpen(true);
	};

	const generateHost = async () => {
		try {
			const generated = await trpcClient.domain.generateDomain.query({});
			setHost(generated);
			// traefik.me → 127.0.0.1; Let's Encrypt can never issue for it.
			setCertificateType("none");
			setCertificateId(null);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Failed to generate domain");
		}
	};

	const saving = createMutation.isPending || updateMutation.isPending;

	const handleSubmit = () => {
		const trimmedHost = host.trim();
		if (!trimmedHost) {
			toast.error("Host is required");
			return;
		}
		const trimmedPort = port.trim();
		if (!trimmedPort) {
			toast.error("Container port is required — the port your app listens on (e.g. 3000)");
			return;
		}
		const parsedPort = Number.parseInt(trimmedPort, 10);
		if (!Number.isFinite(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
			toast.error("Port must be between 1 and 65535");
			return;
		}
		if (certificateType === "custom" && !certificateId) {
			toast.error("Select a certificate for custom certificate type");
			return;
		}
		const isTraefikMe =
			trimmedHost.toLowerCase().endsWith(".traefik.me") ||
			trimmedHost.toLowerCase() === "traefik.me";
		if (isTraefikMe && certificateType === "letsencrypt") {
			toast.error(
				"Let's Encrypt cannot issue for *.traefik.me (localhost). Use certificate “None”.",
			);
			return;
		}

		const shared = {
			host: trimmedHost,
			path: path.trim() || "/",
			port: parsedPort,
			https,
			certificateType,
			certificateId: certificateType === "custom" ? certificateId : null,
			serviceName: serviceType === "compose" ? serviceName : null,
		};

		if (editing) {
			updateMutation.mutate({ domainId: editing.domainId, ...shared });
		} else if (serviceType === "application") {
			createMutation.mutate({ ...shared, applicationId: serviceId });
		} else {
			createMutation.mutate({ ...shared, composeId: serviceId });
		}
	};

	const domains = domainsQuery.data ?? [];

	return (
		<>
			<SettingsSection
				title="Domains"
				description="Route traffic to this service through Traefik."
				actions={
					<Button size="sm" onClick={openCreate} disabled={!canManage} title={manageHint}>
						<Plus className="size-4" />
						Add Domain
					</Button>
				}
			>
				<QueryState
					isPending={domainsQuery.isLoading}
					isError={domainsQuery.isError}
					error={domainsQuery.error}
					onRetry={() => domainsQuery.refetch()}
					skeleton={
						<div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
							<Loader2 className="mr-2 size-4 animate-spin" /> Loading domains…
						</div>
					}
					isEmpty={domains.length === 0}
					empty={
						<EmptyState
							icon={Globe}
							title="No domains yet"
							description="Add a domain to expose this service over HTTP(S)."
							action={
								<Button
									size="sm"
									variant="outline"
									onClick={openCreate}
									disabled={!canManage}
									title={manageHint}
								>
									<Plus className="size-4" />
									Add Domain
								</Button>
							}
						/>
					}
				>
					<TableCard framed={false}>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Host</TableHead>
									<TableHead>Path</TableHead>
									<TableHead>Port</TableHead>
									{serviceType === "compose" && <TableHead>Service</TableHead>}
									<TableHead>Certificate</TableHead>
									<TableHead>Uptime</TableHead>
									<TableHead className="w-24 text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{domains.map((domain) => (
									<TableRow key={domain.domainId}>
										<TableCell>
											<a
												href={`${domain.https ? "https" : "http"}://${domain.host}`}
												target="_blank"
												rel="noreferrer"
												className="inline-flex items-center gap-1.5 font-mono text-xs hover:underline"
											>
												{domain.https && <Lock className="size-3 text-success" />}
												{domain.host}
											</a>
										</TableCell>
										<TableCell className="font-mono text-xs">{domain.path ?? "/"}</TableCell>
										<TableCell className="font-mono text-xs">{domain.port ?? "—"}</TableCell>
										{serviceType === "compose" && (
											<TableCell className="font-mono text-xs">
												{domain.serviceName ?? "—"}
											</TableCell>
										)}
										<TableCell>
											<Badge variant="outline" className="text-xs capitalize">
												{domain.certificateType === "letsencrypt"
													? "Let's Encrypt"
													: domain.certificateType}
											</Badge>
										</TableCell>
										<TableCell>
											{(() => {
												const probe = (probesQuery.data ?? []).find(
													(row) => row.domainId === domain.domainId,
												);
												return (
													<div className="flex items-center gap-2">
														<Switch
															checked={Boolean(probe?.enabled)}
															disabled={setProbe.isPending || !canProbe}
															title={canProbe ? undefined : capabilityHint("project.write")}
															onCheckedChange={(enabled) =>
																setProbe.mutate({ domainId: domain.domainId, enabled })
															}
														/>
														<span className="text-xs text-muted-foreground capitalize">
															{probe?.status ?? "off"}
														</span>
													</div>
												);
											})()}
										</TableCell>
										<TableCell className="text-right">
											<div className="flex justify-end gap-1">
												<Button
													variant="ghost"
													size="icon-sm"
													aria-label={`Edit domain ${domain.host}`}
													disabled={!canManage}
													title={manageHint}
													onClick={() => openEdit(domain)}
												>
													<Pencil className="size-3.5" />
												</Button>
												<Button
													variant="ghost"
													size="icon-sm"
													aria-label={`Delete domain ${domain.host}`}
													disabled={!canManage}
													title={manageHint}
													onClick={() => setDeleting(domain)}
												>
													<Trash2 className="size-3.5 text-destructive" />
												</Button>
											</div>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</TableCard>
				</QueryState>
			</SettingsSection>

			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>{editing ? "Edit domain" : "Add domain"}</DialogTitle>
						<DialogDescription>
							Traefik routes requests for this host to the service.
						</DialogDescription>
					</DialogHeader>
					<form
						onSubmit={(e) => {
							e.preventDefault();
							handleSubmit();
						}}
						className="space-y-4"
					>
						<div className="space-y-1.5">
							<Label htmlFor="domain-host">Host</Label>
							<div className="flex gap-2">
								<Input
									id="domain-host"
									placeholder="app.example.com"
									value={host}
									onChange={(event) => setHost(event.target.value)}
								/>
								<Button
									type="button"
									variant="outline"
									size="icon"
									onClick={generateHost}
									aria-label="Generate a free traefik.me domain"
									title="Generate a free traefik.me domain"
								>
									<RefreshCw className="size-4" />
								</Button>
							</div>
							{hostCheck === "checking" && (
								<p className="flex items-center gap-1 text-xs text-muted-foreground">
									<Loader2 className="size-3 animate-spin" /> Checking availability…
								</p>
							)}
							{hostCheck === "available" && (
								<p className="flex items-center gap-1 text-xs text-success">
									<CheckCircle2 className="size-3" /> Host is available
								</p>
							)}
							{hostCheck === "taken" && (
								<p className="flex items-center gap-1 text-xs text-destructive">
									<XCircle className="size-3" /> This host is already in use
								</p>
							)}
						</div>

						<div className="grid grid-cols-2 gap-3">
							<div className="space-y-1.5">
								<Label htmlFor="domain-path">Path</Label>
								<Input
									id="domain-path"
									placeholder="/"
									value={path}
									onChange={(event) => setPath(event.target.value)}
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="domain-port">Container port</Label>
								<Input
									id="domain-port"
									placeholder="3000"
									inputMode="numeric"
									value={port}
									onChange={(event) => setPort(event.target.value)}
								/>
							</div>
						</div>
						<p className="text-xs text-muted-foreground">
							The port your app listens on inside the container. Traffic to the host is forwarded to
							this port.
						</p>

						{serviceType === "compose" && (
							<div className="space-y-1.5">
								<Label>Compose service</Label>
								<Select
									value={serviceName ?? ""}
									onValueChange={(value) => setServiceName(value || null)}
								>
									<SelectTrigger>
										<SelectValue placeholder="Select a service" />
									</SelectTrigger>
									<SelectContent>
										{(composeServices ?? []).map((name) => (
											<SelectItem key={name} value={name}>
												{name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						)}

						<div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
							<div>
								<Label htmlFor="domain-https">HTTPS</Label>
								<p className="text-xs text-muted-foreground">Serve this domain over TLS.</p>
							</div>
							<Switch id="domain-https" checked={https} onCheckedChange={setHttps} />
						</div>

						<div className="space-y-1.5">
							<Label>Certificate</Label>
							<Select
								value={certificateType}
								onValueChange={(value) => setCertificateType(value as CertificateType)}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="none">None (self-signed / default)</SelectItem>
									<SelectItem value="letsencrypt">Let's Encrypt</SelectItem>
									<SelectItem value="custom">Custom</SelectItem>
								</SelectContent>
							</Select>
							{host.trim().toLowerCase().endsWith(".traefik.me") && (
								<p className="text-xs text-amber-600 dark:text-amber-400">
									*.traefik.me is for localhost only — keep certificate on “None”. Open the HTTPS
									URL and accept the browser warning for Traefik’s default cert.
								</p>
							)}
							{certificateType === "letsencrypt" && (
								<p className="text-xs text-muted-foreground">
									Point the domain's DNS A record to this server's public IP and make sure a Let's
									Encrypt email is set in Settings → Platform. HTTP-01 challenge requires port 80
									reachable from the internet.
								</p>
							)}
						</div>

						{certificateType === "custom" && (
							<div className="space-y-1.5">
								<Label>Custom certificate</Label>
								<Select
									value={certificateId ?? ""}
									onValueChange={(value) => setCertificateId(value || null)}
								>
									<SelectTrigger>
										<SelectValue placeholder="Select a certificate" />
									</SelectTrigger>
									<SelectContent>
										{(certificatesQuery.data ?? []).map((certificate) => (
											<SelectItem key={certificate.certificateId} value={certificate.certificateId}>
												{certificate.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						)}
						<DialogFooter>
							<Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
								Cancel
							</Button>
							<Button type="submit" disabled={saving}>
								{saving && <Loader2 className="size-4 animate-spin" />}
								{editing ? "Save changes" : "Create domain"}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete domain</AlertDialogTitle>
						<AlertDialogDescription>
							Remove <span className="font-mono">{deleting?.host}</span>? Traffic will no longer be
							routed to this service.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={deleteMutation.isPending}
							onClick={(event) => {
								// Keep the dialog open (with its spinner) until the mutation settles.
								event.preventDefault();
								if (deleting) deleteMutation.mutate({ domainId: deleting.domainId });
							}}
						>
							{deleteMutation.isPending && <Loader2 className="size-4 animate-spin" />}
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
