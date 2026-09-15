import { describe, expect, it } from "vitest";

import { resolveTableView } from "@/hooks/use-table-view";

interface Row {
	name: string;
	image: string | null;
}

const rows: Row[] = Array.from({ length: 30 }, (_, index) => ({
	name: `service-${index}`,
	image: index % 2 === 0 ? `nginx:${index}` : null,
}));

const search = (row: Row) => [row.name, row.image];
const view = (query: string, page: number, pageSize = 10) =>
	resolveTableView({ rows, search, query, page, pageSize });

describe("resolveTableView", () => {
	it("pages an unfiltered list", () => {
		const first = view("", 0);
		expect(first.visible).toHaveLength(10);
		expect(first.visible[0]?.name).toBe("service-0");
		expect(first.from).toBe(1);
		expect(first.to).toBe(10);
		expect(first.pageCount).toBe(3);
		expect(first.showPagination).toBe(true);
		expect(first.isFiltered).toBe(false);
	});

	it("counts from the right offset on a later page", () => {
		const third = view("", 2);
		expect(third.visible[0]?.name).toBe("service-20");
		expect(third.from).toBe(21);
		expect(third.to).toBe(30);
	});

	it("matches any of the searched fields, case-insensitively", () => {
		expect(view("SERVICE-7", 0).filtered.map((row) => row.name)).toEqual(["service-7"]);
		// Matches on the second field, and skips the rows where it is null.
		expect(view("nginx:4", 0).filtered.map((row) => row.name)).toEqual(["service-4"]);
	});

	it("reports filtering only when the query actually hid something", () => {
		expect(view("service", 0).isFiltered).toBe(false);
		expect(view("service-1", 0).isFiltered).toBe(true);
		expect(view("   ", 0).isFiltered).toBe(false);
	});

	it("clamps a page that no longer exists instead of rendering nothing", () => {
		// The regression this guards: filtering from page 3 down to two results
		// used to leave the table on an empty page with no way back.
		// "service-1" also matches service-10..19, so it still fills two pages and
		// clamps to the last real one rather than all the way back to the first.
		expect(view("service-1", 2).page).toBe(1);
		const narrowed = view("service-7", 2);
		expect(narrowed.page).toBe(0);
		expect(narrowed.visible.map((row) => row.name)).toEqual(["service-7"]);
		expect(view("", 99).page).toBe(2);
		expect(view("", -5).page).toBe(0);
	});

	it("reports an empty match without a negative range", () => {
		const none = view("nothing-matches-this", 0);
		expect(none.filtered).toEqual([]);
		expect(none.from).toBe(0);
		expect(none.to).toBe(0);
		expect(none.pageCount).toBe(1);
		expect(none.showPagination).toBe(false);
	});

	it("keeps `query` on the view so the no-match row can tell the two empties apart", () => {
		// The regression: a table with no rows at all rendered both its real empty
		// state and "nothing matches ''", stacked. TableNoMatch bails on a blank
		// query, which is only possible because the query lives on the view.
		const empty = resolveTableView({ rows: [], search, query: "", page: 0 });
		expect(empty.visible).toEqual([]);
		expect(empty.isFiltered).toBe(false);
	});

	it("hides its own chrome for a short list", () => {
		const few = resolveTableView({
			rows: rows.slice(0, 5),
			search,
			query: "",
			page: 0,
			pageSize: 10,
		});
		expect(few.showSearch).toBe(false);
		expect(few.showPagination).toBe(false);
		// The search box appears at the threshold, not one row later.
		expect(
			resolveTableView({ rows: rows.slice(0, 8), search, query: "", page: 0 }).showSearch,
		).toBe(true);
	});
});
