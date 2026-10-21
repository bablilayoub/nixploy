import { publicBranding } from "@nixploy/server/modules/branding/index";
import { ArrowRight, GitBranch, Globe, Server, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { ModeToggle } from "@/components/mode-toggle";
import { Logo } from "@/components/shell/logo";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
	const branding = await publicBranding();
	return (
		<div className="fieldwork-auth">
			<aside className="fieldwork-auth-story">
				<Link href="/" className="max-w-full self-start">
					<Logo />
				</Link>
				<div className="fieldwork-auth-message">
					<h2>
						Your applications.
						<br />
						Your infrastructure.
					</h2>
					<p>Build, deploy and manage your services on the servers you control.</p>
					<div className="fieldwork-auth-path">
						<span>
							<GitBranch aria-hidden="true" className="size-4" />
							Repository
						</span>
						<ArrowRight aria-hidden="true" className="size-3" />
						<span>
							<Server aria-hidden="true" className="size-4" />
							Your server
						</span>
						<ArrowRight aria-hidden="true" className="size-3" />
						<span>
							<Globe aria-hidden="true" className="size-4" />
							Live service
						</span>
					</div>
				</div>
				<p className="flex items-center gap-2 text-xs text-muted-foreground">
					<ShieldCheck aria-hidden="true" className="size-3.5" />
					Self-hosted. Open source.
				</p>
			</aside>
			<div className="fieldwork-auth-side">
				<header className="flex min-h-20 items-center justify-between px-5 py-4 sm:px-8">
					<Link href="/" className="min-w-0 max-w-[calc(100%_-_56px)] lg:invisible">
						<Logo />
					</Link>
					<ModeToggle />
				</header>
				<main id="main-content" className="fieldwork-auth-form">
					<div>{children}</div>
				</main>
				<footer className="fieldwork-auth-footer space-y-2">
					{branding.footerText && <p>{branding.footerText}</p>}
					<div className="flex flex-wrap items-center justify-center gap-4">
						<a
							href={branding.docsUrl ?? "https://nixploy.com/docs"}
							target="_blank"
							rel="noreferrer"
							className="inline-flex min-h-11 items-center text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
						>
							Documentation
						</a>
						{branding.supportUrl && (
							<a
								href={branding.supportUrl}
								target="_blank"
								rel="noreferrer"
								className="inline-flex min-h-11 items-center text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
							>
								Support
							</a>
						)}
					</div>
				</footer>
			</div>
		</div>
	);
}
