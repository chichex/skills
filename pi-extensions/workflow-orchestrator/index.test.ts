import assert from "node:assert/strict";
import { test } from "node:test";

import registerWorkflowOrchestrator from "./index.ts";

test("extension entrypoint registers exactly the terminal workflow-resolution tool", () => {
	const tools: unknown[] = [];
	registerWorkflowOrchestrator({
		registerTool(tool: unknown) {
			tools.push(tool);
		},
	} as never);

	assert.equal(tools.length, 1);
	assert.equal((tools[0] as { name?: string }).name, "submit_workflow_resolution");
});
