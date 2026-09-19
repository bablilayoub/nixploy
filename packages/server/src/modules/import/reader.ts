import type { DatabaseServiceKind } from "../services/registry";
import type {
	SourceApplication,
	SourceCompose,
	SourceDatabase,
	SourceProjectSummary,
} from "./source-schema";

/**
 * What the importer needs from a source, however it is reached: the live
 * REST API of a running panel (`SourcePanelClient`) or a database dump of a
 * dead one (`DumpSourceReader`). Both hand back the same lenient row shapes,
 * so the normaliser, the plan and the apply never know which it was.
 */
export interface SourceReader {
	/** Where the rows came from, for audit rows and messages (never a credential). */
	readonly host: string;
	listProjects(): Promise<SourceProjectSummary[]>;
	getApplication(applicationId: string): Promise<SourceApplication>;
	getCompose(composeId: string): Promise<SourceCompose>;
	getDatabase(kind: DatabaseServiceKind, id: string): Promise<SourceDatabase>;
	/** Release whatever the reader holds (a throwaway container); never throws. */
	close(): Promise<void>;
}
