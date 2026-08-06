import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { site } from "@/lib/site";

export const metadata: Metadata = {
	title: "Privacy — Nixploy",
	description: "How nixploy.com and the self-hosted product handle data.",
};

export default function PrivacyPage() {
	return (
		<PageShell
			eyebrow="Privacy"
			title="Your infrastructure. Your data."
			description="Nixploy is designed to run on servers you control."
		>
			<div className="grid max-w-3xl gap-8 text-[15px] leading-relaxed text-neutral-400">
				<section className="space-y-2">
					<h2 className="text-lg font-semibold text-white">Self-hosted product</h2>
					<p>
						When you install Nixploy, applications, databases, volumes, secrets, and logs stay on
						your machines. We do not receive your deploy traffic.
					</p>
				</section>
				<section className="space-y-2">
					<h2 className="text-lg font-semibold text-white">nixploy.com</h2>
					<p>
						The marketing site at {site.url} is static content. Server logs may include standard
						request metadata. We do not sell personal data.
					</p>
				</section>
				<section className="space-y-2">
					<h2 className="text-lg font-semibold text-white">Contact</h2>
					<p>
						Questions:{" "}
						<a href={`mailto:${site.email}`} className="text-white underline underline-offset-4">
							{site.email}
						</a>
					</p>
				</section>
			</div>
		</PageShell>
	);
}
