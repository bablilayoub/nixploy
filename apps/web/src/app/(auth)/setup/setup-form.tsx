"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import {
	AlertCircle,
	ArrowLeft,
	ArrowRight,
	Check,
	GitBranch,
	LayoutTemplate,
	Users,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/lib/describe-error";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { buildOrgSlug, type SetupOrgInput, setupOrgSchema } from "@/server/actions/auth.schema";

import { MIN_PASSWORD_LENGTH, PasswordStrengthHint } from "../password-strength";

/**
 * Owner step. Local (not `setupSchema`) because the first admin now also
 * carries the optional installer setup token and the 12-character floor
 * better-auth enforces for new passwords.
 */
const ownerSchema = z
	.object({
		name: z.string().min(1, "Name is required").max(64),
		email: z.email("Enter a valid email address"),
		password: z
			.string()
			.min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`),
		confirmPassword: z.string(),
		setupToken: z.string(),
	})
	.refine((data) => data.password === data.confirmPassword, {
		message: "Passwords do not match",
		path: ["confirmPassword"],
	});

type OwnerInput = z.infer<typeof ownerSchema>;

/** Header `user.create.before` reads the first-admin setup token from. */
const SETUP_TOKEN_HEADER = "x-nixploy-setup-token";

type WizardStep = "welcome" | "owner" | "org" | "ready";

const STEPS: WizardStep[] = ["welcome", "owner", "org", "ready"];

const STEP_LABELS: Record<WizardStep, string> = {
	welcome: "Welcome",
	owner: "Owner",
	org: "Organization",
	ready: "Ready",
};

/**
 * First-boot onboarding wizard: Welcome → Owner → Organization → Ready.
 * Public /register is removed; this is the only self-serve signup path.
 */
export function SetupForm() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const trpc = useTRPC();
	const [step, setStep] = useState<WizardStep>("welcome");
	const [formError, setFormError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [complete, setComplete] = useState(false);
	// Progress markers so a retry after a partial failure resumes instead of
	// re-running sign-up (which would fail with "user already exists").
	const [ownerCreated, setOwnerCreated] = useState(false);
	const [createdOrgId, setCreatedOrgId] = useState<string | null>(null);

	const status = useQuery(trpc.setup.needsSetup.queryOptions());

	useEffect(() => {
		if (status.data && !status.data.needsSetup) {
			router.replace("/login");
		}
	}, [status.data, router]);

	const ownerForm = useForm<OwnerInput>({
		resolver: zodResolver(ownerSchema),
		defaultValues: { name: "", email: "", password: "", confirmPassword: "", setupToken: "" },
		mode: "onSubmit",
	});
	const password = ownerForm.watch("password");
	const requiresSetupToken = status.data?.requiresSetupToken ?? false;

	// `/setup?token=…` — the installer prints the URL with the token appended.
	useEffect(() => {
		const fromQuery = searchParams.get("token");
		if (fromQuery && !ownerForm.getValues("setupToken")) {
			ownerForm.setValue("setupToken", fromQuery);
		}
	}, [searchParams, ownerForm]);

	const orgForm = useForm<SetupOrgInput>({
		resolver: zodResolver(setupOrgSchema),
		defaultValues: { orgName: "" },
		mode: "onSubmit",
	});

	const stepIndex = STEPS.indexOf(step);

	function goOwner() {
		setFormError(null);
		setStep("owner");
	}

	async function goOrgFromOwner() {
		setFormError(null);
		const ok = await ownerForm.trigger();
		if (!ok) return;
		const name = ownerForm.getValues("name").trim();
		const currentOrg = orgForm.getValues("orgName").trim();
		if (!currentOrg || currentOrg.endsWith("'s Org")) {
			orgForm.setValue("orgName", name ? `${name}'s Org` : "");
		}
		setStep("org");
	}

	async function goReadyFromOrg() {
		setFormError(null);
		const ok = await orgForm.trigger();
		if (!ok) return;
		setStep("ready");
	}

	async function createInstance() {
		setFormError(null);
		const ownerOk = await ownerForm.trigger();
		const orgOk = await orgForm.trigger();
		if (!ownerOk || !orgOk) {
			if (!ownerOk) setStep("owner");
			else setStep("org");
			return;
		}

		const owner = ownerForm.getValues();
		const { orgName } = orgForm.getValues();
		setSubmitting(true);
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Origin: window.location.origin,
			...(owner.setupToken?.trim() ? { [SETUP_TOKEN_HEADER]: owner.setupToken.trim() } : {}),
		};
		const readJson = async <T,>(res: Response): Promise<T | null> => {
			try {
				return (await res.json()) as T;
			} catch {
				return null;
			}
		};
		try {
			if (!ownerCreated) {
				const signupRes = await fetch("/api/auth/sign-up/email", {
					method: "POST",
					headers,
					body: JSON.stringify({
						name: owner.name.trim(),
						email: owner.email,
						password: owner.password,
					}),
				});
				const signup = await readJson<{ message?: string }>(signupRes);
				if (!signupRes.ok) {
					const msg = signup?.message ?? `Setup failed (${signupRes.status})`;
					toast.error(msg);
					setFormError(msg);
					setStep("owner");
					return;
				}
				setOwnerCreated(true);
			}

			let organizationId = createdOrgId;
			if (!organizationId) {
				const slug = buildOrgSlug(orgName);
				const orgRes = await fetch("/api/auth/organization/create", {
					method: "POST",
					headers,
					body: JSON.stringify({ name: orgName.trim(), slug }),
				});
				const org = await readJson<{ id?: string; message?: string }>(orgRes);
				if (!orgRes.ok || !org?.id) {
					const msg =
						org?.message ?? `Failed to create organization (${orgRes.status}) — try again`;
					toast.error(msg);
					setFormError(msg);
					setStep("org");
					return;
				}
				organizationId = org.id;
				setCreatedOrgId(org.id);
			}

			const setRes = await fetch("/api/auth/organization/set-active", {
				method: "POST",
				headers,
				body: JSON.stringify({ organizationId }),
			});
			if (!setRes.ok) {
				const setData = await readJson<{ message?: string }>(setRes);
				const msg =
					setData?.message ?? `Failed to activate organization (${setRes.status}) — try again`;
				toast.error(msg);
				setFormError(msg);
				return;
			}

			toast.success("Instance ready");
			setComplete(true);
		} catch (err) {
			const msg = describeError(err, "Network error");
			toast.error(msg);
			setFormError(msg);
		} finally {
			setSubmitting(false);
		}
	}

	function openDashboard() {
		router.push("/dashboard");
		router.refresh();
	}

	if (status.isPending) {
		return (
			<Card>
				<CardHeader className="text-center">
					<Skeleton className="mx-auto h-7 w-48" />
					<Skeleton className="mx-auto mt-2 h-4 w-64" />
				</CardHeader>
				<CardContent className="grid gap-4">
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
				</CardContent>
			</Card>
		);
	}

	if (status.data && !status.data.needsSetup) {
		return null;
	}

	return (
		<div className="flex flex-col gap-4">
			<StepIndicator current={step} />
			<Card>
				{step === "welcome" && (
					<>
						<CardHeader className="text-center">
							<CardTitle className="text-xl">Welcome to Nixploy</CardTitle>
							<CardDescription>
								Self-hosted PaaS on this server. A short setup creates your owner account and
								organization — public registration stays closed afterward.
							</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-4">
							<ul className="grid gap-2 text-sm text-muted-foreground">
								<li className="flex gap-2">
									<Check className="mt-0.5 size-4 shrink-0 text-foreground" />
									Owner account for this instance
								</li>
								<li className="flex gap-2">
									<Check className="mt-0.5 size-4 shrink-0 text-foreground" />
									Organization to hold projects and services
								</li>
								<li className="flex gap-2">
									<Check className="mt-0.5 size-4 shrink-0 text-foreground" />
									Invite teammates later from Settings
								</li>
							</ul>
							<Button type="button" className="w-full" onClick={goOwner}>
								Continue
								<ArrowRight className="size-4" />
							</Button>
						</CardContent>
					</>
				)}

				{step === "owner" && (
					<>
						<CardHeader className="text-center">
							<CardTitle className="text-xl">Owner account</CardTitle>
							<CardDescription>
								This is the first admin. You will sign in with this email and password.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<Form {...ownerForm}>
								<form
									onSubmit={ownerForm.handleSubmit(() => void goOrgFromOwner())}
									className="grid gap-4"
								>
									{formError && step === "owner" && <FormError message={formError} />}
									{ownerCreated && (
										<p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
											The owner account was already created. Changes here are not applied — continue
											to finish setting up the organization.
										</p>
									)}
									<FormField
										control={ownerForm.control}
										name="name"
										render={({ field }) => (
											<FormItem>
												<FormLabel>Name</FormLabel>
												<FormControl>
													<Input
														placeholder="Ada Lovelace"
														autoComplete="name"
														disabled={ownerCreated}
														{...field}
													/>
												</FormControl>
												<FormMessage />
											</FormItem>
										)}
									/>
									<FormField
										control={ownerForm.control}
										name="email"
										render={({ field }) => (
											<FormItem>
												<FormLabel>Email</FormLabel>
												<FormControl>
													<Input
														type="email"
														placeholder="you@example.com"
														autoComplete="email"
														disabled={ownerCreated}
														{...field}
													/>
												</FormControl>
												<FormMessage />
											</FormItem>
										)}
									/>
									<FormField
										control={ownerForm.control}
										name="password"
										render={({ field }) => (
											<FormItem>
												<FormLabel>Password</FormLabel>
												<FormControl>
													<Input
														type="password"
														autoComplete="new-password"
														disabled={ownerCreated}
														{...field}
													/>
												</FormControl>
												<FormMessage />
											</FormItem>
										)}
									/>
									<PasswordStrengthHint value={password} />
									<FormField
										control={ownerForm.control}
										name="confirmPassword"
										render={({ field }) => (
											<FormItem>
												<FormLabel>Confirm password</FormLabel>
												<FormControl>
													<Input
														type="password"
														autoComplete="new-password"
														disabled={ownerCreated}
														{...field}
													/>
												</FormControl>
												<FormMessage />
											</FormItem>
										)}
									/>
									{requiresSetupToken && (
										<FormField
											control={ownerForm.control}
											name="setupToken"
											render={({ field }) => (
												<FormItem>
													<FormLabel>Setup token</FormLabel>
													<FormControl>
														<Input
															placeholder="Printed by the installer"
															autoComplete="off"
															spellCheck={false}
															className="font-mono"
															disabled={ownerCreated}
															{...field}
														/>
													</FormControl>
													<p className="text-xs text-muted-foreground">
														This instance requires the token from{" "}
														<code className="font-mono">NIXPLOY_SETUP_TOKEN</code> (
														<code className="font-mono">/etc/nixploy/.env</code>) to claim the first
														admin account.
													</p>
													<FormMessage />
												</FormItem>
											)}
										/>
									)}
									<div className="flex gap-2">
										<Button
											type="button"
											variant="outline"
											className="flex-1"
											onClick={() => {
												setFormError(null);
												setStep("welcome");
											}}
										>
											<ArrowLeft className="size-4" />
											Back
										</Button>
										<Button type="submit" className="flex-1">
											Continue
											<ArrowRight className="size-4" />
										</Button>
									</div>
								</form>
							</Form>
						</CardContent>
					</>
				)}

				{step === "org" && (
					<>
						<CardHeader className="text-center">
							<CardTitle className="text-xl">Organization</CardTitle>
							<CardDescription>
								Projects, services, and teammates live under this organization.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<Form {...orgForm}>
								<form
									onSubmit={orgForm.handleSubmit(() => void goReadyFromOrg())}
									className="grid gap-4"
								>
									{formError && step === "org" && <FormError message={formError} />}
									{createdOrgId && (
										<p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
											The organization was already created — continue to finish setup.
										</p>
									)}
									<FormField
										control={orgForm.control}
										name="orgName"
										render={({ field }) => (
											<FormItem>
												<FormLabel>Organization name</FormLabel>
												<FormControl>
													<Input
														placeholder="Acme Ops"
														autoComplete="organization"
														disabled={Boolean(createdOrgId)}
														{...field}
													/>
												</FormControl>
												<FormMessage />
											</FormItem>
										)}
									/>
									<div className="flex gap-2">
										<Button
											type="button"
											variant="outline"
											className="flex-1"
											onClick={() => {
												setFormError(null);
												setStep("owner");
											}}
										>
											<ArrowLeft className="size-4" />
											Back
										</Button>
										<Button type="submit" className="flex-1">
											Continue
											<ArrowRight className="size-4" />
										</Button>
									</div>
								</form>
							</Form>
						</CardContent>
					</>
				)}

				{step === "ready" && !complete && (
					<>
						<CardHeader className="text-center">
							<CardTitle className="text-xl">Ready to create</CardTitle>
							<CardDescription>
								Confirm the details below. This creates your owner account and organization.
							</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-4">
							{formError && <FormError message={formError} />}
							<dl className="grid gap-3 rounded-lg border bg-muted/40 p-4 text-sm">
								<div className="grid gap-0.5">
									<dt className="text-muted-foreground">Owner</dt>
									<dd className="font-medium">{ownerForm.getValues("name").trim()}</dd>
									<dd className="text-muted-foreground">{ownerForm.getValues("email")}</dd>
								</div>
								<div className="grid gap-0.5">
									<dt className="text-muted-foreground">Organization</dt>
									<dd className="font-medium">{orgForm.getValues("orgName").trim()}</dd>
								</div>
							</dl>
							<div className="flex gap-2">
								<Button
									type="button"
									variant="outline"
									className="flex-1"
									disabled={submitting}
									onClick={() => {
										setFormError(null);
										setStep("org");
									}}
								>
									<ArrowLeft className="size-4" />
									Back
								</Button>
								<Button
									type="button"
									className="flex-1"
									disabled={submitting}
									onClick={() => void createInstance()}
								>
									{submitting ? "Creating…" : ownerCreated ? "Retry setup" : "Create instance"}
								</Button>
							</div>
						</CardContent>
					</>
				)}

				{step === "ready" && complete && (
					<>
						<CardHeader className="text-center">
							<CardTitle className="text-xl">You&apos;re in</CardTitle>
							<CardDescription>
								{orgForm.getValues("orgName").trim()} is ready. Here&apos;s a sensible next path.
							</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-4">
							<ul className="grid gap-3 text-sm">
								<li className="flex gap-3">
									<LayoutTemplate className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
									<span>
										<span className="font-medium text-foreground">Deploy something small</span>
										<span className="block text-muted-foreground">
											Templates or a Docker image like traefik/whoami.
										</span>
									</span>
								</li>
								<li className="flex gap-3">
									<GitBranch className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
									<span>
										<span className="font-medium text-foreground">Connect Git</span>
										<span className="block text-muted-foreground">
											Settings → Git providers for GitHub, GitLab, and more.
										</span>
									</span>
								</li>
								<li className="flex gap-3">
									<Users className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
									<span>
										<span className="font-medium text-foreground">Invite teammates later</span>
										<span className="block text-muted-foreground">
											Settings → Organization when you need help.
										</span>
									</span>
								</li>
							</ul>
							<Button type="button" className="w-full" onClick={openDashboard}>
								Open dashboard
							</Button>
						</CardContent>
					</>
				)}
			</Card>
			<p className="text-center text-xs text-muted-foreground">
				Step {Math.min(stepIndex + 1, STEPS.length)} of {STEPS.length}
				{step !== "welcome" ? ` · ${STEP_LABELS[step]}` : null}
			</p>
		</div>
	);
}

function StepIndicator({ current }: { current: WizardStep }) {
	const currentIndex = STEPS.indexOf(current);
	return (
		<ol className="flex items-center justify-center gap-2" aria-label="Setup progress">
			{STEPS.map((id, index) => {
				const done = index < currentIndex;
				const active = index === currentIndex;
				return (
					<li key={id} className="flex items-center gap-2">
						<span
							className={cn(
								"flex size-7 items-center justify-center rounded-full text-xs font-medium tabular-nums",
								done && "bg-primary text-primary-foreground",
								active && "bg-foreground text-background",
								!done && !active && "bg-muted text-muted-foreground",
							)}
							aria-current={active ? "step" : undefined}
						>
							{done ? <Check className="size-3.5" /> : index + 1}
						</span>
						{index < STEPS.length - 1 ? (
							<span className={cn("h-px w-6 sm:w-8", done ? "bg-primary" : "bg-border")} />
						) : null}
					</li>
				);
			})}
		</ol>
	);
}

function FormError({ message }: { message: string }) {
	return (
		<div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
			<AlertCircle className="size-4 shrink-0" />
			{message}
		</div>
	);
}
