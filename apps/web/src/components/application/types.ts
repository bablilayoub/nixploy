import type { inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "@/lib/trpc-types";

export type RouterOutputs = inferRouterOutputs<AppRouter>;

export type Application = RouterOutputs["application"]["one"];
export type Deployment = RouterOutputs["deployment"]["byApplication"]["deployments"][number];
export type PreviewDeployment = RouterOutputs["previewDeployment"]["byApplication"][number];
export type Mount = RouterOutputs["mount"]["byApplication"][number];
export type ServicePort = RouterOutputs["port"]["byApplication"][number];
export type RedirectEntry = RouterOutputs["redirect"]["byApplication"][number];
export type SecurityEntry = RouterOutputs["security"]["byApplication"][number];
export type RollbackEntry = RouterOutputs["rollback"]["all"][number];
