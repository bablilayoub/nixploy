CREATE TABLE "application_tag" (
	"application_id" text NOT NULL,
	"tag_id" text NOT NULL,
	CONSTRAINT "application_tag_application_id_tag_id_pk" PRIMARY KEY("application_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "compose_tag" (
	"compose_id" text NOT NULL,
	"tag_id" text NOT NULL,
	CONSTRAINT "compose_tag_compose_id_tag_id_pk" PRIMARY KEY("compose_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "mariadb_tag" (
	"mariadb_id" text NOT NULL,
	"tag_id" text NOT NULL,
	CONSTRAINT "mariadb_tag_mariadb_id_tag_id_pk" PRIMARY KEY("mariadb_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "mongo_tag" (
	"mongo_id" text NOT NULL,
	"tag_id" text NOT NULL,
	CONSTRAINT "mongo_tag_mongo_id_tag_id_pk" PRIMARY KEY("mongo_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "mysql_tag" (
	"mysql_id" text NOT NULL,
	"tag_id" text NOT NULL,
	CONSTRAINT "mysql_tag_mysql_id_tag_id_pk" PRIMARY KEY("mysql_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "postgres_tag" (
	"postgres_id" text NOT NULL,
	"tag_id" text NOT NULL,
	CONSTRAINT "postgres_tag_postgres_id_tag_id_pk" PRIMARY KEY("postgres_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "redis_tag" (
	"redis_id" text NOT NULL,
	"tag_id" text NOT NULL,
	CONSTRAINT "redis_tag_redis_id_tag_id_pk" PRIMARY KEY("redis_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "application_tag" ADD CONSTRAINT "application_tag_application_id_application_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("application_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_tag" ADD CONSTRAINT "application_tag_tag_id_tag_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("tag_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compose_tag" ADD CONSTRAINT "compose_tag_compose_id_compose_compose_id_fk" FOREIGN KEY ("compose_id") REFERENCES "public"."compose"("compose_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compose_tag" ADD CONSTRAINT "compose_tag_tag_id_tag_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("tag_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mariadb_tag" ADD CONSTRAINT "mariadb_tag_mariadb_id_mariadb_mariadb_id_fk" FOREIGN KEY ("mariadb_id") REFERENCES "public"."mariadb"("mariadb_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mariadb_tag" ADD CONSTRAINT "mariadb_tag_tag_id_tag_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("tag_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mongo_tag" ADD CONSTRAINT "mongo_tag_mongo_id_mongo_mongo_id_fk" FOREIGN KEY ("mongo_id") REFERENCES "public"."mongo"("mongo_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mongo_tag" ADD CONSTRAINT "mongo_tag_tag_id_tag_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("tag_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mysql_tag" ADD CONSTRAINT "mysql_tag_mysql_id_mysql_mysql_id_fk" FOREIGN KEY ("mysql_id") REFERENCES "public"."mysql"("mysql_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mysql_tag" ADD CONSTRAINT "mysql_tag_tag_id_tag_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("tag_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postgres_tag" ADD CONSTRAINT "postgres_tag_postgres_id_postgres_postgres_id_fk" FOREIGN KEY ("postgres_id") REFERENCES "public"."postgres"("postgres_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postgres_tag" ADD CONSTRAINT "postgres_tag_tag_id_tag_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("tag_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redis_tag" ADD CONSTRAINT "redis_tag_redis_id_redis_redis_id_fk" FOREIGN KEY ("redis_id") REFERENCES "public"."redis"("redis_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redis_tag" ADD CONSTRAINT "redis_tag_tag_id_tag_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("tag_id") ON DELETE cascade ON UPDATE no action;