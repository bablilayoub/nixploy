"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

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
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { authClient } from "@/lib/auth-client";
import { type TwoFactorInput, twoFactorSchema } from "@/server/actions/auth.schema";

export function TwoFactorForm() {
	const router = useRouter();
	const form = useForm<TwoFactorInput>({
		resolver: zodResolver(twoFactorSchema),
		defaultValues: { code: "" },
	});

	async function onSubmit(values: TwoFactorInput) {
		const { error } = await authClient.twoFactor.verifyTotp({
			code: values.code,
		});
		if (error) {
			toast.error(error.message ?? "Verification failed");
			return;
		}
		toast.success("Verified");
		router.push("/dashboard");
		router.refresh();
	}

	return (
		<Card>
			<CardHeader className="text-center">
				<CardTitle className="text-xl">Two-factor authentication</CardTitle>
				<CardDescription>Enter the 6-digit code from your authenticator app</CardDescription>
			</CardHeader>
			<CardContent>
				<Form {...form}>
					<form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
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
			</CardContent>
		</Card>
	);
}
