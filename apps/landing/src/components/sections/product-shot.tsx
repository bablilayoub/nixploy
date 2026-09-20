import { BorderBeam } from "@/components/ui/border-beam";
import { Safari } from "@/components/ui/safari";

/*
 * The panel itself, in @magicui/safari, lit by @magicui/border-beam. The
 * capture is a real instance taken by tools/screenshots.
 */
export function ProductShot() {
	return (
		<section className="relative pb-24">
			<div className="container-page">
				{/* The frame's image area has a fixed aspect and the capture is taller,
				    so `object-cover` slices the last row of the panel off with a hard
				    edge. The fade ends the shot instead of cutting it — and it takes
				    the beam with it, so the border does not stop in mid-air either. */}
				<div className="relative overflow-hidden rounded-[22px] [mask-image:linear-gradient(to_bottom,#000_72%,transparent_99%)]">
					<Safari
						url="panel.acme.dev"
						imageSrc="/screenshots/02-dashboard.png"
						imageAlt="The Nixploy panel: projects, services with their state, deployments in the last 24 hours and Docker containers"
						imageSizes="(min-width: 1360px) 1280px, 100vw"
						priority
						className="w-full"
					/>
					<BorderBeam
						duration={9}
						size={340}
						className="from-transparent via-foreground/60 to-transparent"
					/>
				</div>
			</div>
		</section>
	);
}
