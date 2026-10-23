import { publicBranding } from "@nixploy/server/modules/branding/index";
import Link from "next/link";
import { ModeToggle } from "@/components/mode-toggle";
import { Logo } from "@/components/shell/logo";

/** The shadcn login-03 composition; each auth flow retains its own Card and Form. */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
	const branding = await publicBranding();
	return (
		<div className="flex min-h-svh flex-col bg-muted/30">
			<header className="flex min-h-20 items-center justify-between gap-4 px-5 py-4 sm:px-8">
				<Link href="/" className="flex min-h-11 min-w-0 max-w-[calc(100%_-_56px)] items-center">
					<Logo />
				</Link>
				<ModeToggle />
			</header>
			<main
				id="main-content"
				className="flex flex-1 items-center justify-center px-4 py-10 sm:py-16"
			>
				<div className="w-full min-w-0 max-w-md">{children}</div>
			</main>
			<footer className="flex flex-col items-center gap-2 px-5 pb-6 text-center text-xs text-muted-foreground">
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
