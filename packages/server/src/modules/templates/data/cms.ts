import type { TemplateData } from "../types";

export const cmsTemplates: TemplateData[] = [
	{
		id: "wordpress",
		name: "WordPress",
		description:
			"The world's most popular CMS — blogs, sites and stores with thousands of themes and plugins.",
		logo: "wordpress",
		tags: ["cms", "blog"],
		links: {
			website: "https://wordpress.org",
			github: "https://github.com/WordPress/WordPress",
			docs: "https://wordpress.org/documentation",
		},
		suggestedDomain: { serviceName: "wordpress", port: 80 },
		env: [
			{
				key: "WORDPRESS_DB_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of the wordpress database user",
			},
			{
				key: "MARIADB_ROOT_PASSWORD",
				default: "{{generateSecret}}",
				description: "MariaDB root password",
			},
		],
		compose: `services:
  wordpress:
    image: wordpress:6-apache
    restart: always
    depends_on:
      - wordpress_db
    environment:
      WORDPRESS_DB_HOST: wordpress_db
      WORDPRESS_DB_USER: wordpress
      WORDPRESS_DB_PASSWORD: \${WORDPRESS_DB_PASSWORD}
      WORDPRESS_DB_NAME: wordpress
    volumes:
      - wordpress-data:/var/www/html
  wordpress_db:
    image: mariadb:11
    restart: always
    environment:
      MARIADB_ROOT_PASSWORD: \${MARIADB_ROOT_PASSWORD}
      MARIADB_DATABASE: wordpress
      MARIADB_USER: wordpress
      MARIADB_PASSWORD: \${WORDPRESS_DB_PASSWORD}
    volumes:
      - wordpress-db-data:/var/lib/mysql
volumes:
  wordpress-data:
  wordpress-db-data:
`,
	},
	{
		id: "ghost",
		name: "Ghost",
		description: "Professional publishing platform — modern blogging, newsletters and memberships.",
		logo: "ghost",
		tags: ["cms", "blog", "newsletter"],
		links: {
			website: "https://ghost.org",
			github: "https://github.com/TryGhost/Ghost",
			docs: "https://ghost.org/docs",
		},
		suggestedDomain: { serviceName: "ghost", port: 2368 },
		env: [
			{
				key: "GHOST_URL",
				default: "http://localhost:2368",
				description: "Public URL of the blog (e.g. https://blog.example.com)",
			},
			{
				key: "MYSQL_ROOT_PASSWORD",
				default: "{{generateSecret}}",
				description: "MySQL root password",
			},
		],
		compose: `services:
  ghost:
    image: ghost:5-alpine
    restart: always
    depends_on:
      - ghost_db
    environment:
      url: \${GHOST_URL}
      database__client: mysql
      database__connection__host: ghost_db
      database__connection__user: root
      database__connection__password: \${MYSQL_ROOT_PASSWORD}
      database__connection__database: ghost
    volumes:
      - ghost-data:/var/lib/ghost/content
  ghost_db:
    image: mysql:8.0
    restart: always
    environment:
      MYSQL_ROOT_PASSWORD: \${MYSQL_ROOT_PASSWORD}
    volumes:
      - ghost-db-data:/var/lib/mysql
volumes:
  ghost-data:
  ghost-db-data:
`,
	},
	{
		id: "strapi",
		name: "Strapi",
		description:
			"Open-source headless CMS — build content APIs (REST & GraphQL) with a customizable admin panel.",
		logo: "strapi",
		tags: ["cms", "headless", "api"],
		links: {
			website: "https://strapi.io",
			github: "https://github.com/strapi/strapi",
			docs: "https://docs.strapi.io",
		},
		suggestedDomain: { serviceName: "strapi", port: 1337 },
		env: [
			{
				key: "DATABASE_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of the strapi PostgreSQL user",
			},
			{
				key: "APP_KEYS",
				default: "{{generateSecret}},{{generateSecret}}",
				description: "Comma-separated app keys for session encryption",
			},
			{
				key: "API_TOKEN_SALT",
				default: "{{generateSecret}}",
				description: "Salt for API tokens",
			},
			{
				key: "ADMIN_JWT_SECRET",
				default: "{{generateSecret}}",
				description: "JWT secret for the admin panel",
			},
			{
				key: "JWT_SECRET",
				default: "{{generateSecret}}",
				description: "JWT secret for users & permissions",
			},
		],
		compose: `services:
  strapi:
    image: strapi/strapi:latest
    restart: always
    depends_on:
      - strapi_db
    environment:
      DATABASE_CLIENT: postgres
      DATABASE_HOST: strapi_db
      DATABASE_PORT: "5432"
      DATABASE_NAME: strapi
      DATABASE_USERNAME: strapi
      DATABASE_PASSWORD: \${DATABASE_PASSWORD}
      APP_KEYS: "\${APP_KEYS}"
      API_TOKEN_SALT: \${API_TOKEN_SALT}
      ADMIN_JWT_SECRET: \${ADMIN_JWT_SECRET}
      JWT_SECRET: \${JWT_SECRET}
    volumes:
      - strapi-data:/srv/app
  strapi_db:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_USER: strapi
      POSTGRES_PASSWORD: \${DATABASE_PASSWORD}
      POSTGRES_DB: strapi
    volumes:
      - strapi-db-data:/var/lib/postgresql/data
volumes:
  strapi-data:
  strapi-db-data:
`,
	},
	{
		id: "directus",
		name: "Directus",
		description:
			"Open data platform — instant REST & GraphQL APIs and a no-code data studio on top of any SQL database.",
		logo: "directus",
		tags: ["cms", "headless", "api"],
		links: {
			website: "https://directus.io",
			github: "https://github.com/directus/directus",
			docs: "https://directus.io/docs",
		},
		suggestedDomain: { serviceName: "directus", port: 8055 },
		env: [
			{
				key: "KEY",
				default: "{{generateSecret}}",
				description: "Unique identifier of the project",
			},
			{
				key: "SECRET",
				default: "{{generateSecret}}",
				description: "Secret for signing tokens",
			},
			{
				key: "ADMIN_EMAIL",
				default: "admin@example.com",
				description: "Email of the initial admin user",
			},
			{
				key: "ADMIN_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of the initial admin user",
			},
			{
				key: "DB_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of the directus PostgreSQL user",
			},
			{
				key: "PUBLIC_URL",
				default: "http://localhost:8055",
				description: "Public URL of the instance",
			},
		],
		compose: `services:
  directus:
    image: directus/directus:11
    restart: always
    depends_on:
      - directus_db
    environment:
      KEY: \${KEY}
      SECRET: \${SECRET}
      ADMIN_EMAIL: \${ADMIN_EMAIL}
      ADMIN_PASSWORD: \${ADMIN_PASSWORD}
      PUBLIC_URL: \${PUBLIC_URL}
      DB_CLIENT: pg
      DB_HOST: directus_db
      DB_PORT: "5432"
      DB_DATABASE: directus
      DB_USER: directus
      DB_PASSWORD: \${DB_PASSWORD}
      WEBSOCKETS_ENABLED: "true"
    volumes:
      - directus-uploads:/directus/uploads
      - directus-extensions:/directus/extensions
  directus_db:
    image: postgis/postgis:16-3.4-alpine
    restart: always
    environment:
      POSTGRES_USER: directus
      POSTGRES_PASSWORD: \${DB_PASSWORD}
      POSTGRES_DB: directus
    volumes:
      - directus-db-data:/var/lib/postgresql/data
volumes:
  directus-uploads:
  directus-extensions:
  directus-db-data:
`,
	},
	{
		id: "nocodb",
		name: "NocoDB",
		description:
			"Open-source Airtable alternative — turn any database into a smart spreadsheet with views and automations.",
		logo: "",
		tags: ["database", "nocode", "spreadsheet"],
		links: {
			website: "https://nocodb.com",
			github: "https://github.com/nocodb/nocodb",
			docs: "https://docs.nocodb.com",
		},
		suggestedDomain: { serviceName: "nocodb", port: 8080 },
		env: [
			{
				key: "POSTGRES_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of the nocodb PostgreSQL user",
			},
		],
		compose: `services:
  nocodb:
    image: nocodb/nocodb:latest
    restart: always
    depends_on:
      - nocodb_db
    environment:
      NC_DB: "pg://nocodb_db:5432?u=nocodb&p=\${POSTGRES_PASSWORD}&d=nocodb"
  nocodb_db:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_USER: nocodb
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: nocodb
    volumes:
      - nocodb-db-data:/var/lib/postgresql/data
volumes:
  nocodb-db-data:
`,
	},
	{
		id: "halo",
		name: "Halo",
		description:
			"Modern open-source publishing platform — clean editor, themes and plugins, popular in the blogging community.",
		logo: "",
		tags: ["cms", "blog", "publishing"],
		links: {
			website: "https://www.halo.run",
			github: "https://github.com/halo-dev/halo",
			docs: "https://docs.halo.run",
		},
		suggestedDomain: { serviceName: "halo", port: 8090 },
		env: [
			{
				key: "HALO_EXTERNAL_URL",
				default: "http://localhost:8090",
				description: "Public URL of this Halo instance",
			},
		],
		compose: `services:
  halo:
    image: halohub/halo:2
    restart: always
    environment:
      HALO_EXTERNAL_URL: \${HALO_EXTERNAL_URL}
    volumes:
      - halo-data:/root/.halo2
volumes:
  halo-data:
`,
	},
];
