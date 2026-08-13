import assert from "node:assert/strict";
import { test } from "node:test";

import registerWorkflowOrchestrator, {
	createSubmitWorkflowResolutionTool,
	materializeSkill,
	stageCrossProjectSession,
	startFreshStage,
} from "./index.ts";

test("extension entrypoint registers no tool, since submit_workflow_resolution has no consumer yet (issue #14)", () => {
	const tools: unknown[] = [];
	registerWorkflowOrchestrator({
		registerTool(tool: unknown) {
			tools.push(tool);
		},
	} as never);

	// Pi auto-activates every extension-registered tool in every session, so a
	// terminate:true tool with no consumer must not be registered globally: a
	// valid payload would hard-stop any unrelated agent run mid-task.
	assert.equal(tools.length, 0);
	// The building blocks remain exported and usable, ready for issue #14 to
	// register createSubmitWorkflowResolutionTool explicitly once a real
	// orchestration consumer exists.
	assert.equal(typeof createSubmitWorkflowResolutionTool, "function");
	assert.equal(createSubmitWorkflowResolutionTool().name, "submit_workflow_resolution");
	assert.equal(typeof materializeSkill, "function");
	assert.equal(typeof startFreshStage, "function");
	assert.equal(typeof stageCrossProjectSession, "function");
});
