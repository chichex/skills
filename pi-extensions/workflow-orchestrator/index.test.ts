import assert from "node:assert/strict";
import { test } from "node:test";

import registerWorkflowOrchestrator, {
	createSubmitWorkflowResolutionTool,
	materializeSkill,
	stageCrossProjectSession,
	startFreshStage,
} from "./index.ts";

test("extension entrypoint registers the controller but keeps the terminal tool inactive outside triage", () => {
	const tools: unknown[] = [];
	const commands: string[] = [];
	const events: string[] = [];
	registerWorkflowOrchestrator({
		events: { on() { return () => {}; }, emit() {} },
		registerTool(tool: unknown) {
			tools.push(tool);
		},
		registerCommand(name: string) {
			commands.push(name);
		},
		on(name: string) {
			events.push(name);
		},
	} as never);

	assert.deepEqual(
		(tools as Array<{ name?: string }>).map((tool) => tool.name),
		["launch_sdd_run"],
		"the terminal triage tool stays lazy; direct run is globally available behind an explicit UI gate",
	);
	assert.deepEqual(commands, ["__sdd-dispatch", "sdd-run"]);
	assert.ok(events.includes("agent_settled"));
	assert.ok(events.includes("session_shutdown"));
	assert.equal(typeof createSubmitWorkflowResolutionTool, "function");
	assert.equal(createSubmitWorkflowResolutionTool().name, "submit_workflow_resolution");
	assert.equal(typeof materializeSkill, "function");
	assert.equal(typeof startFreshStage, "function");
	assert.equal(typeof stageCrossProjectSession, "function");
});
