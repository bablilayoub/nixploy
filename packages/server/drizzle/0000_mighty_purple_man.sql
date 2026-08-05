CREATE TYPE "public"."application_source_type" AS ENUM('docker', 'git', 'github', 'gitlab', 'bitbucket', 'gitea', 'drop');--> statement-breakpoint
CREATE TYPE "public"."build_type" AS ENUM('dockerfile', 'heroku_buildpacks', 'paketo_buildpacks', 'nixpacks', 'static', 'railpack');--> statement-breakpoint
CREATE TYPE "public"."certificate_type" AS ENUM('letsencrypt', 'custom', 'none');--> statement-breakpoint
CREATE TYPE "public"."compose_source_type" AS ENUM('git', 'github', 'gitlab', 'bitbucket', 'gitea', 'raw');--> statement-breakpoint
CREATE TYPE "public"."compose_type" AS ENUM('docker-compose', 'stack');--> statement-breakpoint
CREATE TYPE "public"."database_type" AS ENUM('postgres', 'mysql', 'mariadb', 'mongo', 'web-server');--> statement-breakpoint
CREATE TYPE "public"."deployment_status" AS ENUM('running', 'done', 'error', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."domain_type" AS ENUM('application', 'compose', 'preview');--> statement-breakpoint
CREATE TYPE "public"."git_provider_type" AS ENUM('github', 'gitlab', 'bitbucket', 'gitea');--> statement-breakpoint
CREATE TYPE "public"."mount_type" AS ENUM('bind', 'volume', 'file');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('slack', 'telegram', 'discord', 'email', 'gotify', 'ntfy', 'pushover', 'custom');--> statement-breakpoint
CREATE TYPE "public"."port_protocol" AS ENUM('tcp', 'udp');--> statement-breakpoint
CREATE TYPE "public"."preview_status" AS ENUM('idle', 'running', 'done', 'error');--> statement-breakpoint
CREATE TYPE "public"."publish_mode" AS ENUM('ingress', 'host');--> statement-breakpoint
CREATE TYPE "public"."registry_type" AS ENUM('selfHosted', 'cloud');--> statement-breakpoint
CREATE TYPE "public"."schedule_type" AS ENUM('application', 'compose', 'server', 'nixploy-server');--> statement-breakpoint
CREATE TYPE "public"."server_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."service_status" AS ENUM('idle', 'running', 'done', 'error');--> statement-breakpoint
CREATE TYPE "public"."service_type" AS ENUM('application', 'compose', 'postgres', 'mysql', 'mariadb', 'mongo', 'redis');--> statement-breakpoint
CREATE TYPE "public"."shell_type" AS ENUM('bash', 'sh');--> statement-breakpoint
CREATE TABLE "application" (
	"application_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"app_name" text NOT NULL,
	"description" text,
	"env" text,
	"build_args" text,
	"status" "service_status" DEFAULT 'idle' NOT NULL,
	"memory_reservation" text,
	"memory_limit" text,
	"cpu_reservation" text,
	"cpu_limit" text,
	"replicas" integer DEFAULT 1 NOT NULL,
	"command" text,
	"source_type" "application_source_type" DEFAULT 'github' NOT NULL,
	"repository" text,
	"owner" text,
	"branch" text,
	"build_path" text DEFAULT '/' NOT NULL,
	"auto_deploy" boolean DEFAULT true NOT NULL,
	"watch_paths" text[],
	"docker_image" text,
	"username" text,
	"password" text,
	"registry_id" text,
	"git_url" text,
	"git_branch" text,
	"custom_git_ssh_key_id" text,
	"github_id" text,
	"gitlab_id" text,
	"bitbucket_id" text,
	"gitea_id" text,
	"build_type" "build_type" DEFAULT 'nixpacks' NOT NULL,
	"dockerfile" text,
	"docker_context_path" text,
	"docker_build_stage" text,
	"publish_directory" text,
	"is_static_spa" boolean,
	"health_check_swarm" jsonb,
	"restart_policy_swarm" jsonb,
	"placement_swarm" jsonb,
	"update_config_swarm" jsonb,
	"rollback_config_swarm" jsonb,
	"mode_swarm" jsonb,
	"labels_swarm" jsonb,
	"network_swarm" jsonb,
	"environment_id" text NOT NULL,
	"server_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_app_name_unique" UNIQUE("app_name")
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apikey" (
	"id" text PRIMARY KEY NOT NULL,
	"config_id" text DEFAULT 'default' NOT NULL,
	"name" text,
	"start" text,
	"prefix" text,
	"key" text NOT NULL,
	"reference_id" text NOT NULL,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"rate_limit_enabled" boolean DEFAULT false NOT NULL,
	"rate_limit_time_window" integer,
	"rate_limit_max" integer,
	"request_count" integer DEFAULT 0 NOT NULL,
	"remaining" integer,
	"last_request" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"permissions" text,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"impersonated_by" text,
	"active_organization_id" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role" text,
	"banned" boolean,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	"two_factor_enabled" boolean,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup" (
	"backup_id" text PRIMARY KEY NOT NULL,
	"app_name" text NOT NULL,
	"schedule" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"prefix" text DEFAULT 'backup' NOT NULL,
	"database" text NOT NULL,
	"database_type" "database_type" NOT NULL,
	"keep_latest_count" integer,
	"destination_id" text NOT NULL,
	"postgres_id" text,
	"mysql_id" text,
	"mariadb_id" text,
	"mongo_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "destination" (
	"destination_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"access_key" text NOT NULL,
	"secret_access_key" text NOT NULL,
	"bucket" text NOT NULL,
	"region" text NOT NULL,
	"endpoint" text NOT NULL,
	"provider" text DEFAULT 's3' NOT NULL,
	"organization_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "volume_backup" (
	"volume_backup_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"volume_name" text NOT NULL,
	"service_type" "service_type" NOT NULL,
	"cron_expression" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"prefix" text DEFAULT 'volume-backup' NOT NULL,
	"keep_latest_count" integer,
	"destination_id" text NOT NULL,
	"application_id" text,
	"compose_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compose" (
	"compose_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"app_name" text NOT NULL,
	"description" text,
	"env" text,
	"status" "service_status" DEFAULT 'idle' NOT NULL,
	"compose_type" "compose_type" DEFAULT 'docker-compose' NOT NULL,
	"compose_file" text DEFAULT '' NOT NULL,
	"source_type" "compose_source_type" DEFAULT 'raw' NOT NULL,
	"repository" text,
	"owner" text,
	"branch" text,
	"compose_path" text DEFAULT './docker-compose.yml' NOT NULL,
	"auto_deploy" boolean DEFAULT true NOT NULL,
	"watch_paths" text[],
	"git_url" text,
	"git_branch" text,
	"custom_git_ssh_key_id" text,
	"github_id" text,
	"gitlab_id" text,
	"bitbucket_id" text,
	"gitea_id" text,
	"isolated_deployment" boolean DEFAULT false NOT NULL,
	"suffix" text DEFAULT '' NOT NULL,
	"environment_id" text NOT NULL,
	"server_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compose_app_name_unique" UNIQUE("app_name")
);
--> statement-breakpoint
CREATE TABLE "mariadb" (
	"mariadb_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"app_name" text NOT NULL,
	"description" text,
	"env" text,
	"status" "service_status" DEFAULT 'idle' NOT NULL,
	"docker_image" text DEFAULT 'mariadb:11' NOT NULL,
	"database_name" text NOT NULL,
	"database_user" text NOT NULL,
	"database_password" text NOT NULL,
	"database_root_password" text NOT NULL,
	"external_port" integer,
	"command" text,
	"memory_reservation" text,
	"memory_limit" text,
	"cpu_reservation" text,
	"cpu_limit" text,
	"environment_id" text NOT NULL,
	"server_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mariadb_app_name_unique" UNIQUE("app_name")
);
--> statement-breakpoint
CREATE TABLE "mongo" (
	"mongo_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"app_name" text NOT NULL,
	"description" text,
	"env" text,
	"status" "service_status" DEFAULT 'idle' NOT NULL,
	"docker_image" text DEFAULT 'mongo:6' NOT NULL,
	"database_user" text NOT NULL,
	"database_password" text NOT NULL,
	"external_port" integer,
	"command" text,
	"replica_set" text DEFAULT '' NOT NULL,
	"memory_reservation" text,
	"memory_limit" text,
	"cpu_reservation" text,
	"cpu_limit" text,
	"environment_id" text NOT NULL,
	"server_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mongo_app_name_unique" UNIQUE("app_name")
);
--> statement-breakpoint
CREATE TABLE "mysql" (
	"mysql_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"app_name" text NOT NULL,
	"description" text,
	"env" text,
	"status" "service_status" DEFAULT 'idle' NOT NULL,
	"docker_image" text DEFAULT 'mysql:8' NOT NULL,
	"database_name" text NOT NULL,
	"database_user" text NOT NULL,
	"database_password" text NOT NULL,
	"database_root_password" text NOT NULL,
	"external_port" integer,
	"command" text,
	"memory_reservation" text,
	"memory_limit" text,
	"cpu_reservation" text,
	"cpu_limit" text,
	"environment_id" text NOT NULL,
	"server_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mysql_app_name_unique" UNIQUE("app_name")
);
--> statement-breakpoint
CREATE TABLE "postgres" (
	"postgres_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"app_name" text NOT NULL,
	"description" text,
	"env" text,
	"status" "service_status" DEFAULT 'idle' NOT NULL,
	"docker_image" text DEFAULT 'postgres:15' NOT NULL,
	"database_name" text NOT NULL,
	"database_user" text NOT NULL,
	"database_password" text NOT NULL,
	"external_port" integer,
	"command" text,
	"memory_reservation" text,
	"memory_limit" text,
	"cpu_reservation" text,
	"cpu_limit" text,
	"environment_id" text NOT NULL,
	"server_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "postgres_app_name_unique" UNIQUE("app_name")
);
--> statement-breakpoint
CREATE TABLE "redis" (
	"redis_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"app_name" text NOT NULL,
	"description" text,
	"env" text,
	"status" "service_status" DEFAULT 'idle' NOT NULL,
	"docker_image" text DEFAULT 'redis:7' NOT NULL,
	"database_password" text NOT NULL,
	"external_port" integer,
	"command" text,
	"memory_reservation" text,
	"memory_limit" text,
	"cpu_reservation" text,
	"cpu_limit" text,
	"environment_id" text NOT NULL,
	"server_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "redis_app_name_unique" UNIQUE("app_name")
);
--> statement-breakpoint
CREATE TABLE "deployment" (
	"deployment_id" text PRIMARY KEY NOT NULL,
	"title" text DEFAULT 'Deployment' NOT NULL,
	"description" text,
	"status" "deployment_status" DEFAULT 'running' NOT NULL,
	"log_path" text NOT NULL,
	"pid" text,
	"is_preview" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"application_id" text,
	"compose_id" text,
	"schedule_id" text,
	"server_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "preview_deployment" (
	"preview_deployment_id" text PRIMARY KEY NOT NULL,
	"app_name" text NOT NULL,
	"branch" text,
	"pull_request_id" text,
	"pull_request_number" text,
	"pull_request_title" text,
	"pull_request_url" text,
	"preview_status" "preview_status" DEFAULT 'idle' NOT NULL,
	"domain_id" text,
	"expires_at" timestamp with time zone,
	"application_id" text NOT NULL,
	"server_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rollback" (
	"rollback_id" text PRIMARY KEY NOT NULL,
	"image" text NOT NULL,
	"full_context" text,
	"version" text,
	"application_id" text NOT NULL,
	"deployment_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certificate" (
	"certificate_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"certificate_data" text NOT NULL,
	"private_key" text NOT NULL,
	"certificate_path" text NOT NULL,
	"auto_renew" boolean DEFAULT false NOT NULL,
	"server_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain" (
	"domain_id" text PRIMARY KEY NOT NULL,
	"host" text NOT NULL,
	"path" text DEFAULT '/',
	"internal_path" text,
	"port" integer,
	"https" boolean DEFAULT false NOT NULL,
	"certificate_type" "certificate_type" DEFAULT 'none' NOT NULL,
	"custom_cert_resolver" text,
	"service_name" text,
	"domain_type" "domain_type" DEFAULT 'application' NOT NULL,
	"unique_config_key" text DEFAULT '' NOT NULL,
	"application_id" text,
	"compose_id" text,
	"preview_deployment_id" text,
	"certificate_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bitbucket" (
	"bitbucket_id" text PRIMARY KEY NOT NULL,
	"git_provider_id" text NOT NULL,
	"bitbucket_username" text,
	"bitbucket_workspace_name" text,
	"app_password" text,
	"api_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "git_provider" (
	"git_provider_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"provider_type" "git_provider_type" NOT NULL,
	"organization_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gitea" (
	"gitea_id" text PRIMARY KEY NOT NULL,
	"git_provider_id" text NOT NULL,
	"gitea_url" text DEFAULT 'https://gitea.com' NOT NULL,
	"access_token" text,
	"redirect_uri" text,
	"expires_at" integer,
	"refresh_token" text,
	"last_synced_at" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github" (
	"github_id" text PRIMARY KEY NOT NULL,
	"git_provider_id" text NOT NULL,
	"github_app_id" bigint,
	"github_app_name" text,
	"github_client_id" text,
	"github_client_secret" text,
	"github_private_key" text,
	"github_webhook_secret" text,
	"github_installation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gitlab" (
	"gitlab_id" text PRIMARY KEY NOT NULL,
	"git_provider_id" text NOT NULL,
	"gitlab_url" text DEFAULT 'https://gitlab.com' NOT NULL,
	"application_id" text,
	"secret" text,
	"access_token" text,
	"refresh_token" text,
	"redirect_uri" text,
	"group_name" text,
	"expires_at" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mount" (
	"mount_id" text PRIMARY KEY NOT NULL,
	"type" "mount_type" DEFAULT 'volume' NOT NULL,
	"host_path" text,
	"volume_name" text,
	"file_path" text,
	"content" text,
	"mount_path" text NOT NULL,
	"service_type" "service_type" DEFAULT 'application' NOT NULL,
	"application_id" text,
	"compose_id" text,
	"postgres_id" text,
	"mysql_id" text,
	"mariadb_id" text,
	"mongo_id" text,
	"redis_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"notification_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" "notification_type" NOT NULL,
	"slack_config" jsonb,
	"telegram_config" jsonb,
	"discord_config" jsonb,
	"email_config" jsonb,
	"gotify_config" jsonb,
	"ntfy_config" jsonb,
	"pushover_config" jsonb,
	"custom_config" jsonb,
	"app_deploy" boolean DEFAULT false NOT NULL,
	"app_build_error" boolean DEFAULT false NOT NULL,
	"database_backup" boolean DEFAULT false NOT NULL,
	"nixploy_restart" boolean DEFAULT false NOT NULL,
	"docker_cleanup" boolean DEFAULT false NOT NULL,
	"server_threshold" boolean DEFAULT false NOT NULL,
	"organization_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "port" (
	"port_id" text PRIMARY KEY NOT NULL,
	"published_port" integer NOT NULL,
	"target_port" integer NOT NULL,
	"protocol" "port_protocol" DEFAULT 'tcp' NOT NULL,
	"publish_mode" "publish_mode" DEFAULT 'ingress' NOT NULL,
	"application_id" text,
	"compose_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environment" (
	"environment_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"env" text,
	"project_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project" (
	"project_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"env" text,
	"organization_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "redirect" (
	"redirect_id" text PRIMARY KEY NOT NULL,
	"regex" text NOT NULL,
	"replacement" text NOT NULL,
	"permanent" boolean DEFAULT false NOT NULL,
	"application_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "redirect_app_regex_unique" UNIQUE("application_id","regex")
);
--> statement-breakpoint
CREATE TABLE "registry" (
	"registry_id" text PRIMARY KEY NOT NULL,
	"registry_name" text NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"registry_url" text DEFAULT '' NOT NULL,
	"registry_type" "registry_type" DEFAULT 'cloud' NOT NULL,
	"image_prefix" text,
	"organization_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule" (
	"schedule_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"cron_expression" text NOT NULL,
	"shell_type" "shell_type" DEFAULT 'bash' NOT NULL,
	"command" text NOT NULL,
	"script" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"schedule_type" "schedule_type" NOT NULL,
	"app_name" text,
	"application_id" text,
	"compose_id" text,
	"server_id" text,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security" (
	"security_id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"application_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_app_username_unique" UNIQUE("application_id","username")
);
--> statement-breakpoint
CREATE TABLE "server" (
	"server_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"ip_address" text NOT NULL,
	"port" integer DEFAULT 22 NOT NULL,
	"username" text DEFAULT 'root' NOT NULL,
	"ssh_key_id" text,
	"server_status" "server_status" DEFAULT 'active' NOT NULL,
	"command" text DEFAULT '' NOT NULL,
	"metrics_config" jsonb,
	"enable_docker_cleanup" boolean DEFAULT false NOT NULL,
	"organization_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ssh_key" (
	"ssh_key_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"private_key" text NOT NULL,
	"public_key" text NOT NULL,
	"organization_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "web_server_settings" (
	"web_server_settings_id" text PRIMARY KEY NOT NULL,
	"host" text,
	"lets_encrypt_email" text,
	"certificate_type" "certificate_type" DEFAULT 'none' NOT NULL,
	"metrics_config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tag" (
	"tag_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#3b82f6' NOT NULL,
	"organization_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_registry_id_registry_registry_id_fk" FOREIGN KEY ("registry_id") REFERENCES "public"."registry"("registry_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_custom_git_ssh_key_id_ssh_key_ssh_key_id_fk" FOREIGN KEY ("custom_git_ssh_key_id") REFERENCES "public"."ssh_key"("ssh_key_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_github_id_github_github_id_fk" FOREIGN KEY ("github_id") REFERENCES "public"."github"("github_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_gitlab_id_gitlab_gitlab_id_fk" FOREIGN KEY ("gitlab_id") REFERENCES "public"."gitlab"("gitlab_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_bitbucket_id_bitbucket_bitbucket_id_fk" FOREIGN KEY ("bitbucket_id") REFERENCES "public"."bitbucket"("bitbucket_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_gitea_id_gitea_gitea_id_fk" FOREIGN KEY ("gitea_id") REFERENCES "public"."gitea"("gitea_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_environment_id_environment_environment_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environment"("environment_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_server_id_server_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."server"("server_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apikey" ADD CONSTRAINT "apikey_reference_id_user_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup" ADD CONSTRAINT "backup_destination_id_destination_destination_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destination"("destination_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup" ADD CONSTRAINT "backup_postgres_id_postgres_postgres_id_fk" FOREIGN KEY ("postgres_id") REFERENCES "public"."postgres"("postgres_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup" ADD CONSTRAINT "backup_mysql_id_mysql_mysql_id_fk" FOREIGN KEY ("mysql_id") REFERENCES "public"."mysql"("mysql_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup" ADD CONSTRAINT "backup_mariadb_id_mariadb_mariadb_id_fk" FOREIGN KEY ("mariadb_id") REFERENCES "public"."mariadb"("mariadb_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup" ADD CONSTRAINT "backup_mongo_id_mongo_mongo_id_fk" FOREIGN KEY ("mongo_id") REFERENCES "public"."mongo"("mongo_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "destination" ADD CONSTRAINT "destination_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volume_backup" ADD CONSTRAINT "volume_backup_destination_id_destination_destination_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destination"("destination_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volume_backup" ADD CONSTRAINT "volume_backup_application_id_application_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("application_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volume_backup" ADD CONSTRAINT "volume_backup_compose_id_compose_compose_id_fk" FOREIGN KEY ("compose_id") REFERENCES "public"."compose"("compose_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compose" ADD CONSTRAINT "compose_custom_git_ssh_key_id_ssh_key_ssh_key_id_fk" FOREIGN KEY ("custom_git_ssh_key_id") REFERENCES "public"."ssh_key"("ssh_key_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compose" ADD CONSTRAINT "compose_github_id_github_github_id_fk" FOREIGN KEY ("github_id") REFERENCES "public"."github"("github_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compose" ADD CONSTRAINT "compose_gitlab_id_gitlab_gitlab_id_fk" FOREIGN KEY ("gitlab_id") REFERENCES "public"."gitlab"("gitlab_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compose" ADD CONSTRAINT "compose_bitbucket_id_bitbucket_bitbucket_id_fk" FOREIGN KEY ("bitbucket_id") REFERENCES "public"."bitbucket"("bitbucket_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compose" ADD CONSTRAINT "compose_gitea_id_gitea_gitea_id_fk" FOREIGN KEY ("gitea_id") REFERENCES "public"."gitea"("gitea_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compose" ADD CONSTRAINT "compose_environment_id_environment_environment_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environment"("environment_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compose" ADD CONSTRAINT "compose_server_id_server_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."server"("server_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mariadb" ADD CONSTRAINT "mariadb_environment_id_environment_environment_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environment"("environment_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mariadb" ADD CONSTRAINT "mariadb_server_id_server_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."server"("server_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mongo" ADD CONSTRAINT "mongo_environment_id_environment_environment_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environment"("environment_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mongo" ADD CONSTRAINT "mongo_server_id_server_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."server"("server_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mysql" ADD CONSTRAINT "mysql_environment_id_environment_environment_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environment"("environment_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mysql" ADD CONSTRAINT "mysql_server_id_server_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."server"("server_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postgres" ADD CONSTRAINT "postgres_environment_id_environment_environment_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environment"("environment_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postgres" ADD CONSTRAINT "postgres_server_id_server_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."server"("server_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redis" ADD CONSTRAINT "redis_environment_id_environment_environment_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environment"("environment_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redis" ADD CONSTRAINT "redis_server_id_server_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."server"("server_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment" ADD CONSTRAINT "deployment_application_id_application_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("application_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment" ADD CONSTRAINT "deployment_compose_id_compose_compose_id_fk" FOREIGN KEY ("compose_id") REFERENCES "public"."compose"("compose_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment" ADD CONSTRAINT "deployment_server_id_server_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."server"("server_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preview_deployment" ADD CONSTRAINT "preview_deployment_application_id_application_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("application_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preview_deployment" ADD CONSTRAINT "preview_deployment_server_id_server_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."server"("server_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rollback" ADD CONSTRAINT "rollback_application_id_application_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("application_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rollback" ADD CONSTRAINT "rollback_deployment_id_deployment_deployment_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployment"("deployment_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_server_id_server_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."server"("server_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain" ADD CONSTRAINT "domain_application_id_application_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("application_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain" ADD CONSTRAINT "domain_compose_id_compose_compose_id_fk" FOREIGN KEY ("compose_id") REFERENCES "public"."compose"("compose_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain" ADD CONSTRAINT "domain_preview_deployment_id_preview_deployment_preview_deployment_id_fk" FOREIGN KEY ("preview_deployment_id") REFERENCES "public"."preview_deployment"("preview_deployment_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bitbucket" ADD CONSTRAINT "bitbucket_git_provider_id_git_provider_git_provider_id_fk" FOREIGN KEY ("git_provider_id") REFERENCES "public"."git_provider"("git_provider_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_provider" ADD CONSTRAINT "git_provider_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gitea" ADD CONSTRAINT "gitea_git_provider_id_git_provider_git_provider_id_fk" FOREIGN KEY ("git_provider_id") REFERENCES "public"."git_provider"("git_provider_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github" ADD CONSTRAINT "github_git_provider_id_git_provider_git_provider_id_fk" FOREIGN KEY ("git_provider_id") REFERENCES "public"."git_provider"("git_provider_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gitlab" ADD CONSTRAINT "gitlab_git_provider_id_git_provider_git_provider_id_fk" FOREIGN KEY ("git_provider_id") REFERENCES "public"."git_provider"("git_provider_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mount" ADD CONSTRAINT "mount_application_id_application_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("application_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mount" ADD CONSTRAINT "mount_compose_id_compose_compose_id_fk" FOREIGN KEY ("compose_id") REFERENCES "public"."compose"("compose_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mount" ADD CONSTRAINT "mount_postgres_id_postgres_postgres_id_fk" FOREIGN KEY ("postgres_id") REFERENCES "public"."postgres"("postgres_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mount" ADD CONSTRAINT "mount_mysql_id_mysql_mysql_id_fk" FOREIGN KEY ("mysql_id") REFERENCES "public"."mysql"("mysql_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mount" ADD CONSTRAINT "mount_mariadb_id_mariadb_mariadb_id_fk" FOREIGN KEY ("mariadb_id") REFERENCES "public"."mariadb"("mariadb_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mount" ADD CONSTRAINT "mount_mongo_id_mongo_mongo_id_fk" FOREIGN KEY ("mongo_id") REFERENCES "public"."mongo"("mongo_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mount" ADD CONSTRAINT "mount_redis_id_redis_redis_id_fk" FOREIGN KEY ("redis_id") REFERENCES "public"."redis"("redis_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "port" ADD CONSTRAINT "port_application_id_application_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("application_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "port" ADD CONSTRAINT "port_compose_id_compose_compose_id_fk" FOREIGN KEY ("compose_id") REFERENCES "public"."compose"("compose_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment" ADD CONSTRAINT "environment_project_id_project_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redirect" ADD CONSTRAINT "redirect_application_id_application_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("application_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry" ADD CONSTRAINT "registry_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "schedule_application_id_application_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("application_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "schedule_compose_id_compose_compose_id_fk" FOREIGN KEY ("compose_id") REFERENCES "public"."compose"("compose_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "schedule_server_id_server_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."server"("server_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "schedule_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security" ADD CONSTRAINT "security_application_id_application_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("application_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server" ADD CONSTRAINT "server_ssh_key_id_ssh_key_ssh_key_id_fk" FOREIGN KEY ("ssh_key_id") REFERENCES "public"."ssh_key"("ssh_key_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server" ADD CONSTRAINT "server_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_key" ADD CONSTRAINT "ssh_key_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag" ADD CONSTRAINT "tag_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "domain_host_path_unique" ON "domain" USING btree ("host","path","port");