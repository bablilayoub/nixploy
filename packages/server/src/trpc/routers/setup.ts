import { needsSetup } from "../../modules/auth/setup";
import { publicProcedure, router } from "../init";

/**
 * Public setup probes used by /setup and /login before any session exists.
 */
export const setupRouter = router({
	/** Whether the instance has zero users and needs the first admin. */
	needsSetup: publicProcedure.query(async () => {
		return { needsSetup: await needsSetup() };
	}),
});
