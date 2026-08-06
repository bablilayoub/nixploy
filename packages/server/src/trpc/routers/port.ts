import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { ports } from "../../db/schema";
import {
	assertApplicationAccess,
	getOrganizationId,
	upsertApplicationSwarmService,
} from "../../modules/application";
import { assertOrgRole } from "../../modules/projects";
import { protectedProcedure, router } from "../init";

const portFields = {
	publishedPort: z.number().int().min(1).max(65535),
	targetPort: z.number().int().min(1).max(65535),
	protocol: z.enum(["tcp", "udp"]).default("tcp"),
	publishMode: z.enum(["ingress", "host"]).default("ingress"),
} as const;

/** Load an application-owned port row and verify org ownership. */
const findApplicationPort = async (portId: string, organizationId: string) => {
	const port = await db.query.ports.findFirst({
		where: eq(ports.portId, portId),
	});
	if (!port?.applicationId) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Port not found" });
	}
	const application = await assertApplicationAccess(port.applicationId, organizationId);
	return { port, application };
};

export const portRouter = router({
	byApplication: protectedProcedure
		.input(z.object({ applicationId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertApplicationAccess(input.applicationId, organizationId);
			return db.query.ports.findMany({
				where: eq(ports.applicationId, input.applicationId),
				orderBy: ports.createdAt,
			});
		}),

	one: protectedProcedure
		.input(z.object({ portId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			const { port } = await findApplicationPort(input.portId, organizationId);
			return port;
		}),

	create: protectedProcedure
		.input(z.object({ applicationId: z.string().min(1), ...portFields }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertOrgRole(ctx.session.user.id, organizationId, "member");
			const application = await assertApplicationAccess(input.applicationId, organizationId);

			const [port] = await db
				.insert(ports)
				.values({
					publishedPort: input.publishedPort,
					targetPort: input.targetPort,
					protocol: input.protocol,
					publishMode: input.publishMode,
					applicationId: input.applicationId,
				})
				.returning();
			if (!port) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to create port",
				});
			}

			await upsertApplicationSwarmService(application);
			return port;
		}),

	update: protectedProcedure
		.input(
			z.object({
				portId: z.string().min(1),
				publishedPort: portFields.publishedPort.optional(),
				targetPort: portFields.targetPort.optional(),
				protocol: z.enum(["tcp", "udp"]).optional(),
				publishMode: z.enum(["ingress", "host"]).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertOrgRole(ctx.session.user.id, organizationId, "member");
			const { port, application } = await findApplicationPort(input.portId, organizationId);

			const [updated] = await db
				.update(ports)
				.set({
					publishedPort: input.publishedPort ?? port.publishedPort,
					targetPort: input.targetPort ?? port.targetPort,
					protocol: input.protocol ?? port.protocol,
					publishMode: input.publishMode ?? port.publishMode,
				})
				.where(eq(ports.portId, port.portId))
				.returning();

			await upsertApplicationSwarmService(application);
			return updated;
		}),

	delete: protectedProcedure
		.input(z.object({ portId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertOrgRole(ctx.session.user.id, organizationId, "member");
			const { port, application } = await findApplicationPort(input.portId, organizationId);

			await db.delete(ports).where(eq(ports.portId, port.portId));
			await upsertApplicationSwarmService(application);
			return { portId: port.portId };
		}),
});
