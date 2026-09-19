import { Footer } from "@/components/footer";
import { Cta } from "@/components/home/cta";
import { Faq } from "@/components/home/faq";
import { Features } from "@/components/home/features";
import { Hero } from "@/components/home/hero";
import { Screens } from "@/components/home/screens";
import { Stats } from "@/components/home/stats";
import { Templates } from "@/components/home/templates";
import { Navbar } from "@/components/navbar";

/*
 * The home page, one column, top to bottom: a centred fold with the product
 * window under it, a hairline grid of twelve features, the panel in tabs,
 * four stat cards, the template marquee, the questions, and the close.
 */
export default function Home() {
	return (
		<div className="relative min-h-screen">
			<Navbar />
			<main id="main-content" className="relative">
				<Hero />
				<Features />
				<Screens />
				<Stats />
				<Templates />
				<Faq />
				<Cta />
			</main>
			<Footer />
		</div>
	);
}
