import Link from "next/link";
import { GithubIcon } from "@/components/icons";
import { TemplateLogo } from "@/components/template-logo";
import { BlurFade } from "@/components/ui/blur-fade";
import { Button } from "@/components/ui/button";
import { heroLead } from "@/lib/landing-data";
import { site } from "@/lib/site";

export function Hero() {
	return (
		<section className="reference-hero container-page">
			<BlurFade duration={0.35} blur="0px" offset={8}>
				<h1 className="reference-headline">
					<span>
						Your apps <TemplateLogo logo="n8n" name="n8n" size="hero" />
					</span>
					<span>
						and databases <TemplateLogo logo="postgresql" name="PostgreSQL" size="hero" />
					</span>
					<span>
						on your servers <TemplateLogo logo="docker" name="Docker" size="hero" />
					</span>
				</h1>
				<p className="reference-hero-lead">{heroLead}</p>
				<div className="mt-8 flex flex-wrap justify-center gap-2">
					<Button asChild size="lg">
						<Link href="/docs/install">Install Nixploy</Link>
					</Button>
					<Button asChild size="lg" variant="secondary">
						<a href={site.github} target="_blank" rel="noreferrer">
							View on GitHub <GithubIcon className="size-4" />
						</a>
					</Button>
				</div>
				<p className="mt-5 text-xs text-muted-foreground">Open source. Yours to run.</p>
			</BlurFade>
		</section>
	);
}
