import { describe, expect, it } from "vitest";
import type { RuntimeLogLine } from "./format";
import { isEmptyQuery, LogQueryError, matchLogLine, parseLogQuery } from "./query";

const line = (message: string, level: RuntimeLogLine["level"] = "default", container = "web") => ({
	t: 1,
	level,
	message,
	container,
});

describe("log query grammar", () => {
	it("parses terms, phrases, excludes, levels, containers and a regex", () => {
		const query = parseLogQuery(
			'timeout "connection refused" -healthcheck level:error,warn service:api /re(gex)?\\d/i',
		);
		expect(query.terms).toEqual(["timeout", "connection refused"]);
		expect(query.excludes).toEqual(["healthcheck"]);
		expect([...(query.levels ?? [])]).toEqual(["error", "warn"]);
		expect([...(query.containers ?? [])]).toEqual(["api"]);
		expect(query.regex?.source).toBe("re(gex)?\\d");
		expect(query.regex?.flags).toBe("i");
		expect(isEmptyQuery(parseLogQuery("   "))).toBe(true);
	});

	it("matches every clause", () => {
		const query = parseLogQuery("timeout -healthcheck level:error container:web");
		expect(matchLogLine(query, line("ERROR upstream timeout", "error"))).toBe(true);
		expect(matchLogLine(query, line("ERROR upstream timeout on healthcheck", "error"))).toBe(false);
		expect(matchLogLine(query, line("upstream timeout", "info"))).toBe(false);
		expect(matchLogLine(query, line("ERROR upstream timeout", "error", "api"))).toBe(false);
		expect(matchLogLine(parseLogQuery("/^GET \\/api/"), line("GET /api/x 200"))).toBe(true);
		expect(matchLogLine(parseLogQuery("/^GET \\/api/"), line("POST /api/x 200"))).toBe(false);
	});

	it("refuses what the reader could not bound", () => {
		expect(() => parseLogQuery("/(a+)+$/")).toThrow(LogQueryError);
		expect(() => parseLogQuery(`/${"a".repeat(201)}/`)).toThrow(/longer than/);
		expect(() => parseLogQuery('"open')).toThrow(/Unterminated quote/);
		expect(() => parseLogQuery("level:loud")).toThrow(/Unknown level/);
		expect(() => parseLogQuery("/[/")).toThrow(/Invalid regular expression/);
	});
});
