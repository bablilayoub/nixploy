import { BlurFade } from "@/components/magicui/blur-fade";
import { Section } from "@/components/ui";

export function Statement() {
	return (
		<Section>
			<BlurFade inView>
				<div className="grid gap-8 lg:grid-cols-[1fr_1fr] lg:gap-16">
					<h2 className="font-display text-[1.9rem] leading-[1.15] font-semibold tracking-tight text-balance text-foreground sm:text-[2.5rem]">
						Your infrastructure. Your servers. Your data.
					</h2>
					<div className="space-y-4 text-[15px] leading-relaxed text-muted sm:text-base">
						<p>
							Managed platforms are pleasant right up to the point where the bill scales with the
							number of things you run, and the things you run live somewhere you cannot reach.
						</p>
						<p>
							Nixploy gives you the same deployment experience — push a commit, get a URL, watch the
							logs, roll back when it goes wrong — on a Linux host you already pay for. The panel,
							the proxy, the database and the backups all sit on your disk, and underneath it is
							plain Docker Swarm and Traefik you can inspect yourself.
						</p>
					</div>
				</div>
			</BlurFade>
		</Section>
	);
}
