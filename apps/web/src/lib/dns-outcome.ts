import { toast } from "sonner";

/** `DnsRecordOutcome` from `modules/dns`, as the panel needs it. */
export interface DnsOutcomeLike {
	host: string;
	status: "created" | "updated" | "unchanged" | "skipped" | "failed";
	reason?: string;
	message: string;
}

/**
 * One toast per host for what the linked DNS provider did. Silent for the
 * "nothing to do" cases the operator chose (`disabled`, magic-DNS hosts):
 * a domain attached with automation off should not nag about it. Everything
 * else is worth a line — a created record, and above all a failure, since
 * the domain exists and routes, but does not resolve.
 */
export function toastDnsOutcome(outcome: DnsOutcomeLike | undefined, explicit = false): void {
	if (!outcome) return;
	switch (outcome.status) {
		case "created":
		case "updated":
			toast.success(`DNS record ${outcome.status}`, { description: outcome.message });
			return;
		case "unchanged":
			if (explicit) toast.info("DNS record already correct", { description: outcome.message });
			return;
		case "failed":
			toast.error(`DNS record for ${outcome.host} failed`, { description: outcome.message });
			return;
		case "skipped":
			if (explicit || (outcome.reason !== "disabled" && outcome.reason !== "host-not-eligible")) {
				toast.info(`No DNS record for ${outcome.host}`, { description: outcome.message });
			}
			return;
	}
}
