import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Under maintenance",
	robots: { index: false, follow: false },
};

/**
 * Page served by Traefik's `errors` middleware for every domain with the
 * `maintenance` middleware enabled (`modules/traefik/middlewares.ts` points
 * the middleware at the `nixploy-dashboard` service with
 * `query: /__maintenance`). It is fetched by the proxy, never linked, so it
 * must stay static, unauthenticated and free of any tenant data — the visitor
 * is somebody else's user, not a Nixploy operator.
 */
export default function MaintenancePage() {
	return (
		<main
			style={{
				minHeight: "100vh",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				padding: "2rem",
				textAlign: "center",
				fontFamily:
					"ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
			}}
		>
			<div style={{ maxWidth: "32rem" }}>
				<h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: "0 0 0.75rem" }}>
					Under maintenance
				</h1>
				<p style={{ margin: 0, opacity: 0.7, lineHeight: 1.6 }}>
					This site is temporarily unavailable while we carry out scheduled maintenance. Please try
					again shortly.
				</p>
			</div>
		</main>
	);
}
