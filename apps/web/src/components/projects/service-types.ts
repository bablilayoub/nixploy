import {
	DATABASE_KINDS,
	SERVICE_KIND_ID_FIELDS,
	SERVICE_KIND_LABELS,
	SERVICE_KINDS,
	type ServiceKind,
} from "@nixploy/server/modules/services/kinds";
import { AppWindow, Boxes, Database, type LucideIcon } from "lucide-react";

/**
 * The service-kind facts the panel needs. The kind tuple, its labels and the
 * `<kind>Id` input keys come from the server's service registry
 * (`@nixploy/server/modules/services/kinds` — a dependency-free module, safe
 * in the client bundle) so the panel cannot drift from the routers, the
 * `service_type` pgEnum or the GitOps schema. Only the icons are panel-local.
 */

/** Service kinds shown on the project page; route segment under /services/<type>/<id>. */
export type ServiceType = ServiceKind;

export const SERVICE_TYPES = SERVICE_KINDS;

export const DATABASE_TYPES = DATABASE_KINDS;

export type DatabaseType = (typeof DATABASE_TYPES)[number];

/** Keyed id field of a service's tRPC procedures (`{ postgresId: "…" }`). */
export const ID_FIELD = SERVICE_KIND_ID_FIELDS;

interface ServiceTypeMeta {
	label: string;
	icon: LucideIcon;
	/** Single neutral treatment for every service-type icon — StatusDot carries the color. */
	iconClassName: string;
}

const NEUTRAL_ICON_CLASS = "text-muted-foreground";

const ICONS: Record<ServiceType, LucideIcon> = {
	application: AppWindow,
	compose: Boxes,
	postgres: Database,
	mysql: Database,
	mariadb: Database,
	mongo: Database,
	redis: Database,
};

export const SERVICE_TYPE_META: Record<ServiceType, ServiceTypeMeta> = Object.fromEntries(
	SERVICE_KINDS.map((kind) => [
		kind,
		{
			label: SERVICE_KIND_LABELS[kind],
			icon: ICONS[kind],
			iconClassName: NEUTRAL_ICON_CLASS,
		},
	]),
) as Record<ServiceType, ServiceTypeMeta>;

/** Keyed id input shared by every service procedure (`{ composeId: "…" }`). */
export type ServiceIdInput = Record<string, string>;

/**
 * The slice of a service router the kind-agnostic project surfaces call.
 * All seven routers expose the same keyed-id lifecycle procedures, so the
 * panel dispatches on `service.type` instead of writing seven branches —
 * see `buildDatabaseRouter` and the application/compose routers.
 */
export interface ServiceRouterClient {
	start: { mutate: (input: ServiceIdInput) => Promise<unknown> };
	stop: { mutate: (input: ServiceIdInput) => Promise<unknown> };
	duplicate: { mutate: (input: ServiceIdInput) => Promise<unknown> };
	move: { mutate: (input: ServiceIdInput & { environmentId: string }) => Promise<unknown> };
}

/**
 * Narrow the tRPC client to one service kind's shared lifecycle surface. The
 * client's own type indexes each router separately, so a union `kind` cannot
 * be called through it; this is the one place that widens it, and the shape
 * above is what keeps the call sites typed.
 */
export const serviceRouterClient = (client: unknown, kind: ServiceType): ServiceRouterClient =>
	(client as Record<ServiceType, ServiceRouterClient>)[kind];
