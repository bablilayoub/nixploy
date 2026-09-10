/**
 * Tooltip / `title` copy for controls disabled because the member lacks an
 * org capability (see `useCapabilities`). The server still enforces the gate.
 */
export function capabilityHint(...capabilities: string[]): string {
	const list = capabilities.map((capability) => `"${capability}"`).join(" and ");
	return `Requires the ${list} capability`;
}
