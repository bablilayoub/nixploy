CREATE TYPE "public"."domain_protocol" AS ENUM('http', 'tcp', 'udp');--> statement-breakpoint
CREATE TYPE "public"."domain_tls_mode" AS ENUM('none', 'terminate', 'passthrough');--> statement-breakpoint
CREATE TABLE "database_logical" (
	"database_logical_id" text PRIMARY KEY NOT NULL,
	"service_type" "service_type" NOT NULL,
	"name" text NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"postgres_id" text,
	"mysql_id" text,
	"mariadb_id" text,
	"mongo_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "traefik_entrypoint" (
	"traefik_entrypoint_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"port" integer NOT NULL,
	"protocol" "port_protocol" DEFAULT 'tcp' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mariadb" ADD COLUMN "engine_version" text;--> statement-breakpoint
ALTER TABLE "mongo" ADD COLUMN "engine_version" text;--> statement-breakpoint
ALTER TABLE "mysql" ADD COLUMN "engine_version" text;--> statement-breakpoint
ALTER TABLE "postgres" ADD COLUMN "engine_version" text;--> statement-breakpoint
ALTER TABLE "redis" ADD COLUMN "engine_version" text;--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN "protocol" "domain_protocol" DEFAULT 'http' NOT NULL;--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN "entrypoint" text;--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN "tls_mode" "domain_tls_mode" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "database_logical" ADD CONSTRAINT "database_logical_postgres_id_postgres_postgres_id_fk" FOREIGN KEY ("postgres_id") REFERENCES "public"."postgres"("postgres_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "database_logical" ADD CONSTRAINT "database_logical_mysql_id_mysql_mysql_id_fk" FOREIGN KEY ("mysql_id") REFERENCES "public"."mysql"("mysql_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "database_logical" ADD CONSTRAINT "database_logical_mariadb_id_mariadb_mariadb_id_fk" FOREIGN KEY ("mariadb_id") REFERENCES "public"."mariadb"("mariadb_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "database_logical" ADD CONSTRAINT "database_logical_mongo_id_mongo_mongo_id_fk" FOREIGN KEY ("mongo_id") REFERENCES "public"."mongo"("mongo_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "database_logical_postgres_name_unique" ON "database_logical" USING btree ("postgres_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "database_logical_mysql_name_unique" ON "database_logical" USING btree ("mysql_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "database_logical_mariadb_name_unique" ON "database_logical" USING btree ("mariadb_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "database_logical_mongo_name_unique" ON "database_logical" USING btree ("mongo_id","name");--> statement-breakpoint
CREATE INDEX "database_logical_service_type_idx" ON "database_logical" USING btree ("service_type");--> statement-breakpoint
CREATE UNIQUE INDEX "traefik_entrypoint_name_unique" ON "traefik_entrypoint" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "traefik_entrypoint_port_unique" ON "traefik_entrypoint" USING btree ("port","protocol");