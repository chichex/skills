import assert from "node:assert/strict";
import { test } from "node:test";

import {
	grillTransitionFailureMessage,
	issueTriageFailureMessage,
} from "../github-consumer-logic.ts";

test("consumer failures stay localized and preserve the already computed issue analysis", () => {
	assert.equal(
		issueTriageFailureMessage("skill-not-found"),
		"Todavía no está instalado el skill issue-triage.",
	);
	assert.doesNotMatch(issueTriageFailureMessage("orchestrator-unavailable"), /workflow-orchestrator|pi\.getCommands/);
	const message = grillTransitionFailureMessage({
		ok: false,
		code: "skill-not-found",
		message: "Skill grill is not present in pi.getCommands()",
	});
	assert.match(message ?? "", /No se pudo iniciar Grill \(skill-not-found\)/);
	assert.match(message ?? "", /issue y su análisis se conservan/i);
	assert.equal(grillTransitionFailureMessage(undefined), null);
});
