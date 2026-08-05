import type { TemplateData } from "../types";

/** `${...}` sequences are escaped so the compose bodies keep them verbatim. */

export const databaseTemplates: TemplateData[] = [
	{
		id: "pgadmin",
		name: "pgAdmin 4",
		description:
			"The most popular administration and development platform for PostgreSQL — query tool, dashboards and schema browser.",
		logo: "postgresql",
		tags: ["database", "admin", "postgres"],
		links: {
			website: "https://www.pgadmin.org",
			docs: "https://www.pgadmin.org/docs",
		},
		suggestedDomain: { serviceName: "pgadmin", port: 80 },
		env: [
			{
				key: "PGADMIN_DEFAULT_EMAIL",
				default: "admin@example.com",
				description: "Initial pgAdmin login email",
			},
			{
				key: "PGADMIN_DEFAULT_PASSWORD",
				default: "{{generateSecret}}",
				description: "Initial pgAdmin login password",
			},
		],
		compose: `services:
  pgadmin:
    image: dpage/pgadmin4:latest
    restart: always
    environment:
      PGADMIN_DEFAULT_EMAIL: \${PGADMIN_DEFAULT_EMAIL}
      PGADMIN_DEFAULT_PASSWORD: \${PGADMIN_DEFAULT_PASSWORD}
    volumes:
      - pgadmin-data:/var/lib/pgadmin
volumes:
  pgadmin-data:
`,
	},
	{
		id: "adminer",
		name: "Adminer",
		description:
			"Full-featured database management in a single file — MySQL, PostgreSQL, SQLite, MongoDB and more.",
		logo: "adminer",
		tags: ["database", "admin", "lightweight"],
		links: {
			website: "https://www.adminer.org",
			github: "https://github.com/vrana/adminer",
		},
		suggestedDomain: { serviceName: "adminer", port: 8080 },
		env: [],
		compose: `services:
  adminer:
    image: adminer:latest
    restart: always
`,
	},
	{
		id: "cloudbeaver",
		name: "CloudBeaver",
		description:
			"DBeaver's web-based database manager — browse, query and administer nearly any database from the browser.",
		logo: "dbeaver",
		tags: ["database", "admin", "sql"],
		links: {
			website: "https://dbeaver.com",
			github: "https://github.com/dbeaver/cloudbeaver",
			docs: "https://dbeaver.com/docs/cloudbeaver",
		},
		suggestedDomain: { serviceName: "cloudbeaver", port: 8978 },
		env: [],
		compose: `services:
  cloudbeaver:
    image: dbeaver/cloudbeaver:latest
    restart: always
    volumes:
      - cloudbeaver-data:/opt/cloudbeaver/workspace
volumes:
  cloudbeaver-data:
`,
	},
	{
		id: "mongo-express",
		name: "Mongo Express",
		description:
			"Web-based MongoDB admin interface — bundles a MongoDB instance, or point it at your own server.",
		logo: "mongodb",
		tags: ["database", "admin", "mongodb"],
		links: {
			github: "https://github.com/mongo-express/mongo-express",
			docs: "https://github.com/mongo-express/mongo-express",
		},
		suggestedDomain: { serviceName: "mongo-express", port: 8081 },
		env: [
			{
				key: "MONGO_ROOT_USERNAME",
				default: "admin",
				description: "MongoDB root username",
			},
			{
				key: "MONGO_ROOT_PASSWORD",
				default: "{{generateSecret}}",
				description: "MongoDB root password",
			},
		],
		compose: `services:
  mongo:
    image: mongo:7
    restart: always
    environment:
      MONGO_INITDB_ROOT_USERNAME: \${MONGO_ROOT_USERNAME}
      MONGO_INITDB_ROOT_PASSWORD: \${MONGO_ROOT_PASSWORD}
    volumes:
      - mongo-data:/data/db
  mongo-express:
    image: mongo-express:latest
    restart: always
    depends_on:
      - mongo
    environment:
      ME_CONFIG_MONGODB_SERVER: mongo
      ME_CONFIG_MONGODB_ADMINUSERNAME: \${MONGO_ROOT_USERNAME}
      ME_CONFIG_MONGODB_ADMINPASSWORD: \${MONGO_ROOT_PASSWORD}
volumes:
  mongo-data:
`,
	},
	{
		id: "redis-commander",
		name: "Redis Commander",
		description:
			"Web management tool for Redis — view, edit and manage keys. Bundles a Redis instance to explore.",
		logo: "redis",
		tags: ["database", "admin", "redis"],
		links: {
			github: "https://github.com/joeferner/redis-commander",
			docs: "https://github.com/joeferner/redis-commander",
		},
		suggestedDomain: { serviceName: "redis-commander", port: 8081 },
		env: [],
		compose: `services:
  redis:
    image: redis:7-alpine
    restart: always
    volumes:
      - redis-data:/data
  redis-commander:
    image: rediscommander/redis-commander:latest
    restart: always
    depends_on:
      - redis
    environment:
      REDIS_HOSTS: local:redis:6379
volumes:
  redis-data:
`,
	},
	{
		id: "phpmyadmin",
		name: "phpMyAdmin",
		description:
			"The classic web interface for MySQL and MariaDB — arbitrary-server mode, connect to any host.",
		logo: "phpmyadmin",
		tags: ["database", "admin", "mysql"],
		links: {
			website: "https://www.phpmyadmin.net",
			github: "https://github.com/phpmyadmin/phpmyadmin",
			docs: "https://docs.phpmyadmin.net",
		},
		suggestedDomain: { serviceName: "phpmyadmin", port: 80 },
		env: [],
		compose: `services:
  phpmyadmin:
    image: phpmyadmin:latest
    restart: always
    environment:
      PMA_ARBITRARY: "1"
`,
	},
];
