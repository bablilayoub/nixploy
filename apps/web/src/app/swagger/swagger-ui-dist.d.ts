declare module "swagger-ui-dist" {
	interface SwaggerUIOptions {
		domNode?: HTMLElement | null;
		url?: string;
		docExpansion?: "list" | "full" | "none";
		defaultModelsExpandDepth?: number;
		[key: string]: unknown;
	}
	const SwaggerUIBundle: (options: SwaggerUIOptions) => unknown;
	export default SwaggerUIBundle;
}
