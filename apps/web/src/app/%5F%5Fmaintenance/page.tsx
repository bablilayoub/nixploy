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
				minHeight: "100svh",
				background: "var(--background, #fafafa)",
				color: "var(--foreground, #171717)",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				padding: "2rem",
				textAlign: "left",
				fontFamily:
					"ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
			}}
		>
			<div style={{ maxWidth: "32rem", borderTop: "2px solid currentColor", paddingTop: "2rem" }}>
				<p
					style={{
						fontSize: "0.75rem",
						letterSpacing: "0",
						textTransform: "none",
						marginBottom: "1.5rem",
					}}
				>
					Back shortly
				</p>
				<h1
					style={{
						fontSize: "2.5rem",
						letterSpacing: "-0.04em",
						lineHeight: 1.1,
						fontWeight: 500,
						margin: "0 0 0.75rem",
					}}
				>
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
