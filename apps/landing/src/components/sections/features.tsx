import { ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { BentoGrid } from "@/components/ui/bento-grid";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { productCaptures } from "@/lib/product-captures";

export function Features() {
	return (
		<section id="features" className="container-page py-20 lg:py-24">
			<div className="mb-10 max-w-2xl">
				<h2 className="text-3xl font-medium tracking-tight sm:text-4xl">
					Everything the next release needs.
				</h2>
				<p className="mt-4 text-base leading-relaxed text-muted-foreground">
					Build, ship and operate from one workspace. The infrastructure remains yours.
				</p>
			</div>
			<BentoGrid className="grid-cols-1 auto-rows-auto lg:grid-cols-3">
				<Card className="overflow-hidden lg:col-span-2">
					<CardHeader>
						<CardTitle>From commit to running service</CardTitle>
						<CardDescription>
							Choose your builder, follow the logs, inspect the release and roll back when you need
							to.
						</CardDescription>
					</CardHeader>
					<CardContent>
						{(["light", "dark"] as const).map((theme) => (
							<Image
								key={theme}
								src={productCaptures.deployments[theme]}
								alt={`Actual deployment history, ${theme} theme`}
								width={1440}
								height={1000}
								sizes="(min-width:1024px) 65vw, 100vw"
								className={`h-auto w-full rounded-md border ${theme === "light" ? "dark:hidden" : "hidden dark:block"}`}
							/>
						))}
					</CardContent>
					<CardFooter>
						<Button asChild variant="link">
							<Link href="/docs/deploy">
								Explore deployments
								<ArrowRight aria-hidden="true" data-icon="inline-end" />
							</Link>
						</Button>
					</CardFooter>
				</Card>
				<Card className="lg:col-span-1">
					<CardHeader>
						<CardTitle>One place for the whole stack</CardTitle>
						<CardDescription>
							Applications, Compose stacks and databases, grouped into isolated environments.
						</CardDescription>
					</CardHeader>
					<CardContent className="flex-1">
						<ul className="flex flex-col divide-y text-sm">
							{[
								"Git repositories and container images",
								"Five managed database engines",
								"Domains and automatic HTTPS",
								"Environment variables and secrets",
								"Backups and recovery",
							].map((item) => (
								<li key={item} className="py-4">
									{item}
								</li>
							))}
						</ul>
					</CardContent>
					<CardFooter>
						<Button asChild variant="link">
							<Link href="/features">
								View platform features
								<ArrowRight aria-hidden="true" data-icon="inline-end" />
							</Link>
						</Button>
					</CardFooter>
				</Card>
				<Card className="overflow-hidden lg:col-span-3">
					<div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,.7fr)_minmax(0,1.3fr)]">
						<div className="flex flex-col">
							<CardHeader>
								<CardTitle>Operations stay in context</CardTitle>
								<CardDescription>
									Find the service, inspect its health and open the right tool. Logs, metrics,
									domains and backups follow the same structure.
								</CardDescription>
							</CardHeader>
							<CardFooter className="mt-auto pt-6">
								<Button asChild variant="link">
									<Link href="/docs/observability">
										Read the monitoring guide
										<ArrowRight aria-hidden="true" data-icon="inline-end" />
									</Link>
								</Button>
							</CardFooter>
						</div>
						<CardContent>
							{(["light", "dark"] as const).map((theme) => (
								<Image
									key={theme}
									src={productCaptures.monitoring[theme]}
									alt={`Actual fleet monitoring, ${theme} theme`}
									width={1440}
									height={1000}
									sizes="(min-width:1024px) 60vw, 100vw"
									className={`h-auto w-full rounded-md border ${theme === "light" ? "dark:hidden" : "hidden dark:block"}`}
								/>
							))}
						</CardContent>
					</div>
				</Card>
			</BentoGrid>
		</section>
	);
}
