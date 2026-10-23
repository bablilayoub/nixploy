"use client";
import { ArrowUpRight, Box, GitBranch, Globe, Layers } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const stages = [
	{
		Icon: GitBranch,
		name: "Your source",
		detail: "Git · image · Compose",
		explanation:
			"Connect a repository, use a prebuilt container image or bring a Compose stack. Keep the source of truth where you already work.",
		guide: "/docs/git",
	},
	{
		Icon: Box,
		name: "Build & package",
		detail: "Your builder. Your registry.",
		explanation:
			"Build from source or use an existing image. Choose Nixpacks, Railpack, a Dockerfile, buildpacks or a static build for your application.",
		guide: "/docs/deploy",
	},
	{
		Icon: Layers,
		name: "Deploy to Swarm",
		detail: "Services on your servers",
		explanation:
			"Run the service on your Docker Swarm. Follow the rollout, inspect runtime logs and keep a previous release available for rollback.",
		guide: "/docs/servers",
	},
	{
		Icon: Globe,
		name: "Route with Traefik",
		detail: "Your domain · automatic TLS",
		explanation:
			"Attach the hostname to its service. Traefik routes the request and manages the HTTPS certificate on the infrastructure you control.",
		guide: "/docs/domains",
	},
];
export function DeploymentPath({ compact = false }: { compact?: boolean }) {
	return (
		<Card className={compact ? "my-6" : "my-10"}>
			<CardHeader>
				<CardTitle>The deployment workflow</CardTitle>
				<CardDescription>
					Source, build, deploy and route on infrastructure you control.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Tabs defaultValue="1">
					<TabsList className="h-auto w-full flex-wrap justify-start">
						{stages.map((stage, index) => (
							<TabsTrigger
								key={stage.name}
								value={String(index)}
								className="min-h-11 max-w-full whitespace-normal text-left"
							>
								<stage.Icon aria-hidden="true" className="size-4" />
								{stage.name}
							</TabsTrigger>
						))}
					</TabsList>
					{stages.map((stage, index) => (
						<TabsContent key={stage.name} value={String(index)} className="pt-6">
							<p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
								{stage.explanation}
							</p>
							<Button asChild variant="link" className="mt-4">
								<Link href={stage.guide}>
									Read the guide
									<ArrowUpRight aria-hidden="true" data-icon="inline-end" />
								</Link>
							</Button>
						</TabsContent>
					))}
				</Tabs>
			</CardContent>
			<CardFooter>
				<p className="text-xs text-muted-foreground">Workflow reference · your infrastructure</p>
			</CardFooter>
		</Card>
	);
}
