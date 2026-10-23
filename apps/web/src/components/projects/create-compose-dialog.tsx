"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
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
import { describeError } from "@/lib/describe-error";
import { useTRPC } from "@/lib/trpc";

const MAX_COMPOSE_BYTES = 1_048_576;
type ComposeSource = "file" | "url" | "later";
type FormErrors = Partial<Record<"name" | "source" | "file" | "submit", string>>;

/** One creation path for paste, upload and URL. Nothing is deployed here. */
export function CreateComposeDialog({
	projectId,
	environmentId,
	environmentName,
	onClose,
	disabled,
	disabledReason,
}: {
	projectId: string;
	environmentId: string;
	environmentName: string;
	onClose: () => void;
	disabled?: boolean;
	disabledReason?: string;
}) {
	const trpc = useTRPC();
	const router = useRouter();
	const [name, setName] = useState("");
	const [source, setSource] = useState<ComposeSource>("file");
	const [composeFile, setComposeFile] = useState("");
	const [url, setUrl] = useState("");
	const [composeType, setComposeType] = useState<"docker-compose" | "stack">("docker-compose");
	const [description, setDescription] = useState("");
	const [errors, setErrors] = useState<FormErrors>({});
	const [readingFile, setReadingFile] = useState(false);
	const fileRead = useRef(0);
	const nameInput = useRef<HTMLInputElement>(null);
	const urlInput = useRef<HTMLInputElement>(null);
	const composeInput = useRef<HTMLTextAreaElement>(null);
	const errorSummary = useRef<HTMLParagraphElement>(null);

	useEffect(
		() => () => {
			fileRead.current += 1;
		},
		[],
	);

	const clearErrors = () => setErrors({});
	const onError = (error: unknown) => {
		setErrors({ submit: describeError(error) });
		requestAnimationFrame(() => errorSummary.current?.focus());
	};
	const afterCreate = (service: { composeId: string }) => {
		onClose();
		router.push(
			`/dashboard/projects/${projectId}/services/compose/${service.composeId}?tab=compose-file`,
		);
	};
	const mutationConfig = {
		invalidate: [
			trpc.compose.all.queryKey({ projectId, environmentName }),
			trpc.environment.byProject.queryKey({ projectId }),
			trpc.project.all.queryKey(),
		],
		successMessage: "Compose service created. Review the file and environment before deploying.",
		onSuccess: afterCreate,
	};
	const create = useSaveMutation(trpc.compose.create.mutationOptions({ onError }), mutationConfig);
	const createFromUrl = useSaveMutation(
		trpc.compose.createFromUrl.mutationOptions({ onError }),
		mutationConfig,
	);
	const pending = create.isPending || createFromUrl.isPending;

	const submit = () => {
		if (pending || readingFile || disabled) return;
		const validation: FormErrors = {};
		if (!name.trim()) validation.name = "Enter a service name.";
		if (source === "file") {
			if (!composeFile.trim()) validation.source = "Paste a Compose file or choose a YAML file.";
			else if (new TextEncoder().encode(composeFile).byteLength > MAX_COMPOSE_BYTES) {
				validation.source = "The Compose file must be 1 MiB or smaller.";
			}
		}
		if (source === "url") {
			try {
				const parsed = new URL(url.trim());
				if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
					throw new Error("invalid URL");
				}
			} catch {
				validation.source = "Enter a complete http(s) raw file URL without a username or password.";
			}
		}
		setErrors(validation);
		if (Object.keys(validation).length) {
			if (validation.name) nameInput.current?.focus();
			else if (source === "url") urlInput.current?.focus();
			else composeInput.current?.focus();
			return;
		}
		const input = {
			name: name.trim(),
			description: description.trim() || undefined,
			environmentId,
			composeType,
		};
		if (source === "url") createFromUrl.mutate({ ...input, url: url.trim() });
		else
			create.mutate({ ...input, sourceType: "raw", ...(source === "file" ? { composeFile } : {}) });
	};

	const readFile = async (file: File) => {
		const currentRead = ++fileRead.current;
		clearErrors();
		setReadingFile(false);
		if (file.size > MAX_COMPOSE_BYTES) {
			setErrors({ file: "Choose a YAML file that is 1 MiB or smaller." });
			return;
		}
		setReadingFile(true);
		try {
			const content = await file.text();
			if (currentRead !== fileRead.current) return;
			setComposeFile(content);
		} catch {
			if (currentRead === fileRead.current)
				setErrors({ file: "Could not read this file. Choose it again or paste its contents." });
		} finally {
			if (currentRead === fileRead.current) setReadingFile(false);
		}
	};

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !pending) onClose();
			}}
		>
			<DialogContent
				className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl"
				showCloseButton={!pending}
			>
				<DialogHeader>
					<DialogTitle>Create Compose service</DialogTitle>
					<DialogDescription>
						Add a Compose file to “{environmentName}”. Review it and configure environment variables
						before you deploy.
					</DialogDescription>
				</DialogHeader>
				<form
					noValidate
					className="flex flex-col gap-4"
					aria-busy={pending}
					onSubmit={(event) => {
						event.preventDefault();
						submit();
					}}
				>
					<fieldset disabled={pending} className="flex min-w-0 flex-col gap-4">
						<div className="flex flex-col gap-2">
							<Label htmlFor="compose-create-name">Name</Label>
							<Input
								ref={nameInput}
								className="min-h-11 sm:min-h-9"
								id="compose-create-name"
								name="name"
								autoComplete="off"
								maxLength={120}
								value={name}
								placeholder="my-stack"
								aria-invalid={!!errors.name}
								aria-describedby={errors.name ? "compose-name-error" : undefined}
								onChange={(event) => {
									setName(event.target.value);
									clearErrors();
								}}
							/>
							{errors.name && (
								<p id="compose-name-error" className="text-sm text-destructive">
									{errors.name}
								</p>
							)}
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="compose-create-source">Compose source</Label>
							<Select
								value={source}
								onValueChange={(value) => {
									fileRead.current += 1;
									setReadingFile(false);
									setSource(value as ComposeSource);
									clearErrors();
								}}
							>
								<SelectTrigger id="compose-create-source" className="min-h-11 w-full sm:min-h-9">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="file">Paste or upload a file</SelectItem>
									<SelectItem value="url">Raw file URL</SelectItem>
									<SelectItem value="later">Set up later</SelectItem>
								</SelectContent>
							</Select>
						</div>
						{source === "file" && (
							<div className="flex flex-col gap-2">
								<Label htmlFor="compose-create-file">Compose file</Label>
								<p id="compose-file-hint" className="text-xs text-muted-foreground">
									Paste YAML or load a .yml / .yaml file up to 1 MiB. You can edit it here before
									creating the service.
								</p>
								<Input
									type="file"
									className="min-h-11 sm:min-h-9"
									id="compose-create-upload"
									aria-label="Load Compose YAML file"
									accept=".yml,.yaml,text/yaml,application/yaml"
									aria-invalid={!!errors.file}
									aria-describedby={errors.file ? "compose-upload-error" : "compose-file-hint"}
									onChange={(event) => {
										const file = event.target.files?.[0];
										if (file) void readFile(file);
										event.target.value = "";
									}}
								/>
								{errors.file && (
									<p id="compose-upload-error" role="alert" className="text-sm text-destructive">
										{errors.file}
									</p>
								)}
								{readingFile && (
									<p role="status" className="text-xs text-muted-foreground">
										Reading file…
									</p>
								)}
								<Textarea
									ref={composeInput}
									id="compose-create-file"
									name="composeFile"
									value={composeFile}
									onChange={(event) => {
										fileRead.current += 1;
										setReadingFile(false);
										setComposeFile(event.target.value);
										clearErrors();
									}}
									onKeyDown={(event) => {
										if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
											event.preventDefault();
											submit();
										}
									}}
									placeholder={"services:\n  web:\n    image: nginx:alpine"}
									rows={8}
									spellCheck={false}
									autoCapitalize="off"
									autoCorrect="off"
									className="min-h-36 font-mono text-base sm:text-sm"
									aria-invalid={!!errors.source}
									aria-describedby={errors.source ? "compose-source-error" : "compose-file-hint"}
								/>
							</div>
						)}
						{source === "url" && (
							<div className="flex flex-col gap-2">
								<Label htmlFor="compose-create-url">Raw file URL</Label>
								<p id="compose-url-hint" className="text-xs text-muted-foreground">
									Use the file’s raw URL. Redirects and repository HTML pages are refused. Private
									addresses require private egress enabled by the instance admin. Fetched files can
									be up to 256 KiB.
								</p>
								<Input
									ref={urlInput}
									className="min-h-11 sm:min-h-9"
									id="compose-create-url"
									name="url"
									type="url"
									value={url}
									autoComplete="off"
									spellCheck={false}
									maxLength={2048}
									placeholder="https://raw.githubusercontent.com/owner/repo/main/compose.yaml"
									aria-invalid={!!errors.source}
									aria-describedby={errors.source ? "compose-source-error" : "compose-url-hint"}
									onChange={(event) => {
										setUrl(event.target.value);
										clearErrors();
									}}
								/>
							</div>
						)}
						{errors.source && (
							<p id="compose-source-error" role="alert" className="text-sm text-destructive">
								{errors.source}
							</p>
						)}
						<div className="flex flex-col gap-2">
							<Label htmlFor="compose-create-type">Runtime</Label>
							<Select
								value={composeType}
								onValueChange={(value) => {
									setComposeType(value as "docker-compose" | "stack");
									clearErrors();
								}}
							>
								<SelectTrigger id="compose-create-type" className="min-h-11 w-full sm:min-h-9">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="docker-compose">Docker Compose</SelectItem>
									<SelectItem value="stack">Docker Stack (Swarm)</SelectItem>
								</SelectContent>
							</Select>
							<p className="text-xs text-muted-foreground">
								Compose runs on one server. Stack schedules services through Swarm.{" "}
								<HelpLink slug="deploy" />
							</p>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="compose-create-description">Description (optional)</Label>
							<Input
								id="compose-create-description"
								className="min-h-11 sm:min-h-9"
								name="description"
								value={description}
								onChange={(event) => {
									setDescription(event.target.value);
									clearErrors();
								}}
							/>
						</div>
						<p className="rounded-md bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
							Creates one idle service. No containers start until you choose Deploy.{" "}
							{source !== "later" &&
								"Files with host binds, published ports or build instructions need changes or separate configuration; unsafe files are refused before creation."}
						</p>
					</fieldset>
					{errors.submit && (
						<p
							ref={errorSummary}
							tabIndex={-1}
							role="alert"
							className="rounded-md border border-destructive/30 p-3 text-sm text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring"
						>
							{errors.submit}
						</p>
					)}
					{disabled && disabledReason && (
						<p className="text-sm text-muted-foreground">{disabledReason}</p>
					)}
					<DialogFooter>
						<Button
							className="min-h-11 sm:min-h-9"
							type="button"
							variant="outline"
							disabled={pending}
							onClick={onClose}
						>
							Cancel
						</Button>
						<Button
							className="min-h-11 sm:min-h-9"
							type="submit"
							disabled={pending || readingFile || disabled}
							title={disabled ? disabledReason : undefined}
						>
							{pending && (
								<Loader2
									className="size-4 animate-spin motion-reduce:animate-none"
									aria-hidden="true"
								/>
							)}{" "}
							{pending ? "Creating…" : "Create service"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
