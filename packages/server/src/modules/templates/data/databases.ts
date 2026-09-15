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
    image: mongo:8
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
    image: redis:8-alpine
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
	{
		id: "pgweb",
		name: "pgweb",
		description:
			"Single-binary PostgreSQL browser — connect from the UI, run queries, inspect rows and export the result.",
		logo: "postgresql",
		tags: ["database", "postgres", "admin"],
		links: {
			website: "https://sosedoff.github.io/pgweb/",
			github: "https://github.com/sosedoff/pgweb",
			docs: "https://github.com/sosedoff/pgweb/wiki",
		},
		suggestedDomain: { serviceName: "pgweb", port: 8081 },
		env: [],
		compose: `services:
  pgweb:
    image: sosedoff/pgweb:latest
    restart: always
    environment:
      PGWEB_SESSIONS: "1"
`,
	},
	{
		id: "redisinsight",
		name: "RedisInsight",
		description:
			"Redis' own GUI — browse keys by type, run commands, profile slow queries and watch memory in real time.",
		logo: "redis",
		tags: ["database", "redis", "admin"],
		links: {
			website: "https://redis.io/insight/",
			github: "https://github.com/RedisInsight/RedisInsight",
			docs: "https://redis.io/docs/latest/operate/redisinsight/",
		},
		suggestedDomain: { serviceName: "redisinsight", port: 5540 },
		env: [],
		compose: `services:
  redisinsight:
    image: redis/redisinsight:latest
    restart: always
    volumes:
      - redisinsight-data:/data
volumes:
  redisinsight-data:
`,
	},
	{
		id: "sqlpad",
		name: "SQLPad",
		description:
			"Shared SQL workbench — saved queries, charts and results your team can open by link, across several database engines.",
		logo: "",
		tags: ["database", "sql", "admin"],
		links: {
			website: "https://getsqlpad.com",
			github: "https://github.com/sqlpad/sqlpad",
			docs: "https://getsqlpad.com/en/introduction/",
		},
		suggestedDomain: { serviceName: "sqlpad", port: 3000 },
		env: [
			{
				key: "SQLPAD_ADMIN",
				default: "admin@example.com",
				description: "Email of the account created on first boot",
			},
			{
				key: "SQLPAD_ADMIN_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of that account",
			},
		],
		compose: `services:
  sqlpad:
    image: sqlpad/sqlpad:latest
    restart: always
    environment:
      SQLPAD_ADMIN: \${SQLPAD_ADMIN}
      SQLPAD_ADMIN_PASSWORD: \${SQLPAD_ADMIN_PASSWORD}
      SQLPAD_APP_LOG_LEVEL: info
      SQLPAD_DB_PATH: /var/lib/sqlpad
    volumes:
      - sqlpad-data:/var/lib/sqlpad
volumes:
  sqlpad-data:
`,
	},
	{
		id: "dbgate",
		name: "DbGate",
		description:
			"One client for PostgreSQL, MySQL, SQL Server, MongoDB and SQLite — table editor, query tabs and schema compare.",
		logo: "https://cdn.jsdelivr.net/gh/selfhst/icons/png/dbgate.png",
		tags: ["database", "admin", "sql"],
		links: {
			website: "https://dbgate.org",
			github: "https://github.com/dbgate/dbgate",
			docs: "https://dbgate.org/docs/",
		},
		suggestedDomain: { serviceName: "dbgate", port: 3000 },
		env: [],
		compose: `services:
  dbgate:
    image: dbgate/dbgate:latest
    restart: always
    volumes:
      - dbgate-data:/root/.dbgate
volumes:
  dbgate-data:
`,
	},
];
