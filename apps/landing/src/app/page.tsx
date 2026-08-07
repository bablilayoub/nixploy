import { Capabilities } from "@/components/capabilities";
import { Cta } from "@/components/cta";
import { DeployBeam } from "@/components/deploy-beam";
import { Faq } from "@/components/faq";
import { Footer } from "@/components/footer";
import { Hero } from "@/components/hero";
import { IntegrationsOrbit } from "@/components/integrations-orbit";
import { Navbar } from "@/components/navbar";
import { ProductPanels } from "@/components/product-panels";
import { SocialProof } from "@/components/social-proof";
import { Stats } from "@/components/stats";

export default function Home() {
	return (
		<div className="relative min-h-screen bg-atmosphere">
			<div className="bg-grain pointer-events-none absolute inset-0" aria-hidden />
			<div className="relative">
				<Navbar />
				<main>
					<Hero />
					<Capabilities />
					<IntegrationsOrbit />
					<DeployBeam />
					<ProductPanels />
					<Stats />
					<SocialProof />
					<Faq />
					<Cta />
				</main>
				<Footer />
			</div>
		</div>
	);
}
