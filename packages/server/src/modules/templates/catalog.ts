import { aiTemplates } from "./data/ai";
import { analyticsTemplates } from "./data/analytics";
import { appTemplates } from "./data/apps";
import { cmsTemplates } from "./data/cms";
import { communicationTemplates } from "./data/communication";
import { databaseTemplates } from "./data/databases";
import { financeTemplates } from "./data/finance";
import { knowledgeTemplates } from "./data/knowledge";
import { mediaTemplates } from "./data/media";
import { monitoringTemplates } from "./data/monitoring";
import { notificationTemplates } from "./data/notifications";
import { productivityTemplates } from "./data/productivity";
import { securityTemplates } from "./data/security";
import { storageTemplates } from "./data/storage";
import { toolTemplates } from "./data/tools";
import type { Template, TemplateData, TemplateSummary } from "./types";

/** Attach the display category to every template of one data file. */
function categorize(category: string, list: TemplateData[]): Template[] {
	return list.map((template) => ({ ...template, category }));
}

export const templates: Template[] = [
	...categorize("Apps", appTemplates),
	...categorize("CMS", cmsTemplates),
	...categorize("Productivity", productivityTemplates),
	...categorize("Analytics", analyticsTemplates),
	...categorize("Monitoring", monitoringTemplates),
	...categorize("Media", mediaTemplates),
	...categorize("Knowledge", knowledgeTemplates),
	...categorize("Notifications", notificationTemplates),
	...categorize("Finance", financeTemplates),
	...categorize("Developer Tools", toolTemplates),
	...categorize("Databases", databaseTemplates),
	...categorize("AI", aiTemplates),
	...categorize("Communication", communicationTemplates),
	...categorize("Security", securityTemplates),
	...categorize("Storage", storageTemplates),
];

export function findTemplateById(templateId: string): Template | undefined {
	return templates.find((template) => template.id === templateId);
}

/** Catalog entries without the compose bodies (cheap to list). */
export function listTemplateSummaries(): TemplateSummary[] {
	return templates.map(({ compose: _compose, ...summary }) => summary);
}
