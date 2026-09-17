/**
 * Snapping service events onto the metrics charts.
 *
 * The charts' x axis is a *category* axis of `HH:MM:SS` labels, not a time
 * scale, so an annotation is addressed by the label of the sample it happened
 * closest to. Kept out of `monitoring-charts-impl.tsx` because that module
 * pulls in Recharts and is loaded dynamically — this is pure arithmetic and
 * has tests of its own.
 */

/** The two fields of a metrics sample an annotation needs. */
export interface AnnotatableSample {
	/** Epoch ms of the sample. */
	at: number;
	/** The sample's x-axis category label. */
	time: string;
}

export interface ChartAnnotation {
	id: string;
	/** The `time` label of the sample this event snaps to. */
	x: string;
	/** One glyph above the line; the Events tab has the full story. */
	mark: string;
	color: string;
}

export interface AnnotatableEvent {
	serviceEventId: string;
	kind: string;
	occurredAt: string | Date;
}

/** Glyph + colour per event kind. Kept tiny — a chart is not a legend. */
export const ANNOTATION_STYLES: Record<string, { mark: string; color: string }> = {
	deploy_finished: { mark: "▲", color: "#0070f3" },
	deploy_failed: { mark: "✕", color: "#f31260" },
	rollback: { mark: "↺", color: "#f5a524" },
	task_failed: { mark: "✕", color: "#f31260" },
	oom_killed: { mark: "☠", color: "#f31260" },
};

/**
 * Snap events onto the plotted samples.
 *
 * An event further from every sample than one sample interval happened in a
 * gap the chart does not draw; pinning it to a neighbour would put a deploy
 * marker minutes from where it really was, so it is dropped instead. Two
 * events landing on the same sample would draw two lines in one pixel column,
 * so the first one wins and the rest stay in the Events tab.
 */
export function snapEventsToSamples(
	samples: readonly AnnotatableSample[],
	events: readonly AnnotatableEvent[],
): ChartAnnotation[] {
	const first = samples[0];
	const last = samples[samples.length - 1];
	if (samples.length < 2 || !first || !last) return [];
	const tolerance = Math.max((last.at - first.at) / (samples.length - 1), 1000);

	const annotations: ChartAnnotation[] = [];
	const used = new Set<string>();
	for (const event of events) {
		const style = ANNOTATION_STYLES[event.kind];
		if (!style) continue;
		const at = new Date(event.occurredAt).getTime();
		if (Number.isNaN(at)) continue;

		let nearest: AnnotatableSample | null = null;
		let bestDistance = Number.POSITIVE_INFINITY;
		for (const sample of samples) {
			const distance = Math.abs(sample.at - at);
			if (distance < bestDistance) {
				bestDistance = distance;
				nearest = sample;
			}
		}
		if (!nearest || bestDistance > tolerance) continue;

		const key = `${nearest.time}:${style.mark}`;
		if (used.has(key)) continue;
		used.add(key);
		annotations.push({ id: event.serviceEventId, x: nearest.time, ...style });
	}
	return annotations;
}
