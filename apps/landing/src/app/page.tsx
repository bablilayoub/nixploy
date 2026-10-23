import { Cta } from "@/components/sections/cta";
import { Faq } from "@/components/sections/faq";
import { Features } from "@/components/sections/features";
import { Hero } from "@/components/sections/hero";
import { Platform } from "@/components/sections/platform";
import { ProductShot } from "@/components/sections/product-shot";
import { Stats } from "@/components/sections/stats";
import { Templates } from "@/components/sections/templates";
import { SiteFooter } from "@/components/site-footer";
import { SiteNavbar } from "@/components/site-navbar";

export default function Home() {
	return (
		<div className="relative min-h-screen">
			<SiteNavbar />
			<main id="main-content">
				<Hero />
				<ProductShot />
				<Stats />
				<Features />
				<Platform />
				<Templates />
				<Faq />
				<Cta />
			</main>
			<SiteFooter />
		</div>
	);
}
