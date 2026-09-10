import { InstallCommand } from "@/components/install-command";
import { BlurFade } from "@/components/magicui/blur-fade";
import { Button, Container } from "@/components/ui";

export function Cta() {
	return (
		<section className="relative overflow-hidden py-24 sm:py-32">
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_60%_at_50%_100%,rgba(255,255,255,0.12),transparent_70%)]"
			/>
			<Container className="relative max-w-3xl text-center">
				<BlurFade inView>
					<h2 className="font-display text-3xl font-semibold tracking-tight text-balance text-foreground sm:text-5xl">
						Ready to own your deployment pipeline?
					</h2>
					<p className="mx-auto mt-4 max-w-xl text-sm text-muted sm:text-base">
						One Linux host, one command. Two minutes later you have the panel, the Traefik edge,
						Postgres — and a platform nobody can price-hike.
					</p>
					<div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
						<Button href="/docs/install" arrow>
							Install Nixploy
						</Button>
					</div>
					<div className="mx-auto mt-6 max-w-2xl">
						<InstallCommand className="w-full" />
					</div>
				</BlurFade>
			</Container>
		</section>
	);
}
