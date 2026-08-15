import assert from "node:assert/strict";
import { test } from "node:test";

import * as orchestrator from "./index.ts";

function fakeStripFrontmatter(content: string): string {
	const end = content.indexOf("\n---", 3);
	return end === -1 ? content : content.slice(end + 4).trim();
}

test("same-session transition sends one canonical materialized skill and never a slash invocation", async () => {
	assert.equal(typeof (orchestrator as Record<string, unknown>).continueWithMaterializedSkill, "function");
	const sent: Array<{ content: string; options?: unknown }> = [];
	const path = "/canonical/sdd-spec/SKILL.md";
	const pi = {
		getCommands: () => [{ name: "skill:sdd-spec", source: "skill", sourceInfo: { path } }],
		sendUserMessage(content: string, options?: unknown) { sent.push({ content, options }); },
	};

	const result = await orchestrator.continueWithMaterializedSkill(
		pi as never,
		"sdd-spec",
		"--from-grill grill-14",
		{
			deliverAs: "followUp",
			readSkillFile: async () => "---\nname: sdd-spec\ndescription: Spec\n---\n# SDD spec\n",
			stripSkillFrontmatter: fakeStripFrontmatter,
		},
	);

	assert.equal(result.ok, true);
	assert.deepEqual(sent, [{
		content: `<skill name="sdd-spec" location="${path}">\nReferences are relative to /canonical/sdd-spec.\n\n# SDD spec\n</skill>\n\n--from-grill grill-14`,
		options: { deliverAs: "followUp" },
	}]);
	assert.doesNotMatch(sent[0]!.content, /\/skill:sdd-spec/);
});
