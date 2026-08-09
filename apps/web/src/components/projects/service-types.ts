import { AppWindow, Boxes, Database, type LucideIcon } from "lucide-react";

/** Service kinds shown on the project page; route segment under /services/<type>/<id>. */
export type ServiceType =
	| "application"
	| "compose"
	| "postgres"
	| "mysql"
	| "mariadb"
	| "mongo"
	| "redis";

export const DATABASE_TYPES = [
	"postgres",
	"mysql",
	"mariadb",
	"mongo",
	"redis",
] as const satisfies readonly ServiceType[];

export type DatabaseType = (typeof DATABASE_TYPES)[number];

interface ServiceTypeMeta {
	label: string;
	icon: LucideIcon;
	/** Single neutral treatment for every service-type icon — StatusDot carries the color. */
	iconClassName: string;
}

const NEUTRAL_ICON_CLASS = "text-muted-foreground";

export const SERVICE_TYPE_META: Record<ServiceType, ServiceTypeMeta> = {
	application: {
		label: "Application",
		icon: AppWindow,
		iconClassName: NEUTRAL_ICON_CLASS,
	},
	compose: {
		label: "Compose",
		icon: Boxes,
		iconClassName: NEUTRAL_ICON_CLASS,
	},
	postgres: {
		label: "PostgreSQL",
		icon: Database,
		iconClassName: NEUTRAL_ICON_CLASS,
	},
	mysql: {
		label: "MySQL",
		icon: Database,
		iconClassName: NEUTRAL_ICON_CLASS,
	},
	mariadb: {
		label: "MariaDB",
		icon: Database,
		iconClassName: NEUTRAL_ICON_CLASS,
	},
	mongo: {
		label: "MongoDB",
		icon: Database,
		iconClassName: NEUTRAL_ICON_CLASS,
	},
	redis: {
		label: "Redis",
		icon: Database,
		iconClassName: NEUTRAL_ICON_CLASS,
	},
};
