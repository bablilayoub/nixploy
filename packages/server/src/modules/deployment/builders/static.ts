import { writeFileTargeted } from "../docker";
import { shellQuote } from "../paths";
import type { BuildInput } from "./index";

const SPA_NGINX_CONF = `server {
	listen 80;
	root /usr/share/nginx/html;
	index index.html;
	location / {
		try_files $uri $uri/ /index.html;
	}
}
`;

/**
 * Static build type: package the publish directory into an nginx image.
 * No build step runs — the source is expected to already contain the
 * compiled assets under `publishDirectory` (default `.`). When the app is
 * a SPA an nginx fallback config (`try_files … /index.html`) is baked in.
 */
export async function buildStatic(input: BuildInput, imageTag: string): Promise<void> {
	const { ctx, application, buildDir } = input;
	const publishDir = (application.publishDirectory ?? ".").replace(/^\/+/, "") || ".";

	const dockerfile = [
		"FROM nginx:alpine",
		`COPY ${publishDir} /usr/share/nginx/html`,
		...(application.isStaticSpa ? ["COPY nginx-spa.conf /etc/nginx/conf.d/default.conf"] : []),
		"EXPOSE 80",
		'CMD ["nginx", "-g", "daemon off;"]',
	].join("\n");

	await writeFileTargeted(ctx.serverId, `${buildDir}/.nixploy-static.Dockerfile`, dockerfile);
	if (application.isStaticSpa) {
		await writeFileTargeted(ctx.serverId, `${buildDir}/nginx-spa.conf`, SPA_NGINX_CONF);
	}

	await ctx.run(
		`docker build -f ${shellQuote(`${buildDir}/.nixploy-static.Dockerfile`)} -t ${shellQuote(imageTag)} ${shellQuote(buildDir)}`,
	);
}
