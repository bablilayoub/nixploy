import { FoldBackdrop } from "@/components/fold-backdrop";
import { InstallCommand } from "@/components/install-command";
import { BlurFade } from "@/components/magicui/blur-fade";
import { Container, Pill } from "@/components/ui";
import { cn } from "@/lib/utils";

/*
 * The close, on every page: the claim, one sentence, the two actions and the
 * one-liner — inside the same graph paper the fold opens on, so the page ends
 * where it began instead of trailing off into a hairline.
 */
export function Cta({ compact = false }: { compact?: boolean }) {
	return (
		<section className={cn("pb-20 lg:pb-28", compact ? "pt-4" : "pt-8 lg:pt-12")}>
			<Container>
				<BlurFade inView>
					<div className="relative isolate overflow-hidden rounded-3xl border border-border bg-surface px-6 py-16 sm:px-12 lg:py-24">
						<FoldBackdrop className="-z-10" />
						<div className="mx-auto flex max-w-[44rem] flex-col items-center text-center">
							<h2 className="text-headline text-balance text-foreground lg:text-display">
								Rent the box. Keep the rest.
							</h2>
							<p className="mt-5 max-w-[38ch] text-lead text-balance text-muted">
								One command, three services, and the first account is yours.
							</p>
							<div className="mt-8 flex flex-wrap items-center justify-center gap-2">
								<Pill href="/docs/install" size="lg" arrow>
									Install Nixploy
								</Pill>
								<Pill href="/docs" variant="ghost" size="lg">
									Read the docs
								</Pill>
							</div>
							<InstallCommand className="mt-6 max-w-[36rem]" />
						</div>
					</div>
				</BlurFade>
			</Container>
		</section>
	);
}
