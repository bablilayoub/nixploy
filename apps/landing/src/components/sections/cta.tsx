import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { InstallCommand } from "@/components/install-command";
import { Button } from "@/components/ui/button";
export function Cta() {
	return (
		<section className="signal-cta border-t">
			<div className="container-page grid min-w-0 items-center gap-8 lg:grid-cols-2">
				<div>
					<h2 className="text-3xl font-medium tracking-tight">Your next deployment starts here.</h2>
					<p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
						One command on a Linux server. No license key, no per-seat charge, no feature gates.
					</p>
					<Button asChild variant="link" className="mt-5">
						<Link href="/docs/install">
							Read the installation guide
							<ArrowRight aria-hidden="true" data-icon="inline-end" />
						</Link>
					</Button>
				</div>
				<InstallCommand />
			</div>
		</section>
	);
}
