import { publicBranding } from "@nixploy/server/modules/branding/index";
import Link from "next/link";
import { ModeToggle } from "@/components/mode-toggle";
import { Logo } from "@/components/shell/logo";

/** Official login-03 page composition, shared by all account flows. */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
	const branding = await publicBranding();
	return (
		<div className="auth-workspace flex min-h-svh flex-col bg-muted">
			<header className="flex justify-end p-4">
				<ModeToggle />
			</header>
			<main
				id="main-content"
				className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-8 md:p-10"
			>
				<div className="flex w-full min-w-0 max-w-sm flex-col gap-6">
					<Link href="/" className="flex min-h-11 max-w-full items-center self-center">
						<Logo />
					</Link>
					{children}
				</div>
			</main>
			<footer className="flex flex-col items-center gap-2 px-6 pb-6 text-center text-xs text-muted-foreground">
				{branding.footerText && <p className="max-w-xl break-words">{branding.footerText}</p>}
				<div className="flex flex-wrap justify-center gap-6">
					<a
						href={branding.docsUrl ?? "https://nixploy.com/docs"}
						target="_blank"
						rel="noreferrer"
						className="inline-flex min-h-11 items-center underline-offset-4 hover:underline"
					>
						Documentation
					</a>
					{branding.supportUrl && (
						<a
							href={branding.supportUrl}
							target="_blank"
							rel="noreferrer"
							className="inline-flex min-h-11 items-center underline-offset-4 hover:underline"
						>
							Support
						</a>
					)}
				</div>
			</footer>
		</div>
	);
}
