import { Footer } from "@/components/footer";
import { Agents } from "@/components/home/agents";
import { Features } from "@/components/home/features";
import { Hero } from "@/components/home/hero";
import { OpenSource } from "@/components/home/open-source";
import { Positioning } from "@/components/home/positioning";
import { Statement } from "@/components/home/statement";
import { Templates } from "@/components/home/templates";
import { Navbar } from "@/components/navbar";

/*
 * Order is the hierarchy, and it is deliberate:
 * typography → product screenshot → product explanation → features → MCP →
 * templates → positioning → open source → footer.
 * Anything that does not improve clarity does not belong on this page; the
 * detail lives on /features, /templates, /agents, /compare and /pricing.
 */
export default function Home() {
	return (
		<div className="relative min-h-screen bg-atmosphere">
			<div className="bg-grain pointer-events-none absolute inset-0" aria-hidden />
			<div className="relative">
				<Navbar />
				<main>
					<Hero />
					<Statement />
					<Features />
					<Agents />
					<Templates />
					<Positioning />
					<OpenSource />
				</main>
				<Footer />
			</div>
		</div>
	);
}
