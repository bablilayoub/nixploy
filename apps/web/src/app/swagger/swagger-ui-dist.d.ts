declare module "swagger-ui-dist" {
	interface SwaggerUIOptions {
		domNode?: HTMLElement | null;
		url?: string;
		docExpansion?: "list" | "full" | "none";
		defaultModelsExpandDepth?: number;
		[key: string]: unknown;
	}
	type SwaggerUIBundle = (options: SwaggerUIOptions) => unknown;
	export const SwaggerUIBundle: SwaggerUIBundle;
	export const SwaggerUIStandalonePreset: unknown;
	const _default: SwaggerUIBundle | { SwaggerUIBundle: SwaggerUIBundle };
	export default _default;
}

declare module "swagger-ui-dist/swagger-ui-bundle.js" {
	interface SwaggerUIOptions {
		domNode?: HTMLElement | null;
		url?: string;
		docExpansion?: "list" | "full" | "none";
		defaultModelsExpandDepth?: number;
		[key: string]: unknown;
	}
	type SwaggerUIBundle = (options: SwaggerUIOptions) => unknown;
	const SwaggerUIBundle: SwaggerUIBundle;
	export default SwaggerUIBundle;
}
