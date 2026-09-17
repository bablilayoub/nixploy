import { describe, expect, it } from "vitest";
import { auditVerb, serviceEventFromAudit } from "./audit-events";

const entry = (overrides: Record<string, unknown> = {}) => ({
	organizationId: "org-1",
	actorId: "user-1",
	actorEmail: "dev@example.com",
	action: "application.update",
	targetType: "application",
	targetId: "app-1",
	targetName: "web-abc123",
	metadata: { fields: ["autoDeploy"] },
	...overrides,
});

describe("serviceEventFromAudit", () => {
	it("turns a service mutation into a config change", () => {
		const event = serviceEventFromAudit(entry());
		expect(event).toMatchObject({
			organizationId: "org-1",
			serviceType: "application",
			serviceId: "app-1",
			appName: "web-abc123",
			kind: "config_changed",
			title: "Settings changed",
			actorEmail: "dev@example.com",
		});
		expect(event?.metadata).toMatchObject({ action: "application.update", fields: ["autoDeploy"] });
	});

	it("gives a rollback its own kind", () => {
		expect(serviceEventFromAudit(entry({ action: "application.rollback" }))?.kind).toBe("rollback");
	});

	it("leaves the deploy verbs to the worker, which knows the deployment id", () => {
		for (const action of [
			"application.deploy",
			"application.redeploy",
			"application.redeployFromDeployment",
			"application.cancelDeployment",
			"application.killBuild",
		]) {
			expect(serviceEventFromAudit(entry({ action })), action).toBeNull();
		}
	});

	it("does not write a timeline row for a service that no longer exists", () => {
		expect(serviceEventFromAudit(entry({ action: "application.delete" }))).toBeNull();
	});

	it("ignores entries that name no service", () => {
		expect(serviceEventFromAudit(entry({ targetType: "domain" }))).toBeNull();
		expect(serviceEventFromAudit(entry({ targetType: "server" }))).toBeNull();
		expect(serviceEventFromAudit(entry({ targetId: null }))).toBeNull();
		expect(serviceEventFromAudit(entry({ organizationId: null }))).toBeNull();
	});

	it("covers every service kind, not just applications", () => {
		for (const kind of ["compose", "postgres", "mysql", "mariadb", "mongo", "redis"]) {
			const event = serviceEventFromAudit(entry({ action: `${kind}.update`, targetType: kind }));
			expect(event?.serviceType, kind).toBe(kind);
		}
	});

	it("humanizes a verb nobody wrote copy for", () => {
		expect(serviceEventFromAudit(entry({ action: "application.savePlacement" }))?.title).toBe(
			"Save placement",
		);
	});

	it("reads the verb after the first dot only", () => {
		expect(auditVerb("application.saveBuildType")).toBe("saveBuildType");
		expect(auditVerb("noDot")).toBe("noDot");
	});
});
