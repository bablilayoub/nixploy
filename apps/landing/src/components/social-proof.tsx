"use client";

import { BlurFade } from "@/components/magicui/blur-fade";
import { IconCloud } from "@/components/magicui/icon-cloud";
import { TextAnimate } from "@/components/magicui/text-animate";

/** Simple Icons CDN — white marks for the monochrome landing. */
const slugs = [
	"docker",
	"traefikproxy",
	"postgresql",
	"redis",
	"mongodb",
	"mysql",
	"mariadb",
	"github",
	"gitlab",
	"git",
	"swagger",
	"linux",
	"nginx",
	"typescript",
	"nodedotjs",
	"gnubash",
	"prometheus",
	"grafana",
	"cloudflare",
	"letsencrypt",
] as const;

const images = slugs.map((slug) => `https://cdn.simpleicons.org/${slug}/ffffff`);

export function SocialProof() {
	return (
		<section className="relative overflow-hidden border-t border-white/8 py-20 sm:py-28">
			<div
				aria-hidden
				className="pointer-events-none absolute inset-x-0 top-1/2 h-64 -translate-y-1/2 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.06),transparent_65%)]"
			/>

			<div className="relative mx-auto grid max-w-6xl items-center gap-10 px-5 sm:px-6 lg:grid-cols-2 lg:gap-16">
				<BlurFade>
					<p className="font-mono text-xs tracking-[0.18em] text-neutral-500 uppercase">Stack</p>
					<TextAnimate
						as="h2"
						animation="blurInUp"
						by="word"
						once
						className="mt-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl"
					>
						Built on the stack you already trust
					</TextAnimate>
					<p className="mt-4 max-w-md text-neutral-400">
						Docker, Traefik, your databases, and the Git providers you use every day — drag the
						cloud, no proprietary runtime to learn.
					</p>
				</BlurFade>

				<BlurFade delay={0.1} className="flex justify-center lg:justify-end">
					<div className="relative flex size-full max-w-[420px] items-center justify-center overflow-hidden rounded-2xl border border-white/8 bg-white/[0.02] p-4">
						<IconCloud images={[...images]} width={400} height={400} />
					</div>
				</BlurFade>
			</div>
		</section>
	);
}
