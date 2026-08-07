import { Capabilities } from "@/components/capabilities";
import { Cta } from "@/components/cta";
import { Footer } from "@/components/footer";
import { Hero } from "@/components/hero";
import { HowItWorks } from "@/components/how-it-works";
import { InstallSection } from "@/components/install-section";
import { Navbar } from "@/components/navbar";
import { Showcase } from "@/components/showcase";
import { Templates } from "@/components/templates";

export default function Home() {
	return (
		<div className="relative min-h-screen bg-atmosphere">
			<div className="bg-grain pointer-events-none absolute inset-0" aria-hidden />
			<div className="relative">
				<Navbar />
				<main>
					<Hero />
					<HowItWorks />
					<Capabilities />
					<Showcase />
					<InstallSection />
					<Templates />
					<Cta />
				</main>
				<Footer />
			</div>
		</div>
	);
}
