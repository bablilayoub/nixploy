import { Footer } from "@/components/footer";
import { Cta } from "@/components/home/cta";
import { Faq } from "@/components/home/faq";
import { Features } from "@/components/home/features";
import { Hero } from "@/components/home/hero";
import { OpenCore } from "@/components/home/open-core";
import { Rail } from "@/components/home/rail";
import { Screens } from "@/components/home/screens";
import { Templates } from "@/components/home/templates";
import { Navbar } from "@/components/navbar";

/*
 * The home page, one column, top to bottom.
 *
 * The order is the reader's order, not the product's: the claim beside the
 * install actually running, the panel itself in a window whose tabs are its
 * own chrome, the four counted numbers on a rail, three numbered chapters
 * with the commands that do them, the half people assume is paywalled, the
 * template strip, the questions, and the close on the same graph paper the
 * page opened on.
 */
export default function Home() {
	return (
		<div className="relative min-h-screen">
			<Navbar />
			<main id="main-content" className="relative">
				<Hero />
				<Screens />
				<Rail />
				<Features />
				<OpenCore />
				<Templates />
				<Faq />
				<Cta />
			</main>
			<Footer />
		</div>
	);
}
