import { BlurFade } from "@/components/magicui/blur-fade";
import { Container } from "@/components/ui";

export function Statement() {
	return (
		<section className="py-12 sm:py-20">
			<Container>
				<BlurFade inView>
					<p className="max-w-4xl font-display text-2xl leading-snug font-medium tracking-tight text-muted sm:text-3xl">
						Nixploy bridges the gap between your repository and your servers. Instead of juggling
						YAML, proxy configs and fragile shell scripts —{" "}
						<span className="text-foreground">
							Nixploy gives you Git push deploys, managed databases, TLS, monitoring and an API on a
							Swarm you control.
						</span>
					</p>
				</BlurFade>
			</Container>
		</section>
	);
}
