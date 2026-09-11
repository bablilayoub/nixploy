import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

/**
 * The cache contract `create-project-dialog.tsx` works around.
 *
 * query-core's `Query#fetch` only honours `cancelRefetch` once the query holds
 * data; without data it returns the promise of the request already in flight.
 * So an `invalidateQueries` that lands while the FIRST `project.all` request is
 * still running resolves with the PRE-CREATE list — which is exactly the
 * dashboard's empty state, and why "Create your first project" survived the
 * first project until a page reload (2026-09 audit, ci2 §4.1).
 *
 * These tests pin that behaviour (so a react-query upgrade that changes it
 * shows up here) and prove the shape of the fix: one extra `refetchQueries`
 * when the query had no data at write time.
 */

const key = ["project", "all"];
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A query function whose answers are queued and released one call at a time. */
function queuedQueryFn(answers: string[][]) {
	const gates: Array<() => void> = [];
	let call = 0;
	const queryFn = async () => {
		const index = call++;
		await new Promise<void>((resolve) => gates.push(resolve));
		return answers[index] ?? [];
	};
	return {
		queryFn,
		/** Let the n-th (0-based) call finish. */
		release: (index: number) => gates[index]?.(),
		calls: () => call,
	};
}

/** A mounted `useQuery(trpc.project.all.queryOptions())`, without React. */
function mount(client: QueryClient, queryFn: () => Promise<string[]>) {
	const observer = new QueryObserver(client, { queryKey: key, queryFn, retry: false });
	return observer.subscribe(() => {});
}

describe("invalidating project.all while its first request is in flight", () => {
	it("resolves with the pre-create list instead of refetching", async () => {
		const client = new QueryClient();
		const source = queuedQueryFn([[], ["project-1"]]);
		const unsubscribe = mount(client, source.queryFn);
		await flush();
		expect(client.getQueryData(key), "still loading, no data yet").toBeUndefined();

		// The write lands here and the dialog invalidates.
		const invalidated = client.invalidateQueries({ queryKey: key });
		await flush();
		source.release(0);
		await invalidated;

		expect(source.calls(), "de-duplicated onto the in-flight request").toBe(1);
		expect(client.getQueryData(key), "settled with the pre-create list").toEqual([]);
		unsubscribe();
		client.clear();
	});

	it("picks the new row up when the invalidation is followed by a refetch", async () => {
		const client = new QueryClient();
		const source = queuedQueryFn([[], ["project-1"]]);
		const unsubscribe = mount(client, source.queryFn);
		await flush();

		// What the dialog checks before invalidating.
		const hadData = client.getQueryData(key) !== undefined;
		expect(hadData).toBe(false);

		const invalidated = client.invalidateQueries({ queryKey: key });
		await flush();
		source.release(0);
		await invalidated;

		// …and what it does when the query had no data at write time.
		const refetched = client.refetchQueries({ queryKey: key });
		await flush();
		source.release(1);
		await refetched;

		expect(source.calls(), "a second request, started after the write").toBe(2);
		expect(client.getQueryData(key)).toEqual(["project-1"]);
		unsubscribe();
		client.clear();
	});

	it("needs no extra refetch once the query already holds data", async () => {
		const client = new QueryClient();
		const source = queuedQueryFn([[], ["project-1"]]);
		const unsubscribe = mount(client, source.queryFn);
		await flush();
		source.release(0);
		await flush();
		expect(client.getQueryData(key)).toEqual([]);

		const invalidated = client.invalidateQueries({ queryKey: key });
		await flush();
		source.release(1);
		await invalidated;

		expect(source.calls()).toBe(2);
		expect(client.getQueryData(key)).toEqual(["project-1"]);
		unsubscribe();
		client.clear();
	});
});
