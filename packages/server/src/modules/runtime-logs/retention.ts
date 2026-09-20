import { getOrgQuotas } from "../projects/quotas";
import { findServiceByAppName } from "../services/registry";
import { runtimeLogMaxBytesPerService, runtimeLogRetentionDays } from "./store";

export interface RuntimeLogLimits {
	/** Days of hour files kept; 0 = no age limit. */
	retentionDays: number;
	/** Bytes per service; 0 = no byte cap. */
	maxBytes: number;
}

/**
 * An org's retention settings under the instance's ceiling. An org can only
 * keep *less* than the instance allows: the operator sets the ceiling with
 * the env knobs, an org admin trims it for their own services. An instance
 * value of 0 means "no limit", so the org value applies as-is there; an org
 * value of 0 is also "no limit", which under a ceiling means the ceiling.
 */
export function effectiveRuntimeLogLimits(
	org: { runtimeLogRetentionDays: number | null; runtimeLogMaxMbPerService: number | null },
	instance: RuntimeLogLimits,
): RuntimeLogLimits {
	const under = (orgValue: number | null, ceiling: number): number => {
		if (orgValue === null || orgValue < 0) return ceiling;
		if (ceiling === 0) return orgValue;
		if (orgValue === 0) return ceiling;
		return Math.min(orgValue, ceiling);
	};
	return {
		retentionDays: under(org.runtimeLogRetentionDays, instance.retentionDays),
		maxBytes: under(
			org.runtimeLogMaxMbPerService === null ? null : org.runtimeLogMaxMbPerService * 1024 * 1024,
			instance.maxBytes,
		),
	};
}

/** The instance ceiling from the env knobs. */
export const instanceRuntimeLogLimits = (): RuntimeLogLimits => ({
	retentionDays: runtimeLogRetentionDays(),
	maxBytes: runtimeLogMaxBytesPerService(),
});

/**
 * `(appName) => limits` for one prune pass: the service's org is looked up
 * once per app and the org's quotas once per org, so a pass over a hundred
 * services costs a hundred small reads, not a hundred quota parses. A
 * directory whose app no longer exists gets the instance limits — the
 * pruner drops a dead service's directory anyway.
 */
export function runtimeLogLimitsResolver(): (appName: string) => Promise<RuntimeLogLimits> {
	const instance = instanceRuntimeLogLimits();
	const orgLimits = new Map<string, Promise<RuntimeLogLimits>>();
	const limitsForOrg = (organizationId: string): Promise<RuntimeLogLimits> => {
		let pending = orgLimits.get(organizationId);
		if (!pending) {
			pending = getOrgQuotas(organizationId)
				.then((quotas) => effectiveRuntimeLogLimits(quotas, instance))
				.catch(() => instance);
			orgLimits.set(organizationId, pending);
		}
		return pending;
	};
	return async (appName) => {
		const service = await findServiceByAppName(appName).catch(() => undefined);
		return service ? limitsForOrg(service.organizationId) : instance;
	};
}
