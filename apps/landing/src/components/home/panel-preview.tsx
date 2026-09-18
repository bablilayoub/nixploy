import {
	Boxes,
	Database,
	FileText,
	Gauge,
	Layers,
	LayoutGrid,
	Search,
	Server,
	Settings,
	Shield,
} from "lucide-react";

import { LogoMark } from "@/components/logo";
import { cn } from "@/lib/utils";

/*
 * The hero's product surface: the Nixploy panel drawn in the DOM rather than
 * shipped as a screenshot, so it stays crisp at any density, scales with the
 * layout and never goes stale. It is an illustration — exposed to assistive
 * technology as a single labelled image, not as a tree of fake controls.
 *
 * Vocabulary mirrors the real panel: the same navigation, the same service
 * kinds, the real deployment states (queued → running → done | error).
 * Greyscale only; status is carried by text and dot luminance, never by hue.
 */

const nav = [
	{ label: "Overview", icon: LayoutGrid, active: true },
	{ label: "Projects", icon: Boxes },
	{ label: "Services", icon: Layers },
	{ label: "Databases", icon: Database },
	{ label: "Servers", icon: Server },
	{ label: "Monitoring", icon: Gauge },
	{ label: "Logs", icon: FileText },
	{ label: "Backups", icon: Shield },
	{ label: "Settings", icon: Settings },
];

const stats = [
	{ label: "Projects", value: "12" },
	{ label: "Services", value: "34" },
	{ label: "Servers", value: "3" },
	{ label: "Deployments · 24h", value: "24" },
];

const deployments = [
	{
		service: "api",
		state: "Deployed",
		sha: "4f2a9c1",
		branch: "main",
		took: "1m 04s",
		when: "2m ago",
	},
	{
		service: "web",
		state: "Building",
		sha: "b81e40d",
		branch: "main",
		took: "38s",
		when: "5m ago",
	},
	{
		service: "worker",
		state: "Deployed",
		sha: "27c6aa5",
		branch: "main",
		took: "52s",
		when: "12m ago",
	},
	{
		service: "docs",
		state: "Failed",
		sha: "9ae13b7",
		branch: "release/2.4",
		took: "11s",
		when: "28m ago",
	},
];

const resources = [
	{ label: "CPU", value: "28%", fill: 28 },
	{ label: "Memory", value: "62%", fill: 62 },
	{ label: "Disk", value: "41%", fill: 41 },
];

const logLines = [
	{ time: "12:04:18", text: "api  listening on :3000" },
	{ time: "12:04:19", text: "api  connected to postgres (pool 10)" },
	{ time: "12:05:02", text: "web  GET /pricing 200 12ms" },
	{ time: "12:05:07", text: "api  POST /v1/orders 201 84ms" },
];

/** Status reads from the word first; the dot only reinforces it. */
function Status({ state }: { state: string }) {
	const deployed = state === "Deployed";
	const failed = state === "Failed";
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 whitespace-nowrap",
				deployed ? "text-[#e8e8ea]" : failed ? "text-[#84848c]" : "text-[#b4b4bb]",
			)}
		>
			<span
				className={cn(
					"size-1.5 rounded-full",
					deployed && "bg-[#e8e8ea]",
					failed && "bg-transparent ring-1 ring-[#84848c]",
					!deployed && !failed && "bg-[#84848c]",
				)}
			/>
			{state}
		</span>
	);
}

export function PanelPreview({ className }: { className?: string }) {
	return (
		<div
			role="img"
			aria-label="The Nixploy panel: an overview of twelve projects and thirty-four services across three servers, with the last four deployments, live CPU, memory and disk usage, and a tail of container logs."
			className={cn(
				"panel-glow overflow-hidden rounded-xl border border-[#242429] bg-[#0b0b0d] text-left text-[#e8e8ea]",
				className,
			)}
		>
			{/* window chrome */}
			<div className="flex items-center gap-2 border-b border-[#1c1c21] px-4 py-2.5">
				<span className="size-2.5 rounded-full bg-[#26262c]" />
				<span className="size-2.5 rounded-full bg-[#26262c]" />
				<span className="size-2.5 rounded-full bg-[#26262c]" />
				<span className="mx-auto truncate font-mono text-[11px] text-[#6e6e77]">
					panel.acme.dev
				</span>
			</div>

			<div className="flex">
				{/* sidebar */}
				<aside className="hidden w-[184px] shrink-0 flex-col border-r border-[#1c1c21] p-3 md:flex">
					<div className="flex items-center gap-2 px-2 pb-3">
						<LogoMark className="size-5" />
						<span className="text-[13px] font-semibold">Nixploy</span>
					</div>
					<div className="mb-3 flex items-center gap-2 rounded-md border border-[#22222a] px-2 py-1.5 text-[11.5px] text-[#9a9aa3]">
						<span className="grid size-4 shrink-0 place-items-center rounded bg-[#22222a] text-[8px]">
							A
						</span>
						Acme
					</div>
					<nav className="flex flex-col gap-0.5">
						{nav.map((item) => (
							<span
								key={item.label}
								className={cn(
									"flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[12.5px]",
									item.active ? "bg-[#1a1a20] text-[#e8e8ea]" : "text-[#8a8a93]",
								)}
							>
								<item.icon className="size-3.5" strokeWidth={1.8} />
								{item.label}
							</span>
						))}
					</nav>
				</aside>

				{/* main */}
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-3 border-b border-[#1c1c21] px-4 py-3 sm:px-5">
						<h3 className="mr-auto text-[15px] font-semibold tracking-tight">Overview</h3>
						<span className="hidden h-7 items-center gap-2 rounded-md border border-[#22222a] px-2.5 text-[11.5px] text-[#6e6e77] sm:inline-flex">
							<Search className="size-3" strokeWidth={2} />
							Search…
							<span className="rounded border border-[#26262c] px-1 font-mono text-[9px]">⌘K</span>
						</span>
						<span className="inline-flex h-7 items-center rounded-md bg-[#e8e8ea] px-2.5 text-[11.5px] font-semibold text-[#0b0b0d]">
							New project
						</span>
					</div>

					<div className="grid grid-cols-2 divide-x divide-[#1c1c21] border-b border-[#1c1c21] lg:grid-cols-4">
						{stats.map((stat) => (
							<div key={stat.label} className="px-4 py-3.5 sm:px-5">
								<p className="truncate text-[11px] tracking-wide text-[#6e6e77] uppercase">
									{stat.label}
								</p>
								<p className="mt-1 text-2xl font-semibold tracking-tight">{stat.value}</p>
							</div>
						))}
					</div>

					<div className="grid lg:grid-cols-[1.55fr_1fr]">
						{/* deployments table */}
						<div className="border-b border-[#1c1c21] lg:border-r lg:border-b-0">
							<p className="px-4 pt-4 pb-2 text-[11px] tracking-wide text-[#6e6e77] uppercase sm:px-5">
								Recent deployments
							</p>
							<table className="w-full text-left">
								<thead>
									<tr className="border-b border-[#1c1c21] text-[10.5px] tracking-wide text-[#6e6e77] uppercase">
										<th className="px-4 py-2 font-normal sm:px-5">Service</th>
										<th className="px-2 py-2 font-normal">Status</th>
										<th className="hidden px-2 py-2 font-normal sm:table-cell">Commit</th>
										<th className="hidden px-2 py-2 font-normal lg:table-cell">Duration</th>
										<th className="px-4 py-2 text-right font-normal sm:px-5">Updated</th>
									</tr>
								</thead>
								<tbody className="text-[12.5px]">
									{deployments.map((row) => (
										<tr key={row.service} className="border-b border-[#16161a] last:border-0">
											<td className="px-4 py-2.5 sm:px-5">{row.service}</td>
											<td className="px-2 py-2.5">
												<Status state={row.state} />
											</td>
											<td className="hidden px-2 py-2.5 font-mono text-[11.5px] text-[#8a8a93] sm:table-cell">
												{row.sha} · {row.branch}
											</td>
											<td className="hidden px-2 py-2.5 font-mono text-[11.5px] text-[#8a8a93] lg:table-cell">
												{row.took}
											</td>
											<td className="px-4 py-2.5 text-right text-[11.5px] text-[#6e6e77] sm:px-5">
												{row.when}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>

						{/* resource usage */}
						<div className="px-4 py-4 sm:px-5">
							<p className="text-[11px] tracking-wide text-[#6e6e77] uppercase">Resource usage</p>
							<dl className="mt-3 space-y-3.5">
								{resources.map((item) => (
									<div key={item.label}>
										<div className="flex items-baseline justify-between text-[12px]">
											<dt className="text-[#9a9aa3]">{item.label}</dt>
											<dd className="font-mono text-[11.5px]">{item.value}</dd>
										</div>
										<div className="mt-1.5 h-1 rounded-full bg-[#1c1c21]">
											<div
												className="h-full rounded-full bg-[#c9c9cf]"
												style={{ width: `${item.fill}%` }}
											/>
										</div>
									</div>
								))}
							</dl>
						</div>
					</div>

					{/* log tail */}
					<div className="border-t border-[#1c1c21] px-4 py-4 sm:px-5">
						<p className="text-[11px] tracking-wide text-[#6e6e77] uppercase">Logs</p>
						<ul className="mt-2.5 space-y-1.5 font-mono text-[11.5px] leading-relaxed">
							{logLines.map((line) => (
								<li key={`${line.time}-${line.text}`} className="flex gap-3">
									<span className="shrink-0 text-[#5e5e66]">{line.time}</span>
									<span className="truncate text-[#9a9aa3]">{line.text}</span>
								</li>
							))}
						</ul>
					</div>
				</div>
			</div>
		</div>
	);
}
