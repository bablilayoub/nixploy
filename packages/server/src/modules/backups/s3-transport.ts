import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import type { LookupFunction } from "node:net";
import { S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import {
	assertSafeOutboundUrl,
	classifyIpAddress,
	isPrivateEgressAllowed,
	pinnedLookup,
} from "../../utils/public-url";
import { badRequest } from "../errors";

/** S3 does not inherit notification providers' bare-overlay-service exception. */
export async function assertSafeS3Endpoint(endpoint: string) {
	const target = await assertSafeOutboundUrl(endpoint, { allowPrivate: true, allowHttp: true });
	if (target.addresses.some((address) => classifyIpAddress(address) === "overlay")) {
		throw badRequest("S3 endpoint must not target the platform overlay");
	}
	if (target.isPrivate && !(await isPrivateEgressAllowed())) {
		throw badRequest("Private S3 endpoints require the instance private-egress setting");
	}
	return target;
}

function origin(protocol: string, hostname: string, port?: number): string {
	const host = hostname.includes(":") ? `[${hostname.replace(/^\[|\]$/g, "")}]` : hostname;
	return `${protocol}//${host}${port ? `:${port}` : ""}/`;
}

function guardedLookup(protocol: string): LookupFunction {
	return (hostname, options, callback) => {
		void assertSafeS3Endpoint(origin(protocol, hostname)).then(
			(target) => pinnedLookup(target.addresses)(hostname, options, callback),
			(error: Error) => callback(error, "", 0),
		);
	};
}

/**
 * Keep SDK signing, serialization, multipart and body streams intact. The
 * request middleware also guards IP literals and pooled sockets on retries;
 * each fresh socket resolves/vets/pins its own addresses without a DNS gap.
 */
export function createSafeS3Client(config: S3ClientConfig): S3Client {
	const client = new S3Client({
		...config,
		requestHandler: {
			// Actual agents prevent NodeHttpHandler's Expect:100-continue path
			// from substituting its own unpinned one-shot agent.
			httpAgent: new HttpAgent({ keepAlive: true, maxSockets: 50, lookup: guardedLookup("http:") }),
			httpsAgent: new HttpsAgent({
				keepAlive: true,
				maxSockets: 50,
				lookup: guardedLookup("https:"),
			}),
		},
	});
	client.middlewareStack.add(
		(next) => async (args) => {
			const request = args.request as { protocol?: string; hostname?: string; port?: number };
			if (!request.protocol || !request.hostname) throw badRequest("Invalid S3 request target");
			await assertSafeS3Endpoint(origin(request.protocol, request.hostname, request.port));
			return await next(args);
		},
		{ step: "finalizeRequest", priority: "low", name: "nixployS3Egress" },
	);
	return client;
}
