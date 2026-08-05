"use client";

import { useEffect, useRef } from "react";
import "swagger-ui-dist/swagger-ui.css";

/**
 * Swagger UI rendered from the locally installed swagger-ui-dist bundle
 * (no CDN — the instance must work offline). Authorize with an API key
 * created under Settings → Profile; it is sent as the `x-api-key` header.
 */
export function SwaggerExplorer() {
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		let disposed = false;
		void import("swagger-ui-dist").then((mod) => {
			if (disposed || !containerRef.current) return;
			const SwaggerUIBundle = mod.default;
			SwaggerUIBundle({
				domNode: containerRef.current,
				url: "/api/openapi.json",
				docExpansion: "none",
				defaultModelsExpandDepth: -1,
			});
		});
		return () => {
			disposed = true;
		};
	}, []);

	return (
		<div className="min-h-svh bg-background text-foreground">
			<div ref={containerRef} />
		</div>
	);
}
