"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
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
import { authClient, useSession } from "@/lib/auth-client";
import { describeError } from "@/lib/describe-error";
import { useTRPC } from "@/lib/trpc";

import { MIN_PASSWORD_LENGTH, PasswordStrengthHint } from "../../password-strength";

const acceptSchema = z
	.object({
		name: z.string().min(1, "Name is required").max(64),
		email: z.email("Enter the email address this invitation was sent to"),
		password: z
			.string()
			.min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`),
		confirmPassword: z.string(),
	})
	.refine((data) => data.password === data.confirmPassword, {
		message: "Passwords do not match",
		path: ["confirmPassword"],
	});

type AcceptInput = z.infer<typeof acceptSchema>;

/**
 * Mirror of `maskEmail` in packages/server/src/modules/auth/setup.ts. The
 * preview deliberately never returns the invitee's full address (a leaked
 * invite link must not disclose it), so the signed-in check compares masks.
 */
function maskEmail(email: string): string {
	const trimmed = email.trim();
	const at = trimmed.lastIndexOf("@");
	if (at <= 0) return "\u2022\u2022\u2022";
	const local = trimmed.slice(0, at);
	const domain = trimmed.slice(at);
	const visible = local.slice(0, Math.min(2, local.length));
	return `${visible}${"\u2022".repeat(Math.max(3, local.length - visible.length))}${domain}`;
}

async function acceptAndActivate(invitationId: string) {
	const { error: acceptError } = await authClient.organization.acceptInvitation({
		invitationId,
	});
	if (acceptError) {
		throw new Error(acceptError.message ?? "Failed to accept invitation");
	}
}

export function AcceptInvitationForm({ invitationId }: { invitationId: string }) {
	const router = useRouter();
	const trpc = useTRPC();
	const { data: session, isPending: isSessionPending } = useSession();
	const [formError, setFormError] = useState<string | null>(null);
	const [accepting, setAccepting] = useState(false);

	const preview = useQuery(trpc.setup.invitationPreview.queryOptions({ invitationId }));

	const form = useForm<AcceptInput>({
		resolver: zodResolver(acceptSchema),
		defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
	});
	const password = form.watch("password");

	const invitation = preview.data?.ok ? preview.data.invitation : null;

	async function joinExistingSession() {
		if (!invitation || !session?.user) return;
		setFormError(null);
		setAccepting(true);
		try {
			if (maskEmail(session.user.email.toLowerCase()) !== invitation.emailMasked.toLowerCase()) {
				throw new Error(
					`This invitation is for ${invitation.emailMasked}. Sign out and open the link again, or sign in as that user.`,
				);
			}
			await acceptAndActivate(invitation.invitationId);
			toast.success(`Joined ${invitation.organizationName}`);
			router.push("/dashboard");
			router.refresh();
		} catch (err) {
			const msg = describeError(err, "Failed to join");
			toast.error(msg);
			setFormError(msg);
		} finally {
			setAccepting(false);
		}
	}

	async function onSubmit(values: AcceptInput) {
		if (!invitation) return;
		setFormError(null);
		try {
			// Sign-up for an invited address is only allowed when the request
			// carries the invitation id (verified server-side in user.create.before).
			const signupRes = await fetch("/api/auth/sign-up/email", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Origin: window.location.origin,
					"x-nixploy-invitation-id": invitation.invitationId,
				},
				body: JSON.stringify({
					name: values.name.trim(),
					email: values.email.trim(),
					password: values.password,
				}),
			});
			const signup = (await signupRes.json()) as { message?: string };
			if (!signupRes.ok) {
				const msg = signup.message ?? `Sign up failed (${signupRes.status})`;
				toast.error(msg);
				setFormError(msg);
				return;
			}

			await acceptAndActivate(invitation.invitationId);
			toast.success(`Joined ${invitation.organizationName}`);
			router.push("/dashboard");
			router.refresh();
		} catch (err) {
			const msg = describeError(err, "Network error");
			toast.error(msg);
			setFormError(msg);
		}
	}

	if (preview.isPending || isSessionPending) {
		return (
			<section className="flex min-w-0 flex-col gap-8">
				<header className="space-y-3 text-center">
					<Skeleton className="mx-auto h-7 w-48" />
					<Skeleton className="mx-auto mt-2 h-4 w-64" />
				</header>
				<div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
				</div>
			</section>
		);
	}

	if (!invitation) {
		return (
			<section className="flex min-w-0 flex-col gap-8">
				<header className="space-y-3 text-center">
					<h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
						Invitation unavailable
					</h1>
					<div className="text-sm text-muted-foreground">
						This link is invalid, expired, or already used. Ask an admin for a new invite.
					</div>
				</header>
				<div>
					<Button asChild className="w-full" variant="outline">
						<Link href="/login">Go to sign in</Link>
					</Button>
				</div>
			</section>
		);
	}

	if (session?.user) {
		const emailMatches =
			maskEmail(session.user.email.toLowerCase()) === invitation.emailMasked.toLowerCase();
		return (
			<section className="flex min-w-0 flex-col gap-8">
				<header className="space-y-3 text-center">
					<h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
						Join {invitation.organizationName}
					</h1>
					<div className="text-sm text-muted-foreground">
						You&apos;re signed in as {session.user.email}. Role:{" "}
						<span className="capitalize">{invitation.role ?? "member"}</span>.
					</div>
				</header>
				<div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
					{formError && (
						<div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
							<AlertCircle className="size-4 shrink-0" />
							{formError}
						</div>
					)}
					{emailMatches ? (
						<Button className="w-full" disabled={accepting} onClick={joinExistingSession}>
							{accepting && <Loader2 className="size-4 animate-spin" />}
							Accept invitation
						</Button>
					) : (
						<>
							<p className="text-sm text-muted-foreground">
								This invitation is for <strong>{invitation.emailMasked}</strong>. Sign out and open
								the link again, or sign in with that account.
							</p>
							<Button asChild variant="outline" className="w-full">
								<Link href="/login">Go to sign in</Link>
							</Button>
						</>
					)}
				</div>
			</section>
		);
	}

	return (
		<section className="flex min-w-0 flex-col gap-8">
			<header className="space-y-3 text-center">
				<h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
					Join {invitation.organizationName}
				</h1>
				<div className="text-sm text-muted-foreground">
					Create your account to accept this invitation as{" "}
					<span className="capitalize">{invitation.role ?? "member"}</span>.
				</div>
			</header>
			<div>
				<Form {...form}>
					<form
						onSubmit={form.handleSubmit(onSubmit)}
						className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4"
					>
						{formError && (
							<div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
								<AlertCircle className="size-4 shrink-0" />
								{formError}
							</div>
						)}
						<FormField
							control={form.control}
							name="email"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Email</FormLabel>
									<FormControl>
										<Input
											type="email"
											placeholder={invitation.emailMasked}
											autoComplete="email"
											{...field}
										/>
									</FormControl>
									<p className="text-xs leading-relaxed break-words text-muted-foreground">
										Type the address this invitation was sent to ({invitation.emailMasked}).
									</p>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="name"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Name</FormLabel>
									<FormControl>
										<Input placeholder="Ada Lovelace" autoComplete="name" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="password"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Password</FormLabel>
									<FormControl>
										<Input type="password" autoComplete="new-password" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<PasswordStrengthHint value={password} />
						<FormField
							control={form.control}
							name="confirmPassword"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Confirm password</FormLabel>
									<FormControl>
										<Input type="password" autoComplete="new-password" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
							{form.formState.isSubmitting ? "Creating account…" : "Create account & join"}
						</Button>
						<p className="text-center text-sm text-muted-foreground">
							Already have an account?{" "}
							<Link
								href={`/login?next=${encodeURIComponent(`/accept-invitation/${invitationId}`)}`}
								className="underline underline-offset-4 hover:text-foreground"
							>
								Sign in
							</Link>
						</p>
					</form>
				</Form>
			</div>
		</section>
	);
}
