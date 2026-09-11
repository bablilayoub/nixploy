import { initTRPC, type TRPC_ERROR_CODE_KEY, TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import { TRPC_ERROR_CODES_BY_KEY } from "@trpc/server/rpc";
import superjson from "superjson";
import { ZodError } from "zod";
import { db } from "../db";
import { auth } from "../lib/auth";
import { createLogger } from "../lib/logger";
import { getOrganizationId } from "../modules/application/org";
import {
	isTwoFactorGateBlocked,
	TWO_FACTOR_REQUIRED_MESSAGE,
} from "../modules/auth/two-factor-gate";
import { type DomainErrorCode, isDomainError } from "../modules/errors";
import { type CapabilityScope, runWithCapabilityScope } from "../modules/projects/capabilities";

const log = createLogger("trpc");

export const createTRPCContext = async (opts: { headers: Headers }) => {
	const session = await auth.api.getSession({ headers: opts.headers });
	// Sessions created before the session-create hook existed (or via flows
	// that skip it) carry no activeOrganizationId. Backfill it from the
	// user's first membership so org-scoped routers work for them too.
	if (session && !session.session.activeOrganizationId) {
		const membership = await db.query.members.findFirst({
			where: (m, { eq }) => eq(m.userId, session.user.id),
			orderBy: (m, { asc }) => asc(m.createdAt),
		});
		session.session.activeOrganizationId = membership?.organizationId ?? null;
	}
	return {
		headers: opts.headers,
		session,
	};
};

export type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

// ── error boundary ──────────────────────────────────────────────────────────
//
// Modules throw `DomainError` (modules/errors.ts) for caller mistakes and plain
// `Error` for bugs; zod rejects inputs with a `ZodError`. tRPC wraps anything
// that is not a `TRPCError` into INTERNAL_SERVER_ERROR before it leaves the
// procedure, so the mapping below runs inside the middleware chain (where the
// original cause is still attached) and is shared by every transport: the
// `/api/trpc` fetch adapter, the REST adapter and MCP (`createCaller`).

/** Compile-time check that every DomainErrorCode is a real tRPC code. */
const toTRPCCode = (code: DomainErrorCode): TRPC_ERROR_CODE_KEY => code;

export const GENERIC_INTERNAL_ERROR_MESSAGE =
	"Something went wrong on the server — check the panel logs.";

interface ZodIssueLike {
	path: ReadonlyArray<PropertyKey>;
	message: string;
}

function isZodError(value: unknown): value is ZodError {
	if (value instanceof ZodError) return true;
	// A ZodError from a second zod instance (duplicated dependency) still
	// carries the name and the issues array.
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { name?: unknown }).name === "ZodError" &&
		Array.isArray((value as { issues?: unknown }).issues)
	);
}

/** `"<path>: <message>; <path>: <message>"` — one readable line per issue. */
export function flattenZodIssues(issues: ReadonlyArray<ZodIssueLike>): string {
	return issues
		.map((issue) => {
			const path = issue.path.map(String).join(".");
			return path ? `${path}: ${issue.message}` : issue.message;
		})
		.join("; ");
}

/**
 * True when tRPC's `getTRPCErrorFromUnknown` wrapped a non-TRPCError thrown
 * inside the procedure: it copies the cause's stack onto the wrapper. An
 * explicit `new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause })` from a
 * router keeps its own stack (and its deliberately chosen message).
 */
function isAutoWrapped(error: TRPCError): boolean {
	if (error.code !== "INTERNAL_SERVER_ERROR" || error.cause === undefined) return false;
	if (error.cause instanceof Error) {
		return error.stack !== undefined && error.stack === error.cause.stack;
	}
	return true;
}

/**
 * Map an error thrown by a procedure to the `TRPCError` transports may show:
 * DomainError → its code + message; zod input failure → BAD_REQUEST with the
 * issues flattened into the message; anything else → INTERNAL_SERVER_ERROR,
 * logged with the procedure path and (in production) a generic message so
 * stack-level detail never reaches a client.
 */
export function normalizeTRPCError(error: TRPCError, path: string | undefined): TRPCError {
	const cause = error.cause;
	if (isAutoWrapped(error)) {
		if (isDomainError(cause)) {
			if (cause.code === "INTERNAL_SERVER_ERROR") {
				log.error(`${path ?? "?"}: ${cause.message}`, {
					path,
					error: cause.name,
				});
			} else {
				log.debug(`${path ?? "?"}: ${cause.code} ${cause.message}`, { path });
			}
			return new TRPCError({
				code: toTRPCCode(cause.code),
				message: cause.message,
				cause,
			});
		}
		if (isZodError(cause)) {
			return new TRPCError({
				code: "BAD_REQUEST",
				message: flattenZodIssues(cause.issues),
				cause,
			});
		}
		const message = cause instanceof Error ? cause.message : String(cause);
		log.error(`${path ?? "?"}: ${message}`, {
			path,
			error: cause instanceof Error ? cause.name : typeof cause,
			...(cause instanceof Error && cause.stack ? { stack: cause.stack } : {}),
		});
		if (process.env.NODE_ENV === "production") {
			return new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: GENERIC_INTERNAL_ERROR_MESSAGE,
				cause,
			});
		}
		return error;
	}
	// `.input(schema)` failures: tRPC throws BAD_REQUEST with the ZodError as
	// cause, whose message is the raw JSON issue array.
	if (error.code === "BAD_REQUEST" && isZodError(cause)) {
		const message = flattenZodIssues(cause.issues);
		if (message === error.message) return error;
		return new TRPCError({ code: "BAD_REQUEST", message, cause });
	}
	return error;
}

const t = initTRPC.context<TRPCContext>().create({
	transformer: superjson,
	errorFormatter({ shape, error, path }) {
		// The middleware below already normalised errors thrown inside a
		// procedure; this pass catches the rest (context creation, unknown
		// paths) and exposes the structured zod issues to the web client.
		const normalized = normalizeTRPCError(error, path);
		const zodIssues = isZodError(normalized.cause) ? normalized.cause.issues : undefined;
		const data = {
			...shape.data,
			...(zodIssues ? { zodIssues } : {}),
		};
		if (normalized === error) {
			return { ...shape, data };
		}
		return {
			...shape,
			message: normalized.message,
			code: TRPC_ERROR_CODES_BY_KEY[normalized.code],
			data: {
				...data,
				code: normalized.code,
				httpStatus: getHTTPStatusCodeFromError(normalized),
			},
		};
	},
});

/**
 * Outermost middleware on every procedure: `next()` never throws, it returns
 * `{ ok: false, error }` with the already-wrapped TRPCError, so the mapping
 * happens here and the re-thrown TRPCError leaves the procedure unchanged.
 */
const errorBoundary = t.middleware(async ({ next, path }) => {
	const result = await next();
	if (!result.ok) {
		const normalized = normalizeTRPCError(result.error, path);
		if (normalized !== result.error) throw normalized;
	}
	return result;
});

export const router = t.router;
export const publicProcedure = t.procedure.use(errorBoundary);

export const protectedProcedure = t.procedure.use(errorBoundary).use(async ({ ctx, next }) => {
	if (!ctx.session) {
		throw new TRPCError({ code: "UNAUTHORIZED" });
	}
	const session = ctx.session;
	// Lazily memoized via getOrganizationId's per-session WeakMap — one
	// membership lookup shared across every procedure in this HTTP request.
	const organizationId = () => getOrganizationId(session);

	// Org-level 2FA enforcement: members without 2FA on their account are
	// blocked from every org-scoped procedure until they enable it. Users
	// with no organization (first-run setup) are exempt — org resolution
	// fails FORBIDDEN for them and org-scoped procedures reject on their own.
	let twoFactorGated = false;
	try {
		const orgId = await organizationId();
		twoFactorGated = await isTwoFactorGateBlocked(session.user.id, orgId);
	} catch {
		// No organization (FORBIDDEN) or an unreachable database: org-scoped
		// procedures reject or fail on their own queries — the gate must not
		// take down procedures that never touch tenant data.
	}
	if (twoFactorGated) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: TWO_FACTOR_REQUIRED_MESSAGE,
		});
	}

	const run = () =>
		next({
			ctx: {
				...ctx,
				session,
				organizationId,
			},
		});

	// API-key callers arrive with a capability ceiling on the context
	// (`lib/api-key-context.ts`: key scope + organization binding). Entering it
	// here is what makes `assertCapability` inside every router see the reduced
	// set; cookie sessions carry no scope and are unaffected.
	const capabilityScope = (ctx as { capabilityScope?: CapabilityScope }).capabilityScope;
	return capabilityScope ? runWithCapabilityScope(capabilityScope, run) : run();
});
