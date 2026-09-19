import { InstallCommand } from "@/components/install-command";
import { BlurFade } from "@/components/magicui/blur-fade";
import { Container, Pill } from "@/components/ui";
import { cn } from "@/lib/utils";

/*
 * The close, on every page: the claim, one sentence, the two actions and
 * the one-liner, centred, on the page colour. Nothing else.
 */
export function Cta({ compact = false }: { compact?: boolean }) {
	return (
		<section className={cn("border-t border-border", compact ? "py-24" : "py-32 lg:py-40")}>
			<Container>
				<BlurFade inView className="mx-auto flex max-w-[44rem] flex-col items-center text-center">
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
				</BlurFade>
			</Container>
		</section>
	);
}
