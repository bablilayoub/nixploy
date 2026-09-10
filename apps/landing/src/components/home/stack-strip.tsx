import { Marquee } from "@/components/magicui/marquee";
import { Container } from "@/components/ui";
import { stack } from "@/lib/landing-data";

function logoSrc(slug: string) {
	return `https://cdn.simpleicons.org/${slug}/a1a1aa`;
}

export function StackStrip() {
	return (
		<section className="py-10 sm:py-14">
			<Container>
				<p className="text-center text-xs tracking-[0.18em] text-muted-2 uppercase">
					Built on tools you already trust
				</p>
			</Container>
			<Marquee className="mt-8 [--gap:3.5rem]" duration="80s">
				{stack.map((item) => (
					<span
						key={item.name}
						className="inline-flex items-center gap-2.5 text-sm font-medium whitespace-nowrap text-muted"
					>
						{/* biome-ignore lint/performance/noImgElement: remote brand icons */}
						<img
							src={logoSrc(item.logo)}
							alt=""
							width={20}
							height={20}
							loading="lazy"
							className="size-5 opacity-80"
						/>
						{item.name}
					</span>
				))}
			</Marquee>
		</section>
	);
}
