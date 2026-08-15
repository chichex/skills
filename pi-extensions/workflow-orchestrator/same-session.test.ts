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

	assert.deepEqual(result, {
		ok: true,
		queued: true,
		source: { path, baseDir: "/canonical/sdd-spec" },
	});
	assert.deepEqual(sent, [{
		content: `<skill name="sdd-spec" location="${path}">\nReferences are relative to /canonical/sdd-spec.\n\n# SDD spec\n</skill>\n\n--from-grill grill-14`,
		options: { deliverAs: "followUp" },
	}]);
	assert.doesNotMatch(sent[0]!.content, /\/skill:sdd-spec/);
});

test("same-session skill can be materialized before a caller persists state", async () => {
	assert.equal(typeof (orchestrator as Record<string, unknown>).prepareMaterializedSkill, "function");
	assert.equal(typeof (orchestrator as Record<string, unknown>).queueMaterializedSkill, "function");
	const sent: string[] = [];
	const path = "/canonical/grill/SKILL.md";
	const pi = {
		getCommands: () => [{ name: "skill:grill", source: "skill", sourceInfo: { path } }],
		sendUserMessage(content: string) { sent.push(content); },
	};
	const prepared = await orchestrator.prepareMaterializedSkill(pi as never, "grill", "--resume session-1", {
		readSkillFile: async () => "---\nname: grill\ndescription: Grill\n---\n# Grill\n",
		stripSkillFrontmatter: fakeStripFrontmatter,
	});
	assert.equal(prepared.ok, true);
	assert.deepEqual(sent, [], "preflight materialization has no delivery side effect");
	if (!prepared.ok) return;
	const queued = orchestrator.queueMaterializedSkill(pi as never, prepared, { deliverAs: "followUp" });
	assert.equal(queued.queued, true);
	assert.equal(sent.length, 1);
});
