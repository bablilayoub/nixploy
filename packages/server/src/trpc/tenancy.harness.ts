import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import {
	applications,
	certificates,
	compose,
	destinations,
	environments,
	members,
	notifications,
	organizations,
	postgres,
	projects,
	registry,
	servers,
	sshKeys,
	users,
} from "../db/schema";
import type { TRPCContext } from "./init";
import { appRouter } from "./root";

export type TenantFixture = {
	userId: string;
	organizationId: string;
	projectId: string;
	environmentId: string;
	applicationId: string;
	composeId: string;
	serverId: string;
	destinationId: string;
	registryId: string;
	sshKeyId: string;
	certificateId: string;
	notificationId: string;
	postgresId: string;
	session: NonNullable<TRPCContext["session"]>;
};

function must<T>(row: T | undefined, label: string): T {
	if (!row) throw new Error(`tenancy seed failed: missing ${label}`);
	return row;
}

const makeSession = (userId: string, organizationId: string): NonNullable<TRPCContext["session"]> =>
	({
		user: {
			id: userId,
			name: "Tenancy Test",
			email: `${userId}@tenancy.test`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		},
		session: {
			id: `sess_${userId}`,
			userId,
			token: `tok_${userId}`,
			expiresAt: new Date(Date.now() + 86_400_000),
			createdAt: new Date(),
			updatedAt: new Date(),
			ipAddress: null,
			userAgent: null,
			activeOrganizationId: organizationId,
		},
	}) as NonNullable<TRPCContext["session"]>;

/** Insert two isolated orgs with parallel resource trees. */
export async function seedTwoTenants(): Promise<{ a: TenantFixture; b: TenantFixture }> {
	const a = await seedOneTenant("a");
	const b = await seedOneTenant("b");
	return { a, b };
}

export async function seedOneTenant(label: string): Promise<TenantFixture> {
	const userId = `tenancy_user_${label}_${randomUUID().slice(0, 8)}`;
	const organizationId = `tenancy_org_${label}_${randomUUID().slice(0, 8)}`;
	const suffix = `${label}-${randomUUID().slice(0, 8)}`;

	await db.insert(users).values({
		id: userId,
		name: `Tenant ${label}`,
		email: `${userId}@tenancy.test`,
		emailVerified: true,
	});
	await db.insert(organizations).values({
		id: organizationId,
		name: `Org ${label}`,
		slug: `org-${suffix}`,
	});
	await db.insert(members).values({
		id: `member_${suffix}`,
		userId,
		organizationId,
		role: "owner",
	});

	const project = must(
		(
			await db
				.insert(projects)
				.values({
					name: `Project ${label}`,
					organizationId,
				})
				.returning()
		)[0],
		"project",
	);
	const environment = must(
		(
			await db
				.insert(environments)
				.values({
					name: "production",
					projectId: project.projectId,
				})
				.returning()
		)[0],
		"environment",
	);
	const application = must(
		(
			await db
				.insert(applications)
				.values({
					name: `App ${label}`,
					appName: `app-${suffix}`,
					environmentId: environment.environmentId,
				})
				.returning()
		)[0],
		"application",
	);
	const composeRow = must(
		(
			await db
				.insert(compose)
				.values({
					name: `Compose ${label}`,
					appName: `compose-${suffix}`,
					environmentId: environment.environmentId,
					composeFile: "services:\n  web:\n    image: traefik/whoami\n",
				})
				.returning()
		)[0],
		"compose",
	);
	const sshKey = must(
		(
			await db
				.insert(sshKeys)
				.values({
					name: `Key ${label}`,
					privateKey: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----",
					publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITest",
					organizationId,
				})
				.returning()
		)[0],
		"sshKey",
	);
	const server = must(
		(
			await db
				.insert(servers)
				.values({
					name: `Server ${label}`,
					ipAddress: label === "a" ? "10.0.0.1" : "10.0.0.2",
					organizationId,
					sshKeyId: sshKey.sshKeyId,
				})
				.returning()
		)[0],
		"server",
	);
	const destination = must(
		(
			await db
				.insert(destinations)
				.values({
					name: `Dest ${label}`,
					accessKey: "AKIA_TEST",
					secretAccessKey: "secret",
					bucket: `bucket-${suffix}`,
					region: "us-east-1",
					endpoint: "https://s3.example.com",
					organizationId,
				})
				.returning()
		)[0],
		"destination",
	);
	const registryRow = must(
		(
			await db
				.insert(registry)
				.values({
					registryName: `Registry ${label}`,
					username: "user",
					password: "pass",
					organizationId,
				})
				.returning()
		)[0],
		"registry",
	);
	const certificate = must(
		(
			await db
				.insert(certificates)
				.values({
					name: `Cert ${label}`,
					certificateData: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
					privateKey: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----",
					certificatePath: `/tmp/tenancy-cert-${suffix}.crt`,
					organizationId,
				})
				.returning()
		)[0],
		"certificate",
	);
	const notification = must(
		(
			await db
				.insert(notifications)
				.values({
					name: `Notify ${label}`,
					type: "slack",
					slackConfig: { webhookUrl: "https://hooks.slack.com/services/test" },
					organizationId,
				})
				.returning()
		)[0],
		"notification",
	);
	const postgresRow = must(
		(
			await db
				.insert(postgres)
				.values({
					name: `Postgres ${label}`,
					appName: `pg-${suffix}`,
					databaseName: "app",
					databaseUser: "app",
					databasePassword: "secret",
					environmentId: environment.environmentId,
				})
				.returning()
		)[0],
		"postgres",
	);

	return {
		userId,
		organizationId,
		projectId: project.projectId,
		environmentId: environment.environmentId,
		applicationId: application.applicationId,
		composeId: composeRow.composeId,
		serverId: server.serverId,
		destinationId: destination.destinationId,
		registryId: registryRow.registryId,
		sshKeyId: sshKey.sshKeyId,
		certificateId: certificate.certificateId,
		notificationId: notification.notificationId,
		postgresId: postgresRow.postgresId,
		session: makeSession(userId, organizationId),
	};
}

export async function wipeTenant(fixture: TenantFixture): Promise<void> {
	await db.delete(organizations).where(eq(organizations.id, fixture.organizationId));
	await db.delete(users).where(eq(users.id, fixture.userId));
}

export function createTestCaller(session: NonNullable<TRPCContext["session"]>) {
	return appRouter.createCaller({
		headers: new Headers(),
		session,
	});
}
