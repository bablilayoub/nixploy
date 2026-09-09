"use client";

import { Check, Copy, Loader2 } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SettingsSection } from "@/components/settings/settings-section";
import { StatusDot } from "@/components/shell";
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
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { authClient, useSession } from "@/lib/auth-client";

export function TwoFactorCard() {
	const { data: session, refetch } = useSession();
	const enabled = Boolean(
		(session?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled,
	);

	const [dialogOpen, setDialogOpen] = useState(false);
	const [password, setPassword] = useState("");
	const [totpURI, setTotpURI] = useState<string | null>(null);
	const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
	const [backupCodes, setBackupCodes] = useState<string[]>([]);
	const [code, setCode] = useState("");
	const [isPending, setIsPending] = useState(false);
	const [copied, setCopied] = useState(false);

	// Render the TOTP URI as a scannable QR once the secret is generated.
	useEffect(() => {
		if (!totpURI) {
			setQrDataUrl(null);
			return;
		}
		QRCode.toDataURL(totpURI, { margin: 1, width: 192 })
			.then(setQrDataUrl)
			.catch(() => setQrDataUrl(null));
	}, [totpURI]);

	function reset() {
		setPassword("");
		setTotpURI(null);
		setQrDataUrl(null);
		setBackupCodes([]);
		setCode("");
		setCopied(false);
	}

	async function enable() {
		setIsPending(true);
		const { data, error } = await authClient.twoFactor.enable({ password });
		setIsPending(false);
		if (error) {
			toast.error(error.message ?? "Failed to enable 2FA");
			return;
		}
		// better-auth ≥ 1.7 discriminates the response on `method`; Nixploy only
		// enrolls authenticator apps, so anything else is unexpected.
		if (data.method !== "totp") {
			toast.error("Unexpected two-factor method returned by the server");
			return;
		}
		setTotpURI(data.totpURI);
		setBackupCodes(data.backupCodes ?? []);
	}

	async function verify() {
		setIsPending(true);
		const { error } = await authClient.twoFactor.verifyTotp({ code });
		setIsPending(false);
		if (error) {
			toast.error(error.message ?? "Invalid code");
			return;
		}
		toast.success("Two-factor authentication enabled");
		setDialogOpen(false);
		reset();
		refetch();
	}

	async function disable() {
		setIsPending(true);
		const { error } = await authClient.twoFactor.disable({ password });
		setIsPending(false);
		if (error) {
			toast.error(error.message ?? "Failed to disable 2FA");
			return;
		}
		toast.success("Two-factor authentication disabled");
		setDialogOpen(false);
		reset();
		refetch();
	}

	async function copyUri() {
		if (!totpURI) return;
		await navigator.clipboard.writeText(totpURI);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}

	return (
		<>
			<SettingsSection
				title="Two-factor authentication"
				description="Secure your account with a TOTP authenticator app."
				actions={
					<div className="flex items-center gap-3">
						<span className="flex items-center gap-2 text-sm text-muted-foreground">
							<StatusDot status={enabled ? "success" : "neutral"} />
							{enabled ? "Enabled" : "Disabled"}
						</span>
						<Button
							size="sm"
							variant={enabled ? "outline" : "default"}
							className={
								enabled
									? "border-destructive/40 text-destructive hover:bg-destructive/10"
									: undefined
							}
							onClick={() => setDialogOpen(true)}
						>
							{enabled ? "Disable 2FA" : "Enable 2FA"}
						</Button>
					</div>
				}
			/>
			<Dialog
				open={dialogOpen}
				onOpenChange={(open) => {
					setDialogOpen(open);
					if (!open) reset();
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{enabled ? "Disable" : "Enable"} two-factor authentication</DialogTitle>
						<DialogDescription>
							{enabled
								? "Enter your password to disable two-factor authentication."
								: totpURI
									? "Scan the QR code with your authenticator app, then enter the 6-digit code."
									: "Enter your password to generate a TOTP secret."}
						</DialogDescription>
					</DialogHeader>

					{!totpURI && (
						<div className="grid gap-2">
							<Label htmlFor="twofa-password">Password</Label>
							<Input
								id="twofa-password"
								type="password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
							/>
						</div>
					)}

					{totpURI && !enabled && (
						<div className="grid min-w-0 gap-4">
							{qrDataUrl && (
								<div className="flex min-w-0 justify-center">
									{/* biome-ignore lint/performance/noImgElement: data-URL QR generated locally, next/image gains nothing */}
									<img
										src={qrDataUrl}
										alt="TOTP QR code"
										className="size-48 rounded-lg border bg-white p-2"
									/>
								</div>
							)}
							<div className="grid min-w-0 gap-2">
								<Label>Authenticator URI</Label>
								<div className="flex min-w-0 items-center gap-2">
									<code className="min-w-0 flex-1 truncate rounded-md border bg-muted px-3 py-2 text-xs">
										{totpURI}
									</code>
									<Button
										type="button"
										variant="outline"
										size="icon"
										aria-label="Copy authenticator URI"
										onClick={copyUri}
									>
										{copied ? <Check className="size-4" /> : <Copy className="size-4" />}
									</Button>
								</div>
							</div>
							{backupCodes.length > 0 && (
								<div className="grid min-w-0 gap-2">
									<Label>Backup codes</Label>
									<div className="grid grid-cols-2 gap-1 rounded-md border bg-muted p-3 font-mono text-xs">
										{backupCodes.map((backupCode) => (
											<span key={backupCode}>{backupCode}</span>
										))}
									</div>
									<p className="text-xs text-muted-foreground">
										Store these somewhere safe — they will not be shown again.
									</p>
								</div>
							)}
							<div className="grid min-w-0 gap-2">
								<Label>Verification code</Label>
								<InputOTP maxLength={6} value={code} onChange={(value) => setCode(value)}>
									<InputOTPGroup>
										<InputOTPSlot index={0} />
										<InputOTPSlot index={1} />
										<InputOTPSlot index={2} />
										<InputOTPSlot index={3} />
										<InputOTPSlot index={4} />
										<InputOTPSlot index={5} />
									</InputOTPGroup>
								</InputOTP>
							</div>
						</div>
					)}

					<DialogFooter>
						{enabled ? (
							<Button variant="destructive" disabled={isPending || !password} onClick={disable}>
								{isPending && <Loader2 className="size-4 animate-spin" />}
								Disable
							</Button>
						) : totpURI ? (
							<Button disabled={isPending || code.length !== 6} onClick={verify}>
								{isPending && <Loader2 className="size-4 animate-spin" />}
								Verify & enable
							</Button>
						) : (
							<Button disabled={isPending || !password} onClick={enable}>
								{isPending && <Loader2 className="size-4 animate-spin" />}
								Continue
							</Button>
						)}
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
