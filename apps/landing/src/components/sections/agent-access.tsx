import { ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { TemplateLogo } from "@/components/template-logo";
import { Button } from "@/components/ui/button";
import { productCaptures } from "@/lib/product-captures";
export function AgentAccess() {
	return (
		<section className="reference-section container-page">
			<div className="reference-agent-layout">
				<div>
					<h2>
						Give your agents
						<br />a workspace, too.
					</h2>
					<p className="mt-6 max-w-sm text-base leading-relaxed text-muted-foreground">
						Connect your AI tools to Nixploy. Inspect services, understand a failed build and
						prepare the next deployment through the same permission-checked API.
					</p>
					<div className="mt-7 flex flex-wrap gap-3">
						<Button asChild variant="secondary" size="lg">
							<Link href="/docs/mcp">
								Connect MCP <ArrowRight aria-hidden="true" className="size-4" />
							</Link>
						</Button>
						<Button asChild variant="ghost" size="lg">
							<Link href="/agents">See examples</Link>
						</Button>
					</div>
					<p className="mt-6 text-xs text-muted-foreground">
						42 tools · Your existing permissions · Your servers
					</p>
				</div>
				<div className="reference-agent-visual">
					<div className="reference-agent-prompt">
						<span className="text-xs text-muted-foreground">An example task</span>
						<p className="mt-2 text-sm">
							“Inspect the last deployment and help me understand what failed.”
						</p>
					</div>
					<div className="reference-agent-image">
						{(["light", "dark"] as const).map((theme) => (
							<Image
								key={theme}
								src={productCaptures.deployments[theme]}
								alt={`Nixploy deployment history, ${theme} theme`}
								width={1440}
								height={1000}
								sizes="800px"
								className={`h-auto max-w-none ${theme === "light" ? "dark:hidden" : "hidden dark:block"}`}
							/>
						))}
					</div>
					<div className="reference-agent-mark">
						<TemplateLogo logo="n8n" name="n8n" />
						<span className="text-sm">Your tools. Connected to your stack.</span>
					</div>
				</div>
			</div>
		</section>
	);
}
