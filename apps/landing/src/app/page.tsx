import { Cta, Footer } from "@/components/cta";
import { Faq } from "@/components/faq";
import { Features } from "@/components/features";
import { Hero } from "@/components/hero";
import { HowItWorks } from "@/components/how-it-works";
import { Navbar } from "@/components/navbar";
import { Showcase } from "@/components/showcase";
import { Stats } from "@/components/stats";
import { Templates } from "@/components/templates";

export default function Home() {
	return (
		<main className="relative bg-[#050505]">
			<Navbar />
			<Hero />
			<Stats />
			<HowItWorks />
			<Features />
			<Showcase />
			<Templates />
			<Faq />
			<Cta />
			<Footer />
		</main>
	);
}
