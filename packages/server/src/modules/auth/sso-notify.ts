import { CHANNELS, notify, type Subscription, subscribe } from "../../db/listen";
import { rebuildAuth } from "../../lib/auth";
import { createLogger } from "../../lib/logger";
import { describeErrorWithCause } from "../../utils/error-cause";
import { invalidateSsoProviderCache } from "./sso";

const log = createLogger("sso");

/**
 * Making an SSO change take effect everywhere.
 *
 * better-auth freezes its plugin array at construction, so saving a provider
 * has to rebuild the instance. In a `panel` / `worker` split there are two
 * instances in two processes, and the one that did not handle the mutation has
 * no idea anything changed — so the mutation also NOTIFYs, and every listener
 * drops its cache and rebuilds.
 *
 * Unlike the deployment bus this channel carries no payload: a listener
 * re-reads the providers itself, which is both smaller than sending them and
 * the only version that cannot leak a client secret onto a Postgres channel.
 */

const globalForSsoBridge = globalThis as typeof globalThis & {
	__nixploySsoBridge?: { subscriptions: Subscription[]; started: boolean };
};

const bridge = globalForSsoBridge.__nixploySsoBridge ?? { subscriptions: [], started: false };
if (!globalForSsoBridge.__nixploySsoBridge) globalForSsoBridge.__nixploySsoBridge = bridge;

/**
 * Apply a provider change in this process, and tell every other one.
 *
 * The local rebuild is awaited so the caller's next request already sees the
 * new provider; the NOTIFY is best-effort, because a panel that cannot reach
 * the notify channel must still be able to save a provider.
 */
export async function publishAuthRebuild(): Promise<void> {
	invalidateSsoProviderCache();
	await rebuildAuth();
	try {
		await notify(CHANNELS.authRebuild, "1");
	} catch (error) {
		log.warn(
			"Saved the SSO provider but could not tell the other process to rebuild — it will pick the change up on its next restart",
			{ error: describeErrorWithCause(error) },
		);
	}
}

/**
 * Listen for provider changes made by another process. Idempotent, and safe to
 * call in every role: in `all` nothing else publishes, so it simply never fires.
 */
export async function startAuthRebuildBridge(): Promise<void> {
	if (bridge.started) return;
	bridge.started = true;
	try {
		bridge.subscriptions.push(
			await subscribe(
				CHANNELS.authRebuild,
				() => {
					invalidateSsoProviderCache();
					void rebuildAuth().catch((error: unknown) => {
						log.error("Rebuild after an SSO change failed", {
							error: describeErrorWithCause(error),
						});
					});
				},
				{
					// A reconnect may have hidden a change: rebuild once to be sure.
					onReconnect: () => {
						invalidateSsoProviderCache();
						void rebuildAuth().catch(() => {});
					},
					onError: (error: unknown) =>
						log.error("Auth rebuild channel error", {
							error: describeErrorWithCause(error),
						}),
				},
			),
		);
	} catch (error) {
		bridge.started = false;
		log.error("Could not start the auth rebuild bridge", {
			error: describeErrorWithCause(error),
		});
	}
}

export async function stopAuthRebuildBridge(): Promise<void> {
	const subscriptions = bridge.subscriptions.splice(0);
	bridge.started = false;
	await Promise.all(subscriptions.map((entry) => entry.unsubscribe()));
}
