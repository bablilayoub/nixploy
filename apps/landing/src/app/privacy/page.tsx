import type { Metadata } from "next";

import { PageShell } from "@/components/page-shell";
import { Prose } from "@/components/ui";
import { site } from "@/lib/site";

export const metadata: Metadata = {
	title: "Privacy — Nixploy",
	description: "How nixploy.com and the self-hosted product handle data.",
};

/* The same reading shape as /about: headline header, 42rem column, `Prose`. */
export default function PrivacyPage() {
	return (
		<PageShell
			width="prose"
			align="left"
			size="headline"
			eyebrow="Privacy"
			title="Your infrastructure. Your data."
			description="Nixploy is designed to run on servers you control."
		>
			<Prose>
				<h2>Self-hosted product</h2>
				<p>
					When you install Nixploy, applications, databases, volumes, secrets, and logs stay on your
					machines. We do not receive your deploy traffic.
				</p>
				<h2>nixploy.com</h2>
				<p>
					The marketing site at {site.url} is static content. Server logs may include standard
					request metadata. We do not sell personal data.
				</p>
				<h2>Contact</h2>
				<p>
					Questions: <a href={`mailto:${site.email}`}>{site.email}</a>
				</p>
			</Prose>
		</PageShell>
	);
}
