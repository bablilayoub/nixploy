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
	SlidersHorizontal,
	Trash2,
	XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
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
import { Textarea } from "@/components/ui/textarea";
import { useCapabilities } from "@/hooks/use-capabilities";
import { toastError } from "@/lib/describe-error";
import { useTRPC, useTRPCClient } from "@/lib/trpc";

type CertificateType = "letsencrypt" | "none" | "custom";

/* -------------------------------------------------------------------------- */
/*  Per-domain Traefik middlewares                                            */
/* -------------------------------------------------------------------------- */

type MiddlewareKind =
	| "rateLimit"
	| "ipAllowList"
	| "headers"
	| "compress"
	| "forwardAuth"
	| "stickyCookie"
	| "maintenance";

const MIDDLEWARE_META: Record<MiddlewareKind, { label: string; help: string }> = {
	rateLimit: { label: "Rate limit", help: "Cap requests per source IP." },
	ipAllowList: { label: "IP allow-list", help: "Only these CIDRs may reach the service." },
	headers: { label: "Headers", help: "Add request/response headers, HSTS and CORS." },
	compress: { label: "Compression", help: "gzip / brotli responses." },
	forwardAuth: { label: "Forward auth", help: "Delegate auth to an SSO proxy." },
	stickyCookie: { label: "Sticky sessions", help: "Pin a client to one replica." },
	maintenance: { label: "Maintenance mode", help: "Serve a maintenance page instead." },
};

const MIDDLEWARE_KINDS = Object.keys(MIDDLEWARE_META) as MiddlewareKind[];

/** Flat form state per row; converted to the Traefik config only on save. */
type MiddlewareFields = Record<string, string | boolean>;

type MiddlewareDraft = {
	key: string;
	kind: MiddlewareKind;
	enabled: boolean;
	fields: MiddlewareFields;
};

const DEFAULT_FIELDS: Record<MiddlewareKind, MiddlewareFields> = {
	rateLimit: { average: "10", burst: "20", period: "1s" },
	ipAllowList: { sourceRange: "" },
	headers: {
		requestHeaders: "",
		responseHeaders: "",
		stsSeconds: "",
		frameDeny: false,
		contentTypeNosniff: false,
		corsOrigins: "",
	},
	compress: { minResponseBodyBytes: "" },
	forwardAuth: { address: "", trustForwardHeader: true, authResponseHeaders: "" },
	stickyCookie: { name: "", secure: false, httpOnly: true },
	maintenance: {},
};

const parseHeaderLines = (text: string): Record<string, string> => {
	const out: Record<string, string> = {};
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		const separator = trimmed.indexOf(":");
		if (separator <= 0) continue;
		out[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
	}
	return out;
};

const formatHeaderLines = (value: unknown): string =>
	value && typeof value === "object"
		? Object.entries(value as Record<string, string>)
				.map(([name, headerValue]) => `${name}: ${headerValue}`)
				.join("\n")
		: "";

const splitList = (text: string): string[] =>
	text
		.split(/[\n,]/)
		.map((entry) => entry.trim())
		.filter(Boolean);

const numberOrUndefined = (value: string | boolean | undefined): number | undefined => {
	const parsed = Number.parseInt(String(value ?? "").trim(), 10);
	return Number.isFinite(parsed) ? parsed : undefined;
};

/** Form fields → the `config` jsonb the server validates per kind. */
const fieldsToConfig = (
	kind: MiddlewareKind,
	fields: MiddlewareFields,
): Record<string, unknown> => {
	switch (kind) {
		case "rateLimit":
			return {
				average: numberOrUndefined(fields.average) ?? 0,
				burst: numberOrUndefined(fields.burst) ?? 0,
				...(String(fields.period ?? "").trim() ? { period: String(fields.period).trim() } : {}),
			};
		case "ipAllowList":
			return { sourceRange: splitList(String(fields.sourceRange ?? "")) };
		case "headers": {
			const request = parseHeaderLines(String(fields.requestHeaders ?? ""));
			const response = parseHeaderLines(String(fields.responseHeaders ?? ""));
			const origins = splitList(String(fields.corsOrigins ?? ""));
			const sts = numberOrUndefined(fields.stsSeconds);
			return {
				...(Object.keys(request).length > 0 ? { customRequestHeaders: request } : {}),
				...(Object.keys(response).length > 0 ? { customResponseHeaders: response } : {}),
				...(origins.length > 0 ? { accessControlAllowOriginList: origins } : {}),
				...(sts !== undefined ? { stsSeconds: sts } : {}),
				...(fields.frameDeny ? { frameDeny: true } : {}),
				...(fields.contentTypeNosniff ? { contentTypeNosniff: true } : {}),
			};
		}
		case "compress": {
			const min = numberOrUndefined(fields.minResponseBodyBytes);
			return min !== undefined ? { minResponseBodyBytes: min } : {};
		}
		case "forwardAuth": {
			const responseHeaders = splitList(String(fields.authResponseHeaders ?? ""));
			return {
				address: String(fields.address ?? "").trim(),
				trustForwardHeader: Boolean(fields.trustForwardHeader),
				...(responseHeaders.length > 0 ? { authResponseHeaders: responseHeaders } : {}),
			};
		}
		case "stickyCookie":
			return {
				...(String(fields.name ?? "").trim() ? { name: String(fields.name).trim() } : {}),
				secure: Boolean(fields.secure),
				httpOnly: Boolean(fields.httpOnly),
			};
		case "maintenance":
			return {};
	}
};

/** Stored config → form fields (the inverse of {@link fieldsToConfig}). */
const configToFields = (kind: MiddlewareKind, config: unknown): MiddlewareFields => {
	const source = (config && typeof config === "object" ? config : {}) as Record<string, unknown>;
	const base = { ...DEFAULT_FIELDS[kind] };
	switch (kind) {
		case "rateLimit":
			return {
				average: String(source.average ?? base.average),
				burst: String(source.burst ?? base.burst),
				period: String(source.period ?? ""),
			};
		case "ipAllowList":
			return {
				sourceRange: Array.isArray(source.sourceRange) ? source.sourceRange.join("\n") : "",
			};
		case "headers":
			return {
				requestHeaders: formatHeaderLines(source.customRequestHeaders),
				responseHeaders: formatHeaderLines(source.customResponseHeaders),
				stsSeconds: source.stsSeconds === undefined ? "" : String(source.stsSeconds),
				frameDeny: Boolean(source.frameDeny),
				contentTypeNosniff: Boolean(source.contentTypeNosniff),
				corsOrigins: Array.isArray(source.accessControlAllowOriginList)
					? source.accessControlAllowOriginList.join(", ")
					: "",
			};
		case "compress":
			return {
				minResponseBodyBytes:
					source.minResponseBodyBytes === undefined ? "" : String(source.minResponseBodyBytes),
			};
		case "forwardAuth":
			return {
				address: String(source.address ?? ""),
				trustForwardHeader: source.trustForwardHeader !== false,
				authResponseHeaders: Array.isArray(source.authResponseHeaders)
					? source.authResponseHeaders.join(", ")
					: "",
			};
		case "stickyCookie":
			return {
				name: String(source.name ?? ""),
				secure: Boolean(source.secure),
				httpOnly: source.httpOnly !== false,
			};
		case "maintenance":
			return base;
	}
};

function MiddlewareFieldsEditor({
	kind,
	fields,
	onChange,
}: {
	kind: MiddlewareKind;
	fields: MiddlewareFields;
	onChange: (next: MiddlewareFields) => void;
}) {
	const set = (name: string, value: string | boolean) => onChange({ ...fields, [name]: value });
	const text = (name: string) => String(fields[name] ?? "");

	if (kind === "maintenance") {
		return (
			<p className="text-xs text-muted-foreground">
				Every response is replaced by the Nixploy maintenance page. The service keeps running and
				the domain keeps its certificate — disable the row to let traffic through again.
			</p>
		);
	}

	if (kind === "rateLimit") {
		return (
			<div className="grid grid-cols-3 gap-2">
				<div className="space-y-1">
					<Label className="text-xs">Average</Label>
					<Input
						inputMode="numeric"
						value={text("average")}
						onChange={(event) => set("average", event.target.value)}
					/>
				</div>
				<div className="space-y-1">
					<Label className="text-xs">Burst</Label>
					<Input
						inputMode="numeric"
						value={text("burst")}
						onChange={(event) => set("burst", event.target.value)}
					/>
				</div>
				<div className="space-y-1">
					<Label className="text-xs">Period</Label>
					<Input
						placeholder="1s"
						value={text("period")}
						onChange={(event) => set("period", event.target.value)}
					/>
				</div>
			</div>
		);
	}

	if (kind === "ipAllowList") {
		return (
			<div className="space-y-1">
				<Label className="text-xs">Allowed CIDRs (one per line)</Label>
				<Textarea
					rows={3}
					className="font-mono text-xs"
					placeholder={"10.0.0.0/8\n203.0.113.4/32"}
					value={text("sourceRange")}
					onChange={(event) => set("sourceRange", event.target.value)}
				/>
			</div>
		);
	}

	if (kind === "headers") {
		return (
			<div className="space-y-2">
				<div className="space-y-1">
					<Label className="text-xs">Response headers (Name: value)</Label>
					<Textarea
						rows={2}
						className="font-mono text-xs"
						placeholder="X-Robots-Tag: noindex"
						value={text("responseHeaders")}
						onChange={(event) => set("responseHeaders", event.target.value)}
					/>
				</div>
				<div className="space-y-1">
					<Label className="text-xs">Request headers (Name: value)</Label>
					<Textarea
						rows={2}
						className="font-mono text-xs"
						placeholder="X-Tenant: acme"
						value={text("requestHeaders")}
						onChange={(event) => set("requestHeaders", event.target.value)}
					/>
				</div>
				<div className="grid grid-cols-2 gap-2">
					<div className="space-y-1">
						<Label className="text-xs">HSTS max-age (seconds)</Label>
						<Input
							inputMode="numeric"
							placeholder="31536000"
							value={text("stsSeconds")}
							onChange={(event) => set("stsSeconds", event.target.value)}
						/>
					</div>
					<div className="space-y-1">
						<Label className="text-xs">CORS origins</Label>
						<Input
							placeholder="https://app.example.com"
							value={text("corsOrigins")}
							onChange={(event) => set("corsOrigins", event.target.value)}
						/>
					</div>
				</div>
				<div className="flex gap-4">
					<div className="flex items-center gap-2">
						<Checkbox
							id={`mw-${kind}-frameDeny`}
							checked={Boolean(fields.frameDeny)}
							onCheckedChange={(checked) => set("frameDeny", checked === true)}
						/>
						<Label htmlFor={`mw-${kind}-frameDeny`} className="font-normal text-xs">
							Deny framing
						</Label>
					</div>
					<div className="flex items-center gap-2">
						<Checkbox
							id={`mw-${kind}-contentTypeNosniff`}
							checked={Boolean(fields.contentTypeNosniff)}
							onCheckedChange={(checked) => set("contentTypeNosniff", checked === true)}
						/>
						<Label htmlFor={`mw-${kind}-contentTypeNosniff`} className="font-normal text-xs">
							No MIME sniffing
						</Label>
					</div>
				</div>
				<p className="text-xs text-muted-foreground">
					<code className="font-mono">Host</code> and{" "}
					<code className="font-mono">X-Forwarded-*</code> are set by the proxy and cannot be
					overridden.
				</p>
			</div>
		);
	}

	if (kind === "compress") {
		return (
			<div className="space-y-1">
				<Label className="text-xs">Minimum response size (bytes, optional)</Label>
				<Input
					inputMode="numeric"
					placeholder="1024"
					value={text("minResponseBodyBytes")}
					onChange={(event) => set("minResponseBodyBytes", event.target.value)}
				/>
			</div>
		);
	}

	if (kind === "forwardAuth") {
		return (
			<div className="space-y-2">
				<div className="space-y-1">
					<Label className="text-xs">Auth endpoint</Label>
					<Input
						className="font-mono text-xs"
						placeholder="http://authelia:9091/api/verify?rd=https://auth.example.com"
						value={text("address")}
						onChange={(event) => set("address", event.target.value)}
					/>
					<p className="text-xs text-muted-foreground">
						Either the app name of another service in this organization, or a public HTTPS URL.
					</p>
				</div>
				<div className="space-y-1">
					<Label className="text-xs">Headers to copy from the auth response</Label>
					<Input
						className="font-mono text-xs"
						placeholder="Remote-User, Remote-Groups, Remote-Email"
						value={text("authResponseHeaders")}
						onChange={(event) => set("authResponseHeaders", event.target.value)}
					/>
				</div>
				<div className="flex items-center gap-2">
					<Checkbox
						id={`mw-${kind}-trustForwardHeader`}
						checked={Boolean(fields.trustForwardHeader)}
						onCheckedChange={(checked) => set("trustForwardHeader", checked === true)}
					/>
					<Label htmlFor={`mw-${kind}-trustForwardHeader`} className="font-normal text-xs">
						Trust X-Forwarded-* when calling the auth service
					</Label>
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-2">
			<div className="space-y-1">
				<Label className="text-xs">Cookie name</Label>
				<Input
					placeholder="nixploy_sticky"
					value={text("name")}
					onChange={(event) => set("name", event.target.value)}
				/>
			</div>
			<div className="flex gap-4">
				<div className="flex items-center gap-2">
					<Checkbox
						id={`mw-${kind}-secure`}
						checked={Boolean(fields.secure)}
						onCheckedChange={(checked) => set("secure", checked === true)}
					/>
					<Label htmlFor={`mw-${kind}-secure`} className="font-normal text-xs">
						Secure
					</Label>
				</div>
				<div className="flex items-center gap-2">
					<Checkbox
						id={`mw-${kind}-httpOnly`}
						checked={Boolean(fields.httpOnly)}
						onCheckedChange={(checked) => set("httpOnly", checked === true)}
					/>
					<Label htmlFor={`mw-${kind}-httpOnly`} className="font-normal text-xs">
						HttpOnly
					</Label>
				</div>
			</div>
		</div>
	);
}

/**
 * Middleware chain of one domain. Loaded lazily per row (one small query) and
 * saved as a whole through `domain.saveMiddlewares`, so reordering, adding and
 * removing rewrite the Traefik file exactly once.
 */
function DomainMiddlewaresCell({
	domainId,
	host,
	canManage,
	manageHint,
}: {
	domainId: string;
	host: string;
	canManage: boolean;
	manageHint?: string;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [drafts, setDrafts] = useState<MiddlewareDraft[]>([]);

	const query = useQuery(trpc.domain.middlewares.queryOptions({ domainId }));
	const rows = query.data ?? [];
	const seeded = useRef(false);

	// Seed the editable drafts from the server exactly once per dialog open:
	// re-seeding on every refetch would discard whatever is being typed.
	useEffect(() => {
		if (!open) {
			seeded.current = false;
			return;
		}
		if (seeded.current || !query.data) return;
		seeded.current = true;
		setDrafts(
			query.data.map((row, index) => ({
				key: `${row.domainMiddlewareId}-${index}`,
				kind: row.kind as MiddlewareKind,
				enabled: row.enabled,
				fields: configToFields(row.kind as MiddlewareKind, row.config),
			})),
		);
	}, [open, query.data]);

	const save = useMutation(
		trpc.domain.saveMiddlewares.mutationOptions({
			onSuccess: () => {
				toast.success("Middlewares saved");
				void queryClient.invalidateQueries({
					queryKey: trpc.domain.middlewares.queryKey({ domainId }),
				});
				setOpen(false);
			},
			onError: (error) => toastError(error),
		}),
	);

	const activeCount = rows.filter((row) => row.enabled).length;

	return (
		<>
			<Button
				variant="ghost"
				size="sm"
				className="gap-1.5"
				disabled={!canManage}
				title={manageHint ?? "Edit Traefik middlewares"}
				aria-label={`Middlewares for ${host}`}
				onClick={() => setOpen(true)}
			>
				<SlidersHorizontal className="size-3.5" />
				<span className="text-xs">{activeCount > 0 ? activeCount : "—"}</span>
			</Button>

			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="sm:max-w-2xl">
					<DialogHeader>
						<DialogTitle>Middlewares</DialogTitle>
						<DialogDescription>
							Applied in order to every request for <span className="font-mono">{host}</span>, after
							redirects and basic auth.
						</DialogDescription>
					</DialogHeader>

					<div className="flex max-h-[55vh] flex-col gap-3 overflow-y-auto pr-1">
						{drafts.length === 0 && (
							<p className="py-6 text-center text-sm text-muted-foreground">
								No middlewares. Add one below.
							</p>
						)}
						{drafts.map((draft, index) => (
							<div key={draft.key} className="space-y-2 rounded-lg border border-border p-3">
								<div className="flex items-center justify-between gap-2">
									<div className="flex items-center gap-2">
										<Badge variant="outline" className="text-xs">
											{index + 1}
										</Badge>
										<span className="text-sm font-medium">{MIDDLEWARE_META[draft.kind].label}</span>
										<span className="text-xs text-muted-foreground">
											{MIDDLEWARE_META[draft.kind].help}
										</span>
									</div>
									<div className="flex items-center gap-2">
										<Switch
											checked={draft.enabled}
											aria-label={`Enable ${MIDDLEWARE_META[draft.kind].label}`}
											onCheckedChange={(enabled) =>
												setDrafts((current) =>
													current.map((row) => (row.key === draft.key ? { ...row, enabled } : row)),
												)
											}
										/>
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label={`Remove ${MIDDLEWARE_META[draft.kind].label}`}
											onClick={() =>
												setDrafts((current) => current.filter((row) => row.key !== draft.key))
											}
										>
											<Trash2 className="size-3.5 text-destructive" />
										</Button>
									</div>
								</div>
								<MiddlewareFieldsEditor
									kind={draft.kind}
									fields={draft.fields}
									onChange={(fields) =>
										setDrafts((current) =>
											current.map((row) => (row.key === draft.key ? { ...row, fields } : row)),
										)
									}
								/>
							</div>
						))}
					</div>

					<div className="flex items-center gap-2">
						<Select
							value=""
							onValueChange={(value) =>
								setDrafts((current) => [
									...current,
									{
										key: `new-${Date.now()}-${current.length}`,
										kind: value as MiddlewareKind,
										enabled: true,
										fields: { ...DEFAULT_FIELDS[value as MiddlewareKind] },
									},
								])
							}
						>
							<SelectTrigger className="w-64">
								<SelectValue placeholder="Add a middleware…" />
							</SelectTrigger>
							<SelectContent>
								{MIDDLEWARE_KINDS.map((kind) => (
									<SelectItem key={kind} value={kind}>
										{MIDDLEWARE_META[kind].label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => setOpen(false)}>
							Cancel
						</Button>
						<Button
							type="button"
							disabled={save.isPending || !canManage}
							title={manageHint}
							onClick={() =>
								save.mutate({
									domainId,
									middlewares: drafts.map((draft) => ({
										kind: draft.kind,
										enabled: draft.enabled,
										config: fieldsToConfig(draft.kind, draft.fields),
									})),
								})
							}
						>
							{save.isPending && <Loader2 className="size-4 animate-spin" />}
							Save middlewares
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

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
			onError: (error) => toastError(error),
		}),
	);

	type DomainRow = NonNullable<typeof domainsQuery.data>[number];

	const [dialogOpen, setDialogOpen] = useState(false);
	const [editing, setEditing] = useState<DomainRow | null>(null);
	const [deleting, setDeleting] = useState<DomainRow | null>(null);

	const [host, setHost] = useState("");
	const [path, setPath] = useState("/");
	const [internalPath, setInternalPath] = useState("");
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
			setInternalPath("");
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
		toastError(error, "Something went wrong");
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
		setInternalPath("");
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
		setInternalPath(domain.internalPath ?? "");
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
			toastError(error, "Failed to generate domain");
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

		const trimmedInternalPath = internalPath.trim();
		if (trimmedInternalPath && !trimmedInternalPath.startsWith("/")) {
			toast.error("Internal path must start with /");
			return;
		}
		const shared = {
			host: trimmedHost,
			path: path.trim() || "/",
			// Empty or "/" means no rewrite: the request path is forwarded as-is.
			internalPath: trimmedInternalPath && trimmedInternalPath !== "/" ? trimmedInternalPath : null,
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
									<TableHead>Middlewares</TableHead>
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
										<TableCell className="font-mono text-xs">
											{domain.path ?? "/"}
											{domain.internalPath && domain.internalPath !== "/" ? (
												<span
													className="text-muted-foreground"
													title={`Rewritten to ${domain.internalPath} before reaching the container`}
												>
													{" "}
													→ {domain.internalPath}
												</span>
											) : null}
										</TableCell>
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
											<DomainMiddlewaresCell
												domainId={domain.domainId}
												host={domain.host}
												canManage={canManage}
												manageHint={manageHint}
											/>
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

						<div className="space-y-1.5">
							<Label htmlFor="domain-internal-path">Internal path (optional)</Label>
							<Input
								id="domain-internal-path"
								placeholder="/"
								value={internalPath}
								onChange={(event) => setInternalPath(event.target.value)}
							/>
							<p className="text-xs text-muted-foreground">
								Rewrite the prefix before the request reaches the container: the public path above
								is stripped and this one is added, so{" "}
								<code className="font-mono">{path.trim() || "/"}api/x</code> arrives as{" "}
								<code className="font-mono">
									{(internalPath.trim() || "/").replace(/\/+$/, "")}/api/x
								</code>
								. Leave empty to forward the path unchanged.
							</p>
						</div>

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
