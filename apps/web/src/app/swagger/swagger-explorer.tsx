"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import "swagger-ui-dist/swagger-ui.css";

import { Button } from "@/components/ui/button";

import "./swagger-theme.css";

type SwaggerUIBundleFn = (options: {
	domNode?: HTMLElement | null;
	url?: string;
	docExpansion?: "list" | "full" | "none";
	defaultModelsExpandDepth?: number;
	[key: string]: unknown;
}) => unknown;

function asBundle(value: unknown): SwaggerUIBundleFn | null {
	return typeof value === "function" ? (value as SwaggerUIBundleFn) : null;
}

/**
 * Swagger UI with a dashboard-styled intro card. Servers + Authorize stay as
 * real Swagger controls (scheme-container) so they keep working.
 */
export function SwaggerExplorer() {
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		let disposed = false;
		void import("swagger-ui-dist/swagger-ui-bundle.js").then((mod) => {
			if (disposed || !containerRef.current) return;
			const SwaggerUIBundle =
				asBundle(mod.default) ??
				asBundle((mod as { SwaggerUIBundle?: unknown }).SwaggerUIBundle) ??
				asBundle(mod);
			if (!SwaggerUIBundle) {
				console.error("[swagger] SwaggerUIBundle export missing", mod);
				return;
			}
			SwaggerUIBundle({
				domNode: containerRef.current,
				url: "/api/openapi.json",
				docExpansion: "none",
				defaultModelsExpandDepth: -1,
				persistAuthorization: true,
			});
		});
		return () => {
			disposed = true;
		};
	}, []);

	return (
		<div className="swagger-explorer min-h-svh bg-background font-sans text-foreground antialiased">
			<header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur-md">
				<div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
					<div className="min-w-0">
						<p className="text-sm font-medium tracking-tight text-foreground">API Reference</p>
						<p className="truncate text-xs text-muted-foreground">
							OpenAPI · authorize with <code className="font-mono text-[11px]">x-api-key</code>
						</p>
					</div>
					<Button variant="outline" size="sm" asChild>
						<Link href="/dashboard">Back to dashboard</Link>
					</Button>
				</div>
			</header>

			<div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-8 sm:px-6">
				<section className="rounded-lg border border-border bg-card p-4 sm:p-5">
					<div className="flex flex-wrap items-center gap-2">
						<h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
							Nixploy API
						</h1>
						<span className="rounded-full border border-border bg-muted px-2 py-0.5 font-mono text-[11px] font-medium text-muted-foreground">
							0.1.0
						</span>
						<span className="rounded-full border border-border px-2 py-0.5 font-mono text-[11px] font-medium text-muted-foreground">
							OAS 3.0
						</span>
					</div>
					<p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground text-pretty">
						REST surface generated from the tRPC routers. Authenticate with an API key (
						<code className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[12px] text-foreground">
							x-api-key
						</code>{" "}
						header) created under Settings → Profile.
					</p>
					<a
						href="/api/openapi.json"
						target="_blank"
						rel="noreferrer"
						className="mt-3 inline-flex items-center text-sm text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground/40"
					>
						/api/openapi.json
					</a>
				</section>

				<div ref={containerRef} className="swagger-host min-w-0" />
			</div>
		</div>
	);
}
