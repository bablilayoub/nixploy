interface TemplateEnvInput {
	key: string;
	default: string;
	required?: boolean;
}

export const automaticDefault = (value: string): boolean =>
	/\{\{(?:generate[A-Za-z0-9]+|domain|env)(?::|\}\})/.test(value);

/** Blank automatic fields use server defaults; ordinary blanks are explicit values. */
export function templateEnvInputs(
	entries: readonly TemplateEnvInput[],
	values: Readonly<Record<string, string>>,
) {
	const provided: Record<string, string> = Object.fromEntries(
		entries.flatMap((entry) => {
			const value = Object.hasOwn(values, entry.key) ? values[entry.key] : undefined;
			return value === undefined || (value === "" && automaticDefault(entry.default))
				? []
				: [[entry.key, value]];
		}),
	);
	const missingRequired = entries.filter(
		(entry) => entry.required && !(provided[entry.key] ?? entry.default).trim(),
	);
	return { provided, missingRequired };
}
