import { Capabilities } from "@/components/capabilities";
import { Cta } from "@/components/cta";
import { DeployFlow } from "@/components/deploy-flow";
import { Faq } from "@/components/faq";
import { Footer } from "@/components/footer";
import { Hero } from "@/components/hero";
import { Navbar } from "@/components/navbar";
import { ProductPanels } from "@/components/product-panels";
import { TemplateStrip } from "@/components/template-strip";

export default function Home() {
	return (
		<div className="relative min-h-screen bg-atmosphere">
			<div className="bg-grain pointer-events-none absolute inset-0" aria-hidden />
			<div className="relative">
				<Navbar />
				<main>
					<Hero />
					<ProductPanels />
					<DeployFlow />
					<Capabilities />
					<TemplateStrip />
					<Faq />
					<Cta />
				</main>
				<Footer />
			</div>
		</div>
	);
}
