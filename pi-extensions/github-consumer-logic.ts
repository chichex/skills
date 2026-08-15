export interface FailedTransition {
	ok: false;
	code: string;
	message: string;
}

export function issueTriageFailureMessage(code: string): string {
	if (code === "skill-not-found") return "Todavía no está instalado el skill issue-triage.";
	if (code.startsWith("skill-")) return "El skill issue-triage no tiene una instalación canónica utilizable; revisá su instalación y recargá Pi.";
	if (code === "orchestrator-unavailable") return "El orquestador SDD no está cargado; revisá las extensiones y recargá Pi.";
	if (code === "triage-already-active") return "Ya hay un triage en curso en esta sesión; terminalo o cancelalo antes de iniciar otro.";
	if (code === "origin-session-unbound") return "Guardá la sesión actual antes de iniciar el triage.";
	return "No se pudo iniciar issue-triage; revisá el estado de la sesión y volvé a intentar.";
}

export function grillTransitionFailureMessage(transition: FailedTransition | undefined): string | null {
	if (!transition) return null;
	const reason = transition.code === "skill-not-found"
		? "el skill Grill no está instalado"
		: transition.code.startsWith("skill-")
			? "la instalación canónica del skill Grill no es utilizable"
			: "la transición orquestada falló";
	return `No se pudo iniciar Grill (${transition.code}): ${reason}. El issue y su análisis se conservan arriba.`;
}
