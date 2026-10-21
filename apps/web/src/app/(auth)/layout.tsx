import { ArrowUpRight, GitBranch, Layers, Terminal } from "lucide-react";
import Link from "next/link";
import { ModeToggle } from "@/components/mode-toggle";
import { Logo } from "@/components/shell/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
	return (
		<div className="grid min-h-svh bg-background lg:grid-cols-2">
			<aside className="relative hidden flex-col justify-between border-e bg-sidebar p-12 lg:flex xl:p-16">
				<Link href="/" className="self-start">
					<Logo />
				</Link>
				<div className="my-16 max-w-md space-y-8">
					<p className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
						Your infrastructure. Your rules.
					</p>
					<h2 className="text-5xl leading-[1.08] font-semibold tracking-[-0.055em] xl:text-6xl">
						From first commit
						<br />
						to what’s next.
					</h2>
					<p className="max-w-sm text-base leading-relaxed text-muted-foreground">
						A considered home for your applications, databases, and the work behind them.
					</p>
					<div className="divide-y rounded-lg border bg-card px-5">
						{[
							{
								icon: GitBranch,
								title: "Push, build, deploy",
								detail: "A clear path from code to production.",
							},
							{
								icon: Layers,
								title: "Everything in context",
								detail: "Projects, environments, and services together.",
							},
							{
								icon: Terminal,
								title: "Stay in control",
								detail: "Your servers. An open source platform.",
							},
						].map(({ icon: Icon, title, detail }) => (
							<div key={title} className="flex gap-4 py-5">
								<Icon aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground" />
								<div className="space-y-1">
									<p className="text-sm font-medium">{title}</p>
									<p className="text-xs leading-relaxed text-muted-foreground">{detail}</p>
								</div>
							</div>
						))}
					</div>
				</div>
				<a
					href="https://nixploy.com/docs"
					target="_blank"
					rel="noreferrer"
					className="inline-flex min-h-11 items-center gap-2 self-start text-xs leading-relaxed break-words text-muted-foreground hover:text-foreground"
				>
					Read the documentation <ArrowUpRight className="size-3.5" />
				</a>
			</aside>
			<div className="flex min-w-0 flex-col">
				<header className="flex items-center justify-between p-5 sm:p-8">
					<Link href="/" className="lg:invisible">
						<Logo />
					</Link>
					<ModeToggle />
				</header>
				<main
					id="main-content"
					className="flex flex-1 items-center justify-center px-5 py-10 sm:px-10"
				>
					<div className="w-full max-w-md">{children}</div>
				</main>
				<footer className="px-5 py-6 text-center text-xs leading-relaxed break-words text-muted-foreground">
					Nixploy · Infrastructure, with intention.
				</footer>
			</div>
		</div>
	);
}
