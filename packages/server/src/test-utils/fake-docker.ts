/**
 * A dockerode stub for the modules that talk to the engine (the metrics pass,
 * swarm reconciliation, the docker control center). Only the calls Nixploy
 * makes are implemented; everything else is left off on purpose so a new call
 * shows up as a `TypeError` in the test rather than as silent `undefined`.
 */

export interface FakeContainerInfo {
	Id: string;
	Labels?: Record<string, string>;
	Names?: string[];
	State?: string;
	Status?: string;
	Created?: number;
}

export interface FakeServiceInfo {
	ID: string;
	Spec?: Record<string, unknown>;
	[key: string]: unknown;
}

export interface FakeTaskInfo {
	ID: string;
	ServiceID?: string;
	Status?: Record<string, unknown>;
	[key: string]: unknown;
}

export interface FakeDockerOptions {
	/** Containers `listContainers` returns; a function sees the caller's options. */
	containers?: FakeContainerInfo[] | ((options: Record<string, unknown>) => FakeContainerInfo[]);
	services?: FakeServiceInfo[];
	tasks?: FakeTaskInfo[];
	/** `container.inspect()` answer, keyed by container id. */
	inspect?: (id: string) => Record<string, unknown>;
	/** `container.stats({ stream: false })` answer, keyed by container id. */
	stats?: (id: string) => unknown;
	/** `docker.info()` answer. */
	info?: () => Record<string, unknown>;
}

export interface FakeDockerCalls {
	listContainers: Array<Record<string, unknown>>;
	listServices: Array<Record<string, unknown>>;
	listTasks: Array<Record<string, unknown>>;
	inspect: string[];
	stats: string[];
}

export interface FakeDocker {
	/** Pass this where `getDocker()` would return a dockerode client. */
	// biome-ignore lint/suspicious/noExplicitAny: test double for a dockerode client
	docker: any;
	calls: FakeDockerCalls;
	reset(): void;
}

export function createFakeDocker(options: FakeDockerOptions = {}): FakeDocker {
	const calls: FakeDockerCalls = {
		listContainers: [],
		listServices: [],
		listTasks: [],
		inspect: [],
		stats: [],
	};

	const docker = {
		listContainers: async (listOptions: Record<string, unknown> = {}) => {
			calls.listContainers.push(listOptions);
			const source = options.containers ?? [];
			return typeof source === "function" ? source(listOptions) : source;
		},
		listServices: async (listOptions: Record<string, unknown> = {}) => {
			calls.listServices.push(listOptions);
			return options.services ?? [];
		},
		listTasks: async (listOptions: Record<string, unknown> = {}) => {
			calls.listTasks.push(listOptions);
			return options.tasks ?? [];
		},
		info: async () => options.info?.() ?? {},
		getContainer: (id: string) => ({
			id,
			inspect: async () => {
				calls.inspect.push(id);
				return options.inspect?.(id) ?? {};
			},
			stats: async () => {
				calls.stats.push(id);
				return options.stats?.(id) ?? {};
			},
		}),
	};

	return {
		docker,
		calls,
		reset: () => {
			calls.listContainers.length = 0;
			calls.listServices.length = 0;
			calls.listTasks.length = 0;
			calls.inspect.length = 0;
			calls.stats.length = 0;
		},
	};
}
