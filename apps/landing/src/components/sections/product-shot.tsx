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
				<div className="relative overflow-hidden rounded-[22px]">
					<Safari
						url="panel.acme.dev"
						imageSrc="/screenshots/02-dashboard.png"
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
