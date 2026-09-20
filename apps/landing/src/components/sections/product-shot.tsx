import { BorderBeam } from "@/components/ui/border-beam";
import { Safari } from "@/components/ui/safari";

/*
 * The panel itself, in @magicui/safari, lit by @magicui/border-beam. The
 * capture is a real instance taken by tools/screenshots.
 */
export function ProductShot() {
	return (
		<section className="relative px-6 pb-24">
			<div className="relative mx-auto max-w-6xl overflow-hidden rounded-[22px]">
				<Safari url="panel.acme.dev" imageSrc="/screenshots/02-dashboard.png" className="w-full" />
				<BorderBeam
					duration={9}
					size={340}
					className="from-transparent via-primary to-transparent"
				/>
			</div>
			<div
				aria-hidden
				className="pointer-events-none mx-auto -mt-24 h-40 max-w-4xl bg-primary/20 blur-[120px]"
			/>
		</section>
	);
}
