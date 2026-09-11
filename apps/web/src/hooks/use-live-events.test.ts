import { describe, expect, it } from "vitest";

import { frameInvalidations, type InvalidationTarget } from "@/hooks/use-live-events";
import type { LiveEvent } from "@/lib/events-socket";

const paths = (targets: InvalidationTarget[]): string[] => targets.map((target) => target.path);

const deployment = (overrides: Partial<Extract<LiveEvent, { kind: "deployment" }>>): LiveEvent => ({
	kind: "deployment",
	deploymentId: "d1",
	appName: "whoami",
	applicationId: null,
	composeId: null,
	status: "queued",
	queuePosition: null,
	isPreview: false,
	...overrides,
});

describe("frameInvalidations", () => {
	it("only moves the deployment lists while a job is still in flight", () => {
		for (const status of ["queued", "running"]) {
			const targets = paths(frameInvalidations(deployment({ status, applicationId: "app_1" })));
			expect(targets).toContain("deployment.recent");
			expect(targets).toContain("deployment.byApplication");
			// A running job has not changed the service's status yet.
			expect(targets).not.toContain("application.one");
			expect(targets).not.toContain("docker.containers");
		}
	});

	it("refreshes the service and its container view once a job settles", () => {
		for (const status of ["done", "error", "cancelled"]) {
			const targets = paths(frameInvalidations(deployment({ status, applicationId: "app_1" })));
			expect(targets).toEqual(
				expect.arrayContaining([
					"deployment.recent",
					"deployment.byApplication",
					"deployment.statsByProject",
					"application.one",
					"application.all",
					"environment.byProject",
					"docker.containers",
				]),
			);
		}
	});

	it("carries the ids so only the affected row is refetched", () => {
		const targets = frameInvalidations(
			deployment({ status: "done", applicationId: "app_7", composeId: null }),
		);
		expect(targets).toContainEqual({ path: "application.one", applicationId: "app_7" });
	});

	it("routes a compose deployment to the compose queries", () => {
		const targets = paths(frameInvalidations(deployment({ status: "done", composeId: "cmp_1" })));
		expect(targets).toContain("compose.one");
		expect(targets).toContain("compose.all");
		expect(targets).not.toContain("application.one");
	});

	it("never touches the parent application when a preview finishes", () => {
		// A preview row carries the PARENT's applicationId — invalidating
		// `application.one` there would repaint the production service.
		const targets = paths(
			frameInvalidations(deployment({ status: "done", applicationId: "app_1", isPreview: true })),
		);
		expect(targets).toContain("deployment.recent");
		expect(targets).not.toContain("application.one");
		expect(targets).not.toContain("application.all");
	});

	it("maps a reconciler correction onto the right service router", () => {
		expect(
			paths(
				frameInvalidations({
					kind: "service-status",
					serviceKind: "compose",
					id: "cmp_1",
					status: "idle",
				}),
			),
		).toEqual(expect.arrayContaining(["compose.one", "compose.all", "docker.containers"]));

		const database = frameInvalidations({
			kind: "service-status",
			serviceKind: "postgres",
			id: "pg_1",
			status: "running",
		});
		expect(database).toContainEqual({ path: "service.one", serviceKind: "postgres", id: "pg_1" });
		expect(database).toContainEqual({ path: "service.all", serviceKind: "postgres" });
	});

	it("ignores a service kind it does not know, but still refreshes the shared views", () => {
		const targets = paths(
			frameInvalidations({
				kind: "service-status",
				serviceKind: "kafka",
				id: "k1",
				status: "running",
			}),
		);
		expect(targets).toEqual(["docker.containers", "environment.byProject"]);
	});

	it("treats a queue-depth frame as a cheap badge refresh", () => {
		expect(paths(frameInvalidations({ kind: "queue", depth: 4 }))).toEqual(["deployment.recent"]);
	});
});
