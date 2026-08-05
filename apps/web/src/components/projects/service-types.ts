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
	iconClassName: string;
}

export const SERVICE_TYPE_META: Record<ServiceType, ServiceTypeMeta> = {
	application: {
		label: "Application",
		icon: AppWindow,
		iconClassName: "text-sky-400",
	},
	compose: {
		label: "Compose",
		icon: Boxes,
		iconClassName: "text-violet-400",
	},
	postgres: {
		label: "PostgreSQL",
		icon: Database,
		iconClassName: "text-blue-400",
	},
	mysql: {
		label: "MySQL",
		icon: Database,
		iconClassName: "text-orange-400",
	},
	mariadb: {
		label: "MariaDB",
		icon: Database,
		iconClassName: "text-teal-400",
	},
	mongo: {
		label: "MongoDB",
		icon: Database,
		iconClassName: "text-green-400",
	},
	redis: {
		label: "Redis",
		icon: Database,
		iconClassName: "text-red-400",
	},
};
