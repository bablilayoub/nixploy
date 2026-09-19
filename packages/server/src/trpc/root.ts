import { router } from "./init";
import { aiRouter } from "./routers/ai";
import { applicationRouter } from "./routers/application";
import { auditRouter } from "./routers/audit";
import { backupRouter } from "./routers/backup";
import { bitbucketRouter } from "./routers/bitbucket";
import { brandingRouter } from "./routers/branding";
import { certificateRouter } from "./routers/certificate";
import { composeRouter } from "./routers/compose";
import { deploymentRouter } from "./routers/deployment";
import { destinationRouter } from "./routers/destination";
import { dockerRouter } from "./routers/docker";
import { domainRouter } from "./routers/domain";
import { environmentRouter } from "./routers/environment";
import { giteaRouter } from "./routers/gitea";
import { githubRouter } from "./routers/github";
import { gitlabRouter } from "./routers/gitlab";
import { gitopsRouter } from "./routers/gitops";
import { importRouter } from "./routers/import";
import { mariadbRouter } from "./routers/mariadb";
import { mongoRouter } from "./routers/mongo";
import { monitoringRouter } from "./routers/monitoring";
import { mountRouter } from "./routers/mount";
import { mysqlRouter } from "./routers/mysql";
import { notificationRouter } from "./routers/notification";
import { observabilityRouter } from "./routers/observability";
import { organizationRouter } from "./routers/organization";
import { portRouter } from "./routers/port";
import { postgresRouter } from "./routers/postgres";
import { previewDeploymentRouter } from "./routers/preview-deployment";
import { projectRouter } from "./routers/project";
import { redirectRouter } from "./routers/redirect";
import { redisRouter } from "./routers/redis";
import { registryRouter } from "./routers/registry";
import { rollbackRouter } from "./routers/rollback";
import { scheduleRouter } from "./routers/schedule";
import { securityRouter } from "./routers/security";
import { serverRouter } from "./routers/server";
import { setupRouter } from "./routers/setup";
import { sshKeyRouter } from "./routers/ssh-key";
import { ssoRouter } from "./routers/sso";
import { tagRouter } from "./routers/tag";
import { teamRouter } from "./routers/team";
import { templateRouter } from "./routers/template";
import { traefikRouter } from "./routers/traefik";
import { updatesRouter } from "./routers/updates";
import { volumeBackupRouter } from "./routers/volume-backup";
import { volumeFilesRouter } from "./routers/volume-files";
import { webServerRouter } from "./routers/web-server";

export const appRouter = router({
	ai: aiRouter,
	application: applicationRouter,
	audit: auditRouter,
	backup: backupRouter,
	branding: brandingRouter,
	bitbucket: bitbucketRouter,
	certificate: certificateRouter,
	compose: composeRouter,
	deployment: deploymentRouter,
	docker: dockerRouter,
	destination: destinationRouter,
	domain: domainRouter,
	environment: environmentRouter,
	gitea: giteaRouter,
	github: githubRouter,
	gitlab: gitlabRouter,
	gitops: gitopsRouter,
	import: importRouter,
	mariadb: mariadbRouter,
	mongo: mongoRouter,
	monitoring: monitoringRouter,
	mount: mountRouter,
	mysql: mysqlRouter,
	notification: notificationRouter,
	observability: observabilityRouter,
	organization: organizationRouter,
	port: portRouter,
	postgres: postgresRouter,
	previewDeployment: previewDeploymentRouter,
	project: projectRouter,
	redirect: redirectRouter,
	redis: redisRouter,
	registry: registryRouter,
	rollback: rollbackRouter,
	schedule: scheduleRouter,
	security: securityRouter,
	server: serverRouter,
	setup: setupRouter,
	sshKey: sshKeyRouter,
	sso: ssoRouter,
	tag: tagRouter,
	team: teamRouter,
	template: templateRouter,
	traefik: traefikRouter,
	updates: updatesRouter,
	volumeBackup: volumeBackupRouter,
	volumeFiles: volumeFilesRouter,
	webServer: webServerRouter,
});

export type AppRouter = typeof appRouter;
