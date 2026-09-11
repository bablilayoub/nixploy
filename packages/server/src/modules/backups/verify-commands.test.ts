import { describe, expect, it } from "vitest";
import {
	buildVerifyCleanupCommand,
	buildVerifyContainerName,
	buildVerifyCreateCommand,
	buildVerifyLivenessCommand,
	buildVerifyRestoreCommand,
	buildVerifyRunCommand,
	buildVerifyStartCommand,
	buildVerifyWaitCommand,
	expectedLivenessOutput,
	livenessAnswered,
	type VerifyTarget,
} from "./verify-commands";

/**
 * Exact-string assertions: these commands are interpolated into `sh -c`
 * on the host and inside the throwaway container, so a quoting change is a
 * potential injection. Names/databases carrying quotes must stay inert.
 */

const name = "nixploy-verify-0123456789ab";

const postgres: VerifyTarget = {
	engine: "postgres",
	image: "postgres:17",
	database: "app",
	user: "app_user",
};

describe("buildVerifyContainerName", () => {
	it("prefixes a hex token", () => {
		expect(buildVerifyContainerName("0123456789ab")).toBe(name);
	});

	it("rejects anything but a hex token", () => {
		expect(() => buildVerifyContainerName("evil; rm -rf /")).toThrow(/hex token/);
		expect(() => buildVerifyContainerName("")).toThrow(/hex token/);
	});
});

describe("buildVerifyRunCommand", () => {
	it("postgres: trust auth, no ports, no network, labelled", () => {
		expect(buildVerifyRunCommand(name, postgres)).toBe(
			`docker run -d --name '${name}' --network none --label 'nixploy.verify=1' ` +
				`-e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_USER='app_user' -e POSTGRES_DB='app' 'postgres:17'`,
		);
	});

	it("mysql: empty root password and the database pre-created", () => {
		expect(
			buildVerifyRunCommand(name, {
				engine: "mysql",
				image: "mysql:9",
				database: "shop",
				user: "u",
			}),
		).toBe(
			`docker run -d --name '${name}' --network none --label 'nixploy.verify=1' ` +
				`-e MYSQL_ALLOW_EMPTY_PASSWORD=yes -e MYSQL_DATABASE='shop' 'mysql:9'`,
		);
	});

	it("mariadb: empty root password and the database pre-created", () => {
		expect(
			buildVerifyRunCommand(name, {
				engine: "mariadb",
				image: "mariadb:11",
				database: "shop",
				user: "u",
			}),
		).toBe(
			`docker run -d --name '${name}' --network none --label 'nixploy.verify=1' ` +
				`-e MARIADB_ALLOW_EMPTY_ROOT_PASSWORD=yes -e MARIADB_DATABASE='shop' 'mariadb:11'`,
		);
	});

	it("mongo: no auth env at all", () => {
		expect(
			buildVerifyRunCommand(name, {
				engine: "mongo",
				image: "mongo:8",
				database: "app",
				user: "u",
			}),
		).toBe(`docker run -d --name '${name}' --network none --label 'nixploy.verify=1' 'mongo:8'`);
	});

	it("neutralises quotes in user/database names", () => {
		expect(
			buildVerifyRunCommand(name, {
				...postgres,
				database: "a'; docker rm -f x; echo '",
				user: "u'$(id)'",
			}),
		).toBe(
			`docker run -d --name '${name}' --network none --label 'nixploy.verify=1' ` +
				`-e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_USER='u'\\''$(id)'\\''' ` +
				`-e POSTGRES_DB='a'\\''; docker rm -f x; echo '\\''' 'postgres:17'`,
		);
	});
});

describe("redis create/start", () => {
	const redis: VerifyTarget = { engine: "redis", image: "redis:8-alpine", database: "0", user: "" };

	it("creates the container stopped with the same persistence flag as the engine", () => {
		expect(buildVerifyCreateCommand(name, redis)).toBe(
			`docker create --name '${name}' --network none --label 'nixploy.verify=1' 'redis:8-alpine' redis-server --appendonly yes`,
		);
	});

	it("starts it after the snapshot was copied in", () => {
		expect(buildVerifyStartCommand(name)).toBe(`docker start '${name}'`);
	});

	it("restores by unpacking the data-dir tar into the container root", () => {
		expect(buildVerifyRestoreCommand(name, redis)).toBe(
			`base64 -d | gunzip | docker cp - '${name}':/`,
		);
	});

	it("liveness is PING → PONG", () => {
		expect(buildVerifyLivenessCommand(name, redis)).toBe(
			`docker exec '${name}' sh -c 'redis-cli PING'`,
		);
		expect(expectedLivenessOutput("redis")).toBe("PONG");
	});
});

describe("buildVerifyWaitCommand", () => {
	it("polls the readiness probe and dumps container logs on timeout", () => {
		expect(buildVerifyWaitCommand(name, postgres, 3, 1)).toBe(
			`i=0; while [ $i -lt 3 ]; do docker exec '${name}' sh -c 'pg_isready -U '\\''app_user'\\'' -d '\\''app'\\''' >/dev/null 2>&1 && exit 0; ` +
				`sleep 1; i=$((i + 1)); done; echo 'postgres did not accept connections within 3s' >&2; ` +
				`docker logs --tail 20 '${name}' >&2 2>&1; exit 1`,
		);
	});

	it("mysql/mariadb probe over TCP so the bootstrap socket server does not count", () => {
		expect(
			buildVerifyWaitCommand(name, { engine: "mysql", image: "mysql:9", database: "d", user: "u" }),
		).toContain(`sh -c 'mysqladmin ping -h 127.0.0.1 -u root --silent'`);
		expect(
			buildVerifyWaitCommand(name, {
				engine: "mariadb",
				image: "mariadb:11",
				database: "d",
				user: "u",
			}),
		).toContain(`sh -c 'mariadb-admin ping -h 127.0.0.1 -u root --silent'`);
	});

	it("mongo probes with mongosh", () => {
		expect(
			buildVerifyWaitCommand(name, { engine: "mongo", image: "mongo:8", database: "d", user: "u" }),
		).toContain(`sh -c 'mongosh --quiet --eval '\\''db.adminCommand("ping").ok'\\'''`);
	});
});

describe("buildVerifyRestoreCommand", () => {
	it("postgres streams the gunzipped dump into psql with ON_ERROR_STOP", () => {
		expect(buildVerifyRestoreCommand(name, postgres)).toBe(
			`base64 -d | gunzip | docker exec -i '${name}' sh -c 'psql -q -U '\\''app_user'\\'' -d '\\''app'\\'' -v ON_ERROR_STOP=1'`,
		);
	});

	it("mysql/mariadb restore as root with no password", () => {
		expect(
			buildVerifyRestoreCommand(name, {
				engine: "mysql",
				image: "mysql:9",
				database: "d",
				user: "u",
			}),
		).toBe(
			`base64 -d | gunzip | docker exec -i '${name}' sh -c 'mysql --default-character-set=utf8mb4 -u root'`,
		);
		expect(
			buildVerifyRestoreCommand(name, {
				engine: "mariadb",
				image: "mariadb:11",
				database: "d",
				user: "u",
			}),
		).toBe(
			`base64 -d | gunzip | docker exec -i '${name}' sh -c 'mariadb --default-character-set=utf8mb4 -u root'`,
		);
	});

	it("mongo restores the archive without credentials", () => {
		expect(
			buildVerifyRestoreCommand(name, {
				engine: "mongo",
				image: "mongo:8",
				database: "d",
				user: "u",
			}),
		).toBe(
			`base64 -d | gunzip | docker exec -i '${name}' sh -c 'mongorestore --quiet --archive --drop'`,
		);
	});
});

describe("buildVerifyLivenessCommand", () => {
	it("SELECT 1 for the SQL engines", () => {
		expect(buildVerifyLivenessCommand(name, postgres)).toBe(
			`docker exec '${name}' sh -c 'psql -At -U '\\''app_user'\\'' -d '\\''app'\\'' -c '\\''SELECT 1'\\'''`,
		);
		expect(
			buildVerifyLivenessCommand(name, {
				engine: "mysql",
				image: "mysql:9",
				database: "d",
				user: "u",
			}),
		).toBe(`docker exec '${name}' sh -c 'mysql -u root -N -s '\\''d'\\'' -e '\\''SELECT 1'\\'''`);
		expect(expectedLivenessOutput("mysql")).toBe("1");
	});

	it("db.stats() for mongo", () => {
		expect(
			buildVerifyLivenessCommand(name, {
				engine: "mongo",
				image: "mongo:8",
				database: "d",
				user: "u",
			}),
		).toBe(
			`docker exec '${name}' sh -c 'mongosh --quiet '\\''d'\\'' --eval '\\''db.stats().ok'\\'''`,
		);
	});
});

describe("livenessAnswered", () => {
	it("accepts the expected answer on its own line only", () => {
		expect(livenessAnswered("postgres", "1\n")).toBe(true);
		expect(livenessAnswered("postgres", "NOTICE: x\n1\n")).toBe(true);
		expect(livenessAnswered("postgres", "10\n")).toBe(false);
		expect(livenessAnswered("redis", "PONG\n")).toBe(true);
		expect(livenessAnswered("redis", "(error) NOAUTH\n")).toBe(false);
	});
});

describe("buildVerifyCleanupCommand", () => {
	it("force-removes and never fails", () => {
		expect(buildVerifyCleanupCommand(name)).toBe(`docker rm -f '${name}' >/dev/null 2>&1 || true`);
	});
});
