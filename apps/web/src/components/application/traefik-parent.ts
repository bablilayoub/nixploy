/**
 * Which service a redirect / basic-auth row hangs off. Applications own their
 * rows directly; a compose stack owns them per compose-file service, because
 * each service gets its own Traefik config file.
 */
export type TraefikParent =
	| { applicationId: string; composeId?: undefined; serviceName?: undefined }
	| { applicationId?: undefined; composeId: string; serviceName: string };
