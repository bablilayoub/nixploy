"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { authClient } from "@/lib/auth-client";
import { describeError } from "@/lib/describe-error";
import { safeNextPath } from "@/lib/safe-next-path";
import { type TwoFactorInput, twoFactorSchema } from "@/server/actions/auth.schema";

export function TwoFactorForm() {
	const router = useRouter();
	const [backupMode, setBackupMode] = useState(false);
	const [backupCode, setBackupCode] = useState("");
	const [backupPending, setBackupPending] = useState(false);
	const [backupError, setBackupError] = useState<string | null>(null);
	const searchParams = useSearchParams();
	// Login forwards its own `?next=` here so deep links survive the 2FA hop.
	const nextPath = safeNextPath(searchParams.get("next"));
	const form = useForm<TwoFactorInput>({
		resolver: zodResolver(twoFactorSchema),
		defaultValues: { code: "" },
	});

	async function onSubmit(values: TwoFactorInput) {
		try {
			const { error } = await authClient.twoFactor.verifyTotp({ code: values.code });
			if (error) throw error;
			toast.success("Verified");
			router.push(nextPath);
			router.refresh();
		} catch (error) {
			form.setError(
				"code",
				{ message: describeError(error, "Verification failed. Check the code and try again.") },
				{ shouldFocus: true },
			);
		}
	}

	async function verifyBackupCode(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (backupPending || !backupCode.trim()) return;
		setBackupPending(true);
		setBackupError(null);
		try {
			const { error } = await authClient.twoFactor.verifyBackupCode({ code: backupCode.trim() });
			if (error) {
				setBackupError(
					describeError(error, "This backup code could not be verified. Try another unused code."),
				);
				return;
			}
			setBackupCode("");
			toast.success("Verified");
			router.push(nextPath);
			router.refresh();
		} catch (error) {
			setBackupError(describeError(error, "Verification failed. Try again."));
		} finally {
			setBackupPending(false);
		}
	}

	return (
		<Card>
			<CardHeader className="text-center">
				<CardTitle as="h1" className="text-xl">
					Two-factor authentication
				</CardTitle>
				<div className="text-sm text-muted-foreground">
					{backupMode
						? "Use an unused backup code saved when you enabled two-factor authentication."
						: "Enter the 6-digit code from your authenticator app."}
				</div>
			</CardHeader>
			<CardContent>
				{backupMode ? (
					<form onSubmit={verifyBackupCode} className="grid gap-4">
						<Field>
							<FieldLabel htmlFor="backup-code">Backup code</FieldLabel>
							<Input
								id="backup-code"
								value={backupCode}
								onChange={(event) => {
									setBackupCode(event.target.value);
									setBackupError(null);
								}}
								required
								autoComplete="one-time-code"
								spellCheck={false}
								autoCapitalize="none"
								className="font-mono"
								aria-invalid={Boolean(backupError)}
								aria-describedby={
									backupError ? "backup-code-error backup-code-help" : "backup-code-help"
								}
								disabled={backupPending}
							/>
							<p id="backup-code-help" className="text-xs text-muted-foreground">
								Each code can be used once.
							</p>
							{backupError && (
								<p id="backup-code-error" role="alert" className="text-sm text-destructive">
									{backupError}
								</p>
							)}
						</Field>
						<Button type="submit" disabled={backupPending || !backupCode.trim()}>
							{backupPending ? "Verifying…" : "Verify backup code"}
						</Button>
					</form>
				) : (
					<Form {...form}>
						<form
							onSubmit={form.handleSubmit(onSubmit)}
							className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4"
						>
							<FormField
								control={form.control}
								name="code"
								render={({ field }) => (
									<FormItem className="flex flex-col items-center">
										<FormLabel className="sr-only">One-time code</FormLabel>
										<FormControl>
											<InputOTP maxLength={6} {...field}>
												<InputOTPGroup>
													<InputOTPSlot index={0} />
													<InputOTPSlot index={1} />
													<InputOTPSlot index={2} />
													<InputOTPSlot index={3} />
													<InputOTPSlot index={4} />
													<InputOTPSlot index={5} />
												</InputOTPGroup>
											</InputOTP>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
								{form.formState.isSubmitting ? "Verifying…" : "Verify"}
							</Button>
						</form>
					</Form>
				)}
				<div className="mt-6 border-t pt-4 text-center">
					<Button
						variant="ghost"
						type="button"
						disabled={backupPending || form.formState.isSubmitting}
						onClick={() => {
							setBackupMode(!backupMode);
							setBackupCode("");
							setBackupError(null);
							form.reset();
						}}
					>
						{backupMode ? "Use an authenticator code" : "Use a backup code"}
					</Button>
					<Button asChild variant="link" className="mt-1">
						<Link href={`/login?next=${encodeURIComponent(nextPath)}`}>Back to sign in</Link>
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}
