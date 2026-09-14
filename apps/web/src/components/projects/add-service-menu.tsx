"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CopyButton } from "@/components/services/copy-button";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HelpLink } from "@/components/ui/help-link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { toastError } from "@/lib/describe-error";
import { useTRPC } from "@/lib/trpc";

import { DATABASE_TYPES, type DatabaseType, SERVICE_TYPE_META } from "./service-types";

const SECRET_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randomSecret(length = 20) {
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (byte) => SECRET_ALPHABET[byte % SECRET_ALPHABET.length]).join("");
}

function slugify(value: string) {
	return (
		value
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "db"
	);
}

interface CreatedDatabase {
	type: DatabaseType;
	name: string;
	credentials: Record<string, string>;
}

interface CredentialField {
	key: string;
	label: string;
	/** Secret fields default to a random value; the rest default to the name slug. */
	secret?: boolean;
}

/** Credential inputs shown per database type in the create dialog. All are
 * optional — blank fields fall back to auto-generated values. */
const DATABASE_CREDENTIAL_FIELDS: Record<DatabaseType, CredentialField[]> = {
	postgres: [
		{ key: "databaseName", label: "Database name" },
		{ key: "databaseUser", label: "User" },
		{ key: "databasePassword", label: "Password", secret: true },
	],
	mysql: [
		{ key: "databaseName", label: "Database name" },
		{ key: "databaseUser", label: "User" },
		{ key: "databasePassword", label: "Password", secret: true },
		{ key: "databaseRootPassword", label: "Root password", secret: true },
	],
	mariadb: [
		{ key: "databaseName", label: "Database name" },
		{ key: "databaseUser", label: "User" },
		{ key: "databasePassword", label: "Password", secret: true },
		{ key: "databaseRootPassword", label: "Root password", secret: true },
	],
	mongo: [
		{ key: "databaseUser", label: "User" },
		{ key: "databasePassword", label: "Password", secret: true },
	],
	redis: [{ key: "databasePassword", label: "Password", secret: true }],
};

type ServiceDialog = "application" | "compose" | DatabaseType;

/**
 * How the new application gets its code. Asking here is the difference
 * between landing on a service you can deploy and landing on one that needs
 * two more forms found on two more tabs (UX audit F6).
 */
type SourceKind = "later" | "docker" | "git";

export function AddServiceMenu({
	projectId,
	environmentId,
	environmentName,
	openDialog,
	onOpenDialogConsumed,
	disabled = false,
	disabledReason,
}: {
	projectId: string;
	environmentId: string;
	environmentName: string;
	/**
	 * Request to open a create dialog (e.g. from a ?new=application deep
	 * link). Reacts to changes, not only to the mount; the parent clears it via
	 * `onOpenDialogConsumed` so the same request can fire again later.
	 */
	openDialog?: ServiceDialog | null;
	onOpenDialogConsumed?: () => void;
	/** Member lacks `service.create` — the menu stays visible but inert. */
	disabled?: boolean;
	disabledReason?: string;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const router = useRouter();

	const [dialog, setDialog] = useState<ServiceDialog | null>(null);

	useEffect(() => {
		if (!openDialog) return;
		setDialog(openDialog);
		onOpenDialogConsumed?.();
	}, [openDialog, onOpenDialogConsumed]);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [composeType, setComposeType] = useState<"docker-compose" | "stack">("docker-compose");
	const [sourceKind, setSourceKind] = useState<SourceKind>("docker");
	const [dockerImage, setDockerImage] = useState("");
	const [gitUrl, setGitUrl] = useState("");
	const [gitBranch, setGitBranch] = useState("");
	const [credentials, setCredentials] = useState<Record<string, string>>({});
	const [createdDatabase, setCreatedDatabase] = useState<CreatedDatabase | null>(null);

	const resetForm = () => {
		setName("");
		setDescription("");
		setComposeType("docker-compose");
		setSourceKind("docker");
		setDockerImage("");
		setGitUrl("");
		setGitBranch("");
		setCredentials({});
	};

	const serviceInput = { projectId, environmentName };

	/** The .all list of the created type plus the count sources. */
	const serviceKeys = (type: "application" | "compose" | DatabaseType) => [
		trpc[type].all.queryKey(serviceInput),
		trpc.environment.byProject.queryKey({ projectId }),
		trpc.project.all.queryKey(),
	];

	const invalidateServices = async (type: "application" | "compose" | DatabaseType) => {
		await Promise.all(
			serviceKeys(type).map((queryKey) => queryClient.invalidateQueries({ queryKey })),
		);
	};

	const onMutationError = (error: { message: string }) => toastError(error);

	const closeDialog = () => {
		setDialog(null);
		resetForm();
	};

	const createApplication = useSaveMutation(
		trpc.application.create.mutationOptions({
			// Dynamic text, so it stays here instead of `successMessage`.
			onSuccess: (application) => toast.success(`Application "${application.name}" created`),
		}),
		{ invalidate: serviceKeys("application"), onSuccess: closeDialog },
	);

	const saveSource = useMutation(
		trpc.application.saveSource.mutationOptions({ onError: onMutationError }),
	);

	const createCompose = useSaveMutation(
		trpc.compose.create.mutationOptions({
			// Dynamic text, so it stays here instead of `successMessage`.
			onSuccess: (service) => toast.success(`Compose service "${service.name}" created`),
		}),
		{ invalidate: serviceKeys("compose"), onSuccess: closeDialog },
	);

	const handleDatabaseCreated = async (
		type: DatabaseType,
		serviceName: string,
		credentials: Record<string, string>,
	) => {
		toast.success(`${SERVICE_TYPE_META[type].label} "${serviceName}" created`);
		await invalidateServices(type);
		closeDialog();
		// Credentials are stored encrypted; show them once so the user can copy.
		setCreatedDatabase({ type, name: serviceName, credentials });
	};

	// NOTE: the database router factory spreads per-type credential fields
	// (databaseName, databaseUser, ...) into the zod schema at runtime, but
	// that spread is lost in the inferred AppRouter input types. Payloads are
	// cast (`as never`) to satisfy TS; the runtime schema accepts them.
	const createPostgres = useMutation(
		trpc.postgres.create.mutationOptions({ onError: onMutationError }),
	);
	const createMysql = useMutation(trpc.mysql.create.mutationOptions({ onError: onMutationError }));
	const createMariadb = useMutation(
		trpc.mariadb.create.mutationOptions({ onError: onMutationError }),
	);
	const createMongo = useMutation(trpc.mongo.create.mutationOptions({ onError: onMutationError }));
	const createRedis = useMutation(trpc.redis.create.mutationOptions({ onError: onMutationError }));

	const isDatabaseDialog = dialog !== null && dialog !== "application" && dialog !== "compose";
	const isPending =
		createApplication.isPending ||
		saveSource.isPending ||
		createCompose.isPending ||
		createPostgres.isPending ||
		createMysql.isPending ||
		createMariadb.isPending ||
		createMongo.isPending ||
		createRedis.isPending;

	/**
	 * Create the application, attach the source the dialog collected, then open
	 * it. Landing on the new service (rather than back on the list) is the point
	 * — it is where the next thing to do lives.
	 */
	const submitApplication = async (trimmed: string) => {
		const image = dockerImage.trim();
		const repository = gitUrl.trim();
		const branch = gitBranch.trim();
		try {
			const application = await createApplication.mutateAsync({
				name: trimmed,
				description: description.trim() || undefined,
				projectId,
				environmentName,
			});
			if (sourceKind === "docker" && image) {
				await saveSource.mutateAsync({
					applicationId: application.applicationId,
					sourceType: "docker",
					dockerImage: image,
				});
			} else if (sourceKind === "git" && repository) {
				await saveSource.mutateAsync({
					applicationId: application.applicationId,
					sourceType: "git",
					gitUrl: repository,
					gitBranch: branch || "main",
				});
			}
			router.push(
				`/dashboard/projects/${projectId}/services/application/${application.applicationId}`,
			);
		} catch {
			// Both mutations already toasted through `toastError`.
		}
	};

	const submit = () => {
		const trimmed = name.trim();
		if (!trimmed) return;
		if (dialog === "application") {
			void submitApplication(trimmed);
			return;
		}
		if (dialog === "compose") {
			createCompose.mutate(
				{
					name: trimmed,
					description: description.trim() || undefined,
					environmentId,
					composeType,
					sourceType: "raw",
				},
				{
					onSuccess: (service) =>
						router.push(`/dashboard/projects/${projectId}/services/compose/${service.composeId}`),
				},
			);
			return;
		}
		if (!dialog) return;
		const databaseDialog = dialog;
		const slug = slugify(trimmed).replace(/-/g, "_");
		const base = { name: trimmed, environmentId };
		// User-provided credentials win; blank fields are auto-generated.
		const fields = DATABASE_CREDENTIAL_FIELDS[databaseDialog];
		const values: Record<string, string> = {};
		const display: Record<string, string> = {};
		for (const field of fields) {
			const value = credentials[field.key]?.trim() || (field.secret ? randomSecret() : slug);
			values[field.key] = value;
			display[field.label] = value;
		}
		const onSuccess = (row: { name: string }) =>
			handleDatabaseCreated(databaseDialog, row.name, display);
		switch (databaseDialog) {
			case "postgres":
				createPostgres.mutate({ ...base, ...values } as never, { onSuccess });
				break;
			case "mysql":
				createMysql.mutate({ ...base, ...values } as never, { onSuccess });
				break;
			case "mariadb":
				createMariadb.mutate({ ...base, ...values } as never, { onSuccess });
				break;
			case "mongo":
				createMongo.mutate({ ...base, ...values } as never, { onSuccess });
				break;
			case "redis":
				createRedis.mutate({ ...base, ...values } as never, { onSuccess });
				break;
		}
	};

	const dialogTitle =
		dialog === null
			? ""
			: dialog === "application"
				? "Create application"
				: dialog === "compose"
					? "Create compose service"
					: `Create ${SERVICE_TYPE_META[dialog].label} database`;

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button disabled={disabled} title={disabled ? disabledReason : undefined}>
						<Plus className="size-4" />
						Add service
						<ChevronDown className="size-4" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-52">
					<DropdownMenuItem onSelect={() => setDialog("application")}>Application</DropdownMenuItem>
					<DropdownMenuItem onSelect={() => setDialog("compose")}>Compose</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuLabel className="text-xs text-muted-foreground">Databases</DropdownMenuLabel>
					{DATABASE_TYPES.map((type) => (
						<DropdownMenuItem key={type} onSelect={() => setDialog(type)}>
							{SERVICE_TYPE_META[type].label}
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>

			<Dialog
				open={dialog !== null}
				onOpenChange={(open) => {
					if (!open) {
						setDialog(null);
						resetForm();
					}
				}}
			>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>{dialogTitle}</DialogTitle>
						<DialogDescription>
							{isDatabaseDialog
								? "Credentials are optional — leave blank to auto-generate. They are shown once after creation."
								: `Add a new service to the "${environmentName}" environment.`}
						</DialogDescription>
					</DialogHeader>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							submit();
						}}
						className="flex flex-col gap-4"
					>
						<div className="flex flex-col gap-2">
							<Label htmlFor="service-name">Name</Label>
							<Input
								id="service-name"
								placeholder="my-service"
								value={name}
								onChange={(event) => setName(event.target.value)}
								autoFocus
							/>
						</div>
						{dialog === "compose" && (
							<div className="flex flex-col gap-2">
								<Label>Type</Label>
								<Select
									value={composeType}
									onValueChange={(value) => setComposeType(value as "docker-compose" | "stack")}
								>
									<SelectTrigger className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="docker-compose">Docker Compose</SelectItem>
										<SelectItem value="stack">Docker Stack (Swarm)</SelectItem>
									</SelectContent>
								</Select>
								<p className="text-sm text-muted-foreground">
									Compose runs <code>docker compose up</code>; Stack deploys through Swarm.{" "}
									<HelpLink slug="deploy" />
								</p>
							</div>
						)}
						{dialog === "application" && (
							<>
								<div className="flex flex-col gap-2">
									<Label htmlFor="service-source">Source</Label>
									<Select
										value={sourceKind}
										onValueChange={(value) => setSourceKind(value as SourceKind)}
									>
										<SelectTrigger id="service-source" className="w-full">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="docker">Docker image</SelectItem>
											<SelectItem value="git">Git repository</SelectItem>
											<SelectItem value="later">Set up later</SelectItem>
										</SelectContent>
									</Select>
								</div>
								{sourceKind === "docker" && (
									<div className="flex flex-col gap-2">
										<Label htmlFor="service-image">Docker image</Label>
										<Input
											id="service-image"
											placeholder="nginx:alpine"
											value={dockerImage}
											onChange={(event) => setDockerImage(event.target.value)}
											autoComplete="off"
										/>
									</div>
								)}
								{sourceKind === "git" && (
									<>
										<div className="flex flex-col gap-2">
											<Label htmlFor="service-git-url">Repository URL</Label>
											<Input
												id="service-git-url"
												placeholder="https://github.com/user/repo.git"
												value={gitUrl}
												onChange={(event) => setGitUrl(event.target.value)}
												autoComplete="off"
											/>
										</div>
										<div className="flex flex-col gap-2">
											<Label htmlFor="service-git-branch">Branch</Label>
											<Input
												id="service-git-branch"
												placeholder="main"
												value={gitBranch}
												onChange={(event) => setGitBranch(event.target.value)}
												autoComplete="off"
											/>
											<p className="text-sm text-muted-foreground">
												A repository behind a connected provider (private repos, pull-request
												previews) is picked on the service's General tab instead.
											</p>
										</div>
									</>
								)}
							</>
						)}
						{(dialog === "application" || dialog === "compose") && (
							<div className="flex flex-col gap-2">
								<Label htmlFor="service-description">Description</Label>
								<Textarea
									id="service-description"
									placeholder="Optional description"
									value={description}
									onChange={(event) => setDescription(event.target.value)}
									rows={3}
								/>
							</div>
						)}
						{isDatabaseDialog &&
							DATABASE_CREDENTIAL_FIELDS[dialog as DatabaseType].map((field) => (
								<div key={field.key} className="flex flex-col gap-2">
									<Label htmlFor={`credential-${field.key}`}>{field.label}</Label>
									<Input
										id={`credential-${field.key}`}
										placeholder={field.secret ? "Auto-generated" : slugify(name).replace(/-/g, "_")}
										value={credentials[field.key] ?? ""}
										onChange={(event) =>
											setCredentials((current) => ({
												...current,
												[field.key]: event.target.value,
											}))
										}
										autoComplete="off"
									/>
								</div>
							))}
						<DialogFooter>
							<Button
								type="submit"
								disabled={!name.trim() || isPending || disabled}
								title={disabled ? disabledReason : undefined}
							>
								{isPending ? "Creating..." : "Create"}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<Dialog
				open={createdDatabase !== null}
				onOpenChange={(open) => {
					if (!open) setCreatedDatabase(null);
				}}
			>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>
							{createdDatabase
								? `${SERVICE_TYPE_META[createdDatabase.type].label} credentials`
								: ""}
						</DialogTitle>
						<DialogDescription>
							Save these credentials for "{createdDatabase?.name}". They are stored encrypted and
							shown here only once.
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-3">
						{createdDatabase &&
							Object.entries(createdDatabase.credentials).map(([label, value]) => (
								<div key={label} className="flex flex-col gap-1.5">
									<Label htmlFor={`credential-${label}`}>{label}</Label>
									<div className="flex items-center gap-1">
										<Input
											id={`credential-${label}`}
											readOnly
											value={value}
											className="font-mono"
										/>
										<CopyButton value={value} label={`Copy ${label.toLowerCase()}`} />
									</div>
								</div>
							))}
					</div>
					<DialogFooter>
						<Button onClick={() => setCreatedDatabase(null)}>Done</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
