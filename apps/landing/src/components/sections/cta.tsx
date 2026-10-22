import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { InstallCommand } from "@/components/install-command";
import { Reveal } from "@/components/motion-provider";
export function Cta() {
	return (
		<section className="signal-cta">
			<div className="container-page">
				<Reveal className="signal-cta-inner">
					<div>
						<p className="signal-kicker">Your next deployment</p>
						<h2>
							Build something.
							<br />
							<span className="text-muted-foreground">Keep everything.</span>
						</h2>
						<p className="mt-5 max-w-md text-base leading-relaxed text-muted-foreground">
							An open platform on your own servers. No license key. No feature gates. Just your
							stack, ready to ship.
						</p>
						<Link href="/docs/install" className="signal-text-action mt-5">
							Read the installation guide
							<ArrowUpRight className="size-4" aria-hidden="true" />
						</Link>
					</div>
					<InstallCommand />
				</Reveal>
			</div>
		</section>
	);
}
