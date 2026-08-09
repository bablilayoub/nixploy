"use client";

import { BlurFade } from "@/components/magicui/blur-fade";

const steps = [
	{
		n: "1",
		title: "Connect a repo",
		body: "GitHub, GitLab, Bitbucket, Gitea — or a plain Git URL. Pick the branch and the builder: Nixpacks, buildpacks, Dockerfile, static site, or a prebuilt image.",
	},
	{
		n: "2",
		title: "Push",
		body: "The webhook fires and the build queues. Fork pull requests wait for your approval before anything runs on your host.",
	},
	{
		n: "3",
		title: "Rollout",
		body: "Swarm updates the service with zero downtime and Traefik re-routes traffic. A failed deploy leaves the previous version untouched.",
	},
	{
		n: "4",
		title: "Watch",
		body: "Logs and metrics stream into the panel immediately. Roll back from the same screen if you need to.",
	},
] as const;

const terminalLines = [
	{ text: "$ git push origin main", tone: "cmd" },
	{ text: "→ webhook received · build #42 queued", tone: "dim" },
	{ text: "→ nixpacks · detected node 22, pnpm workspace", tone: "dim" },
	{ text: "→ image built in 38s · pushed to local registry", tone: "dim" },
	{ text: "→ service web updated · 3/3 replicas healthy", tone: "ok" },
	{ text: "→ https://app.example.com is live", tone: "ok" },
] as const;

export function DeployFlow() {
	return (
		<section className="border-t border-white/8 py-20 sm:py-28">
			<div className="mx-auto max-w-6xl px-5 sm:px-6">
				<div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
					<BlurFade>
						<div>
							<p className="font-mono text-xs tracking-[0.18em] text-neutral-500 uppercase">
								How a deploy goes out
							</p>
							<h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
								git push is the whole workflow.
							</h2>
							<ol className="mt-10 space-y-8">
								{steps.map((step) => (
									<li key={step.n} className="flex gap-4">
										<span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 font-mono text-sm text-neutral-300">
											{step.n}
										</span>
										<div>
											<h3 className="font-display text-base font-semibold text-white">
												{step.title}
											</h3>
											<p className="mt-1.5 max-w-md text-sm leading-relaxed text-neutral-400">
												{step.body}
											</p>
										</div>
									</li>
								))}
							</ol>
						</div>
					</BlurFade>

					<BlurFade delay={0.12} className="lg:pt-24">
						<div className="overflow-hidden rounded-xl border border-white/10 bg-[#0a0a0a]">
							<div className="flex items-center gap-1.5 border-b border-white/8 px-4 py-3">
								<span className="size-2.5 rounded-full bg-white/10" />
								<span className="size-2.5 rounded-full bg-white/10" />
								<span className="size-2.5 rounded-full bg-white/10" />
								<span className="ml-3 font-mono text-xs text-neutral-500">your terminal</span>
							</div>
							<div className="space-y-2.5 p-5 font-mono text-[13px] leading-relaxed">
								{terminalLines.map((line) => (
									<p
										key={line.text}
										className={
											line.tone === "cmd"
												? "text-white"
												: line.tone === "ok"
													? "text-emerald-400/90"
													: "text-neutral-500"
										}
									>
										{line.text}
									</p>
								))}
							</div>
						</div>
						<p className="mt-4 text-sm text-neutral-500">
							Prefer a terminal for everything?{" "}
							<span className="text-neutral-300">@nixploy/cli</span> covers the full API — and the
							MCP server lets your AI assistant deploy and inspect for you.
						</p>
					</BlurFade>
				</div>
			</div>
		</section>
	);
}
