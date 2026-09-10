import { Footer } from "@/components/footer";
import { Automation } from "@/components/home/automation";
import { Bento } from "@/components/home/bento";
import { Cta } from "@/components/home/cta";
import { Faq } from "@/components/home/faq";
import { Hero } from "@/components/home/hero";
import { PanelPreview } from "@/components/home/panel-preview";
import { Pipeline } from "@/components/home/pipeline";
import { Stats } from "@/components/home/stats";
import { Templates } from "@/components/home/templates";
import { Navbar } from "@/components/navbar";

export default function Home() {
	return (
		<div className="relative min-h-screen bg-atmosphere">
			<div className="bg-grain pointer-events-none absolute inset-0" aria-hidden />
			<div className="relative">
				<Navbar />
				<main>
					<Hero />
					<Stats />
					<PanelPreview />
					<Pipeline />
					<Bento />
					<Templates />
					<Automation />
					<Faq />
					<Cta />
				</main>
				<Footer />
			</div>
		</div>
	);
}
