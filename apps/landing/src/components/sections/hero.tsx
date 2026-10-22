import { ArrowRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { DeploymentPath } from "@/components/deployment-path";
import { Button } from "@/components/ui/button";
import { heroLead, heroTitle } from "@/lib/landing-data";
export function Hero() {
	return (
		<section className="signal-hero">
			<div className="signal-hero-glow" aria-hidden="true" />
			<div className="container-page relative">
				<div className="signal-hero-copy">
					<p className="signal-kicker">
						<span className="signal-dot" />
						The open-source deployment platform
					</p>
					<h1>
						{heroTitle[0]}
						<br />
						<span>{heroTitle[1]}</span>
					</h1>
					<p className="signal-hero-description">{heroLead}</p>
					<div className="signal-hero-actions">
						<Button asChild size="lg" className="signal-primary-action">
							<Link href="/docs/install">
								Install Nixploy
								<ArrowRight className="size-4" aria-hidden="true" />
							</Link>
						</Button>
						<Link href="#workspace" className="signal-text-action">
							Explore the platform
							<ArrowUpRight className="size-4" aria-hidden="true" />
						</Link>
					</div>
				</div>
				<DeploymentPath />
			</div>
		</section>
	);
}
