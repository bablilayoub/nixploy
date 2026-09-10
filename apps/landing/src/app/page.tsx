import { Footer } from "@/components/footer";
import { CodeToProduction } from "@/components/home/code-to-production";
import { Cta } from "@/components/home/cta";
import { Faq } from "@/components/home/faq";
import { Features } from "@/components/home/features";
import { Hero } from "@/components/home/hero";
import { Pricing } from "@/components/home/pricing";
import { Security } from "@/components/home/security";
import { StackStrip } from "@/components/home/stack-strip";
import { Statement } from "@/components/home/statement";
import { Stats } from "@/components/home/stats";
import { Navbar } from "@/components/navbar";

export default function Home() {
	return (
		<div className="relative min-h-screen bg-atmosphere">
			<div className="bg-grain pointer-events-none absolute inset-0" aria-hidden />
			<div className="relative">
				<Navbar />
				<main>
					<Hero />
					<StackStrip />
					<Stats />
					<Statement />
					<CodeToProduction />
					<Features />
					<Security />
					<Pricing />
					<Faq />
					<Cta />
				</main>
				<Footer />
			</div>
		</div>
	);
}
