import { describe, expect, it } from "vitest";
import { findTemplateById } from "./catalog";
import { summarizeTemplateServices } from "./services";

describe("summarizeTemplateServices", () => {
	it("lists image, deps, volumes and env for a multi-service template", () => {
		const wordpress = findTemplateById("wordpress");
		expect(wordpress).toBeDefined();
		if (!wordpress) return;
		const services = summarizeTemplateServices(
			wordpress.compose,
			wordpress.suggestedDomain.serviceName,
		);
		expect(services.map((service) => service.name)).toEqual(["wordpress", "wordpress_db"]);
		const app = services.find((service) => service.name === "wordpress");
		expect(app?.image).toBe("wordpress:6-apache");
		expect(app?.dependsOn).toContain("wordpress_db");
		expect(app?.volumes.some((volume) => volume.includes("wordpress-data"))).toBe(true);
		expect(app?.envKeys).toContain("WORDPRESS_DB_PASSWORD");
		expect(app?.isDomainTarget).toBe(true);
		expect(services.find((service) => service.name === "wordpress_db")?.isDomainTarget).toBe(
			false,
		);
	});
});
