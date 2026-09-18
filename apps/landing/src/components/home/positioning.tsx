import { BlurFade } from "@/components/magicui/blur-fade";
import { Section } from "@/components/ui";
import { positioning } from "@/lib/landing-data";

export function Positioning() {
	return (
		<Section id="positioning">
			<BlurFade inView>
				<h2 className="max-w-3xl font-display text-[1.9rem] leading-[1.15] font-semibold tracking-tight text-balance text-foreground sm:text-[2.5rem]">
					The simplicity of a PaaS.
					<br />
					<span className="text-muted">The control of your own infrastructure.</span>
				</h2>
			</BlurFade>

			<dl className="mt-14 grid border-t border-border sm:grid-cols-2 lg:grid-cols-3">
				{positioning.map((item, i) => (
					<BlurFade key={item.title} inView delay={0.03 * i}>
						<div className="h-full border-b border-border py-7 sm:px-6 sm:[&:nth-child(odd)]:pl-0 lg:border-l lg:px-6 lg:first:border-l-0 lg:[&:nth-child(3n+1)]:border-l-0 lg:[&:nth-child(3n+1)]:pl-0">
							<dt className="text-[15px] font-semibold tracking-tight text-foreground">
								{item.title}
							</dt>
							<dd className="mt-2 text-[13.5px] leading-relaxed text-muted">{item.body}</dd>
						</div>
					</BlurFade>
				))}
			</dl>
		</Section>
	);
}
