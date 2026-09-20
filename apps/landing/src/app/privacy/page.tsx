import type { Metadata } from "next";

import { PageFrame } from "@/components/page-frame";
import { site } from "@/lib/site";

export const metadata: Metadata = {
	title: "Privacy — Nixploy",
	description: "How nixploy.com and the self-hosted product handle data.",
};

export default function PrivacyPage() {
	return (
		<PageFrame
			width="prose"
			eyebrow="Privacy"
			title="Your infrastructure. Your data."
			description="Nixploy is designed to run on servers you control."
		>
			<div className="prose prose-invert max-w-none prose-headings:font-display prose-a:text-primary">
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
			</div>
		</PageFrame>
	);
}
