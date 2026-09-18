import { PanelPreview } from "@/components/home/panel-preview";
import { GithubIcon } from "@/components/icons";
import { InstallCommand } from "@/components/install-command";
import { BlurFade } from "@/components/magicui/blur-fade";
import { Button, Container } from "@/components/ui";
import { site } from "@/lib/site";

export function Hero() {
	return (
		<section className="relative pt-32 pb-20 sm:pt-40 sm:pb-24">
			<div className="bg-dots pointer-events-none absolute inset-x-0 top-0 h-[55vh]" aria-hidden />

			<Container className="relative">
				<div className="mx-auto max-w-3xl text-center">
					<BlurFade delay={0.05}>
						<p className="eyebrow">Open source · Self-hosted · Your infrastructure</p>
					</BlurFade>

					<BlurFade delay={0.1}>
						<h1 className="mt-6 font-display text-[2.4rem] leading-[1.06] font-semibold tracking-tight text-balance text-foreground sm:text-[3.75rem]">
							Deploy anything to your own servers.
						</h1>
					</BlurFade>

					<BlurFade delay={0.18}>
						<p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
							Nixploy turns your VPS into a modern deployment platform. Deploy applications,
							databases and services with the simplicity of a managed platform — while keeping your
							infrastructure under your control.
						</p>
					</BlurFade>

					<BlurFade delay={0.26}>
						<div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
							<Button href="/docs/install" className="w-full sm:w-auto">
								Get started
							</Button>
							<Button href={site.github} variant="secondary" external className="w-full sm:w-auto">
								<GithubIcon className="size-4" />
								View on GitHub
							</Button>
						</div>
					</BlurFade>

					<BlurFade delay={0.32}>
						<InstallCommand className="mx-auto mt-7 w-full max-w-[46rem]" />
					</BlurFade>
				</div>
			</Container>

			<Container className="relative">
				<BlurFade delay={0.4}>
					<PanelPreview className="mt-16 sm:mt-20" />
				</BlurFade>
			</Container>
		</section>
	);
}
