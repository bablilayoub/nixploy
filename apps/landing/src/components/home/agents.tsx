import { BlurFade } from "@/components/magicui/blur-fade";
import { Button, Section, SectionHeading } from "@/components/ui";
import { agentTranscript } from "@/lib/landing-data";

/*
 * A terminal, not a graphic. The transcript is what an agent actually does over
 * MCP — the tools dispatch through the same routers as the panel, so the org
 * scope, the capability checks and the audit trail apply identically.
 */
export function Agents() {
	return (
		<Section id="agents">
			<div className="grid gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:items-center lg:gap-16">
				<BlurFade inView>
					<SectionHeading
						eyebrow="AI · MCP"
						title="Infrastructure your AI agents can operate"
						lede="Nixploy exposes itself through a REST API, a CLI and an MCP server, so a coding agent can deploy an application, read its logs, work out why it failed and manage the environment — with the same permissions and the same audit log as a person."
					/>
					<div className="mt-8">
						<Button href="/agents" variant="secondary" arrow>
							See what agents can do
						</Button>
					</div>
				</BlurFade>

				<BlurFade inView delay={0.1}>
					<div className="overflow-hidden rounded-xl border border-border bg-surface">
						<div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
							<span className="size-2.5 rounded-full bg-surface-3" />
							<span className="size-2.5 rounded-full bg-surface-3" />
							<span className="size-2.5 rounded-full bg-surface-3" />
							<span className="mx-auto font-mono text-[11px] text-muted-2">mcp · nixploy</span>
						</div>
						<div className="space-y-5 p-5 font-mono text-[13px] leading-relaxed sm:p-6">
							<div>
								<p className="text-[11px] tracking-[0.14em] text-muted-2 uppercase">User</p>
								<p className="mt-1.5 text-foreground">{agentTranscript.user}</p>
							</div>
							<div>
								<p className="text-[11px] tracking-[0.14em] text-muted-2 uppercase">Agent</p>
								<ul className="mt-1.5 space-y-1">
									{agentTranscript.agent.map((line) => (
										<li key={line} className="flex gap-2.5 text-muted">
											<span aria-hidden className="text-foreground">
												✓
											</span>
											{line}
										</li>
									))}
								</ul>
							</div>
						</div>
					</div>
				</BlurFade>
			</div>
		</Section>
	);
}
