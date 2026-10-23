import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { InstallCommand } from "@/components/install-command";
import { Button } from "@/components/ui/button";
import { site } from "@/lib/site";
export function Cta() {
	return (
		<section className="signal-cta">
			<div className="container-page text-center">
				<h2>
					Make room for
					<br />
					your next idea.
				</h2>
				<p className="mx-auto mt-6 max-w-md text-base leading-relaxed text-muted-foreground">
					One command on your Linux server.
					<br />
					Your apps, your data, your platform.
				</p>
				<div className="mt-8 flex flex-wrap justify-center gap-2">
					<Button asChild size="lg">
						<Link href="/docs/install">Install Nixploy</Link>
					</Button>
					<Button asChild variant="secondary" size="lg">
						<a href={site.github} target="_blank" rel="noreferrer">
							View source <ArrowUpRight aria-hidden="true" className="size-4" />
						</a>
					</Button>
				</div>
				<div className="mx-auto mt-10 max-w-2xl text-left">
					<InstallCommand />
				</div>
			</div>
		</section>
	);
}
