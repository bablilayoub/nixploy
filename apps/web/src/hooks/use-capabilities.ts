"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { useSession } from "@/lib/auth-client";
import { useTRPC } from "@/lib/trpc";

/** Mirrors `isInstanceAdminRole` on the server (better-auth admin plugin role). */
function isInstanceAdminRole(role: string | null | undefined): boolean {
	if (!role) return false;
	return role
		.split(",")
		.map((part) => part.trim())
		.includes("admin");
}

/**
 * Capability set of the signed-in member for the active organization, plus
 * the instance-admin flag from the session. Use it to hide or disable
 * controls the server would reject with FORBIDDEN, never as the only gate —
 * every mutation is still checked server-side.
 *
 * `can()` returns true while the query is loading so pages do not flash
 * controls in and out; pass `strict: true` to get false until loaded.
 *
 * Everything reports the "not loaded yet" shape until the component has
 * mounted: route segments hydrate independently, so a query started by the
 * layout (NavSettings) can already be resolved when a page segment hydrates,
 * and the session store is populated before React runs at all. Without this
 * gate the server-rendered `disabled`/`title` attributes would not match the
 * first client render.
 */
export function useCapabilities(options: { strict?: boolean } = {}) {
	const trpc = useTRPC();
	const { data: session } = useSession();
	const query = useQuery({
		...trpc.organization.myCapabilities.queryOptions(),
		staleTime: 60_000,
		retry: false,
	});

	const capabilities = useMemo(
		() => new Set<string>(query.data?.capabilities ?? []),
		[query.data?.capabilities],
	);
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	const loaded = mounted && query.isSuccess;
	const strict = options.strict ?? false;

	const can = (capability: string): boolean => {
		if (!loaded) return !strict && !(mounted && query.isError);
		return capabilities.has(capability);
	};

	return {
		can,
		canAll: (...list: string[]) => list.every(can),
		canAny: (...list: string[]) => list.some(can),
		capabilities,
		role: loaded ? (query.data?.role ?? null) : null,
		organizationId: loaded ? (query.data?.organizationId ?? null) : null,
		isInstanceAdmin: mounted && isInstanceAdminRole(session?.user?.role),
		isLoading: !mounted || query.isPending,
		isError: mounted && query.isError,
	};
}
