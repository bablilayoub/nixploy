import type { IncomingMessage } from "node:http";
import { auth } from "../lib/auth";
import { requestHeaders } from "./utils";

export type WsSession = typeof auth.$Infer.Session;

/**
 * Authenticate a websocket upgrade request against better-auth.
 * The session token travels in the Cookie header of the upgrade request,
 * so a plain `auth.api.getSession` is enough. Returns null when the
 * request is unauthenticated (caller must destroy the socket).
 */
export async function getSessionFromUpgrade(req: IncomingMessage): Promise<WsSession | null> {
	try {
		return await auth.api.getSession({ headers: requestHeaders(req) });
	} catch {
		return null;
	}
}
