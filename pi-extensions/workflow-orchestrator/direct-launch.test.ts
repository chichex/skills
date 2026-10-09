import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import * as orchestrator from "./index.ts";

function fakeStripFrontmatter(content: string): string {
	const end = content.indexOf("\n---", 3);
	return end === -1 ? content : content.slice(end + 4).trim();
}

function evidence() {
	return [{ kind: "artifact", reference: ".sdd/specs/local.md", detail: "Canonical SDD spec" }];
}

function issueRequest() {
	return {
		version: 1,
		kind: "sdd-run",
		repo: "chichex/skills",
		cwd: "/workspace/skills",
		target: {
			type: "issue",
			canonicalReference: "chichex/skills#14",
			issue: { repository: "chichex/skills", number: 14 },
		},
		summary: "Run the SDD spec stored in issue #14.",
		evidence: evidence(),
	};
}

function canonicalIssueSpec(number = 14): string {
	return [
		`# Spec — Issue ${number}`,
		"<!-- Generada. Estado: aprobada -->",
		`<!-- SDD-Tracking: version=1; type=spec; state=approved; issue=#${number}; grill=none; superseded-by=none -->`,
		"",
	].join("\n");
}

function specRequest() {
	return {
		version: 1,
		kind: "sdd-run",
		repo: "chichex/skills",
		cwd: "/workspace/skills",
		target: {
			type: "spec",
			canonicalReference: "chichex/skills:.sdd/specs/local.md",
			path: "/workspace/skills/.sdd/specs/local.md",
			issue: null,
		},
		summary: "Run local.md without inventing a GitHub issue.",
		evidence: evidence(),
	};
}

test("direct run request v1 strictly validates issue and issue-less spec targets", () => {
	assert.equal(typeof (orchestrator as Record<string, unknown>).validateDirectRunRequest, "function");
	for (const request of [issueRequest(), specRequest()]) {
		const result = orchestrator.validateDirectRunRequest(request);
		assert.equal(result.ok, true);
		if (result.ok) assert.deepEqual(result.value, request);
	}

	const extra = { ...issueRequest(), transcript: "must never be copied" };
	const invalid = orchestrator.validateDirectRunRequest(extra);
	assert.equal(invalid.ok, false);
	if (!invalid.ok) assert.ok(invalid.diagnostics.some((item) => item.code === "extra-field"));
	assert.equal(orchestrator.validateDirectRunRequest({ ...issueRequest(), summary: "x".repeat(241) }).ok, false);

	for (const [field, value] of [["repo", ""], ["cwd", ""], ["summary", ""]] as const) {
		const result = orchestrator.validateDirectRunRequest({ ...issueRequest(), [field]: value });
		assert.equal(result.ok, false);
		if (!result.ok) {
			const fieldDiagnostics = result.diagnostics.filter((item) => item.path === `$.${field}`);
			assert.equal(fieldDiagnostics.length, 1, `${field} should produce one actionable diagnostic`);
			assert.equal(fieldDiagnostics[0]!.code, "invalid-value");
		}
	}
});

test("issue targets require an SDD-aware project and reject unsafe integers before authorization", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "direct-sdd-contract-"));
	try {
		const root = await realpath(temporary);
		let issueLookups = 0;
		const dependencies = {
			resolveGitRoot: async () => root,
			resolveRepository: async () => "chichex/skills",
			resolveIssue: async (_root: string, _repo: string, number: number) => {
				issueLookups += 1;
				return {
					number,
					url: `https://github.com/chichex/skills/issues/${number}`,
					state: "OPEN",
					body: canonicalIssueSpec(number),
				};
			},
		};
		const withoutContract = await orchestrator.resolveDirectRunRequest("#14", root, dependencies);
		assert.deepEqual(withoutContract, {
			ok: false,
			code: "missing-contract",
			message: `Create a canonical .sdd/project.md in ${root} before launching sdd-run`,
		});
		assert.equal(issueLookups, 0, "the contract gate runs before any GitHub issue lookup");

		await mkdir(join(root, ".sdd"), { recursive: true });
		await writeFile(join(root, ".sdd", "project.md"), [
			"# Contract",
			"<!-- SDD-Tracking: version=1; type=project; generated-at=2026-08-15 -->",
			"",
		].join("\n"), "utf8");
		const unsafe = await orchestrator.resolveDirectRunRequest("#9007199254740993", root, dependencies);
		assert.equal(unsafe.ok, false);
		if (!unsafe.ok) assert.equal(unsafe.code, "invalid-target");

		const missing = await orchestrator.resolveDirectRunRequest("#14", root, {
			...dependencies,
			resolveIssue: async () => { throw new Error("issue not found"); },
		});
		assert.equal(missing.ok, false);
		if (!missing.ok) assert.equal(missing.code, "unresolved-issue");

		const noSpec = await orchestrator.resolveDirectRunRequest("#14", root, {
			...dependencies,
			resolveIssue: async () => ({ number: 14, url: "https://example.test/14", state: "OPEN", body: "# Bug" }),
		});
		assert.equal(noSpec.ok, false);
		if (!noSpec.ok) assert.equal(noSpec.code, "invalid-spec");

		const verified = await orchestrator.resolveDirectRunRequest("#14", root, dependencies);
		assert.equal(verified.ok, true);
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});

test("the generic lifecycle cannot bypass strict DirectRunRequestV1 validation", async () => {
	const request = { ...issueRequest(), transcript: "must never cross the boundary" };
	const result = await orchestrator.startFreshStage({
		direct: {
			request,
			cwd: request.cwd,
			name: "SDD run-existing-spec · chichex/skills#14",
			repository: request.repo,
			canonicalReference: request.target.canonicalReference,
			issueNumber: request.target.issue.number,
		},
		skill: { name: "sdd-run", args: "#14" },
	}, {} as never, { commands: [] });
	assert.equal(result.ok, false);
	if (!result.ok) assert.equal(result.code, "invalid-direct-request");
});

test("direct target resolution normalizes #NN and local/cross-project canonical specs without inventing issues", async () => {
	assert.equal(typeof (orchestrator as Record<string, unknown>).resolveDirectRunRequest, "function");
	const temporary = await mkdtemp(join(tmpdir(), "direct-sdd-run-"));
	try {
		const projectA = await realpath(temporary);
		const projectB = join(projectA, "project-b");
		await mkdir(join(projectA, ".sdd", "specs"), { recursive: true });
		await mkdir(join(projectA, "packages", "api"), { recursive: true });
		await mkdir(join(projectB, ".sdd", "specs"), { recursive: true });
		const contract = [
			"# Contract",
			"<!-- SDD-Tracking: version=1; type=project; generated-at=2026-08-15 -->",
			"",
		].join("\n");
		await Promise.all([
			writeFile(join(projectA, ".sdd", "project.md"), contract, "utf8"),
			writeFile(join(projectB, ".sdd", "project.md"), contract, "utf8"),
		]);
		const localSpec = join(projectA, ".sdd", "specs", "local.md");
		const crossSpec = join(projectB, ".sdd", "specs", "issue-7-cross.md");
		await writeFile(localSpec, [
			`# Spec — ${"Local artifact ".repeat(40)}`,
			"<!-- Generada. Estado: aprobada -->",
			"<!-- SDD-Tracking: version=1; type=spec; state=approved; issue=none; grill=none; superseded-by=none -->",
			"",
		].join("\n"), "utf8");
		await writeFile(crossSpec, [
			"# Spec — Cross project",
			"<!-- Generada. Estado: aprobada -->",
			"<!-- SDD-Tracking: version=1; type=spec; state=approved; issue=#7; grill=none; superseded-by=none -->",
			"",
		].join("\n"), "utf8");

		const dependencies = {
			async resolveGitRoot(path: string) {
				return path.startsWith(projectB) ? projectB : projectA;
			},
			async resolveRepository(root: string) {
				return root === projectB ? "owner/project-b" : "chichex/skills";
			},
			async resolveRepositoryRoot(_originRoot: string, repository: string) {
				return repository === "owner/project-b"
					? { ok: true as const, root: projectB }
					: { ok: false as const, code: "project-not-found", roots: [] };
			},
			async resolveIssue(_root: string, repo: string, number: number) {
				return {
					number,
					url: `https://github.com/${repo}/issues/${number}`,
					state: "OPEN",
					body: canonicalIssueSpec(number),
				};
			},
		};
		const issue = await orchestrator.resolveDirectRunRequest("#14", projectA, dependencies);
		assert.equal(issue.ok, true);
		if (issue.ok) {
			assert.deepEqual(issue.request.target, {
				type: "issue",
				canonicalReference: "chichex/skills#14",
				issue: { repository: "chichex/skills", number: 14 },
			});
		}

		const crossIssueUrl = await orchestrator.resolveDirectRunRequest(
			"https://github.com/owner/project-b/issues/7",
			projectA,
			dependencies,
		);
		assert.equal(crossIssueUrl.ok, true, "a GitHub issue URL resolves against its known local checkout");
		if (crossIssueUrl.ok) {
			assert.equal(crossIssueUrl.request.cwd, projectB);
			assert.equal(crossIssueUrl.request.repo, "owner/project-b");
			assert.deepEqual(crossIssueUrl.request.target, {
				type: "issue",
				canonicalReference: "owner/project-b#7",
				issue: { repository: "owner/project-b", number: 7 },
			});
		}

		const crossIssueRef = await orchestrator.resolveDirectRunRequest("owner/project-b#7", projectA, dependencies);
		assert.equal(crossIssueRef.ok, true, "a qualified issue reference resolves against its known local checkout");
		if (crossIssueRef.ok) {
			assert.equal(crossIssueRef.request.cwd, projectB);
			assert.equal(crossIssueRef.request.target.canonicalReference, "owner/project-b#7");
		}

		const originSubdirectory = join(projectA, "packages", "api");
		const local = await orchestrator.resolveDirectRunRequest(".sdd/specs/local.md", originSubdirectory, dependencies);
		assert.equal(local.ok, true, "CA-7 resolves relative spec targets against the project root");
		if (local.ok) {
			assert.equal(local.request.cwd, projectA);
			assert.ok(local.request.summary.length <= 240, "the transport summary stays bounded");
			assert.deepEqual(local.request.target, {
				type: "spec",
				canonicalReference: "chichex/skills:.sdd/specs/local.md",
				path: localSpec,
				issue: null,
			});
		}

		const cross = await orchestrator.resolveDirectRunRequest(crossSpec, projectA, dependencies);
		assert.equal(cross.ok, true);
		if (cross.ok) {
			assert.equal(cross.request.cwd, projectB);
			assert.equal(cross.request.repo, "owner/project-b");
			assert.deepEqual(cross.request.target, {
				type: "spec",
				canonicalReference: "owner/project-b:.sdd/specs/issue-7-cross.md",
				path: crossSpec,
				issue: { repository: "owner/project-b", number: 7 },
			});
		}
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});

test("URL-like non-issue targets fail clearly instead of becoming fabricated local paths", async () => {
	let pathReads = 0;
	const result = await orchestrator.resolveDirectRunRequest(
		"https://github.com/pramaestudio/brik/pull/114",
		"/workspace/skills",
		{
			resolveGitRoot: async () => "/workspace/skills",
			realpath: async (path: string) => {
				if (!path.includes("https:")) return path;
				pathReads += 1;
				throw new Error("must not resolve an HTTP URL as a local path");
			},
		},
	);
	assert.deepEqual(result, {
		ok: false,
		code: "invalid-target",
		message: "Issue targets must use #NN, owner/repo#NN, or https://github.com/owner/repo/issues/NN",
	});
	assert.equal(pathReads, 0);
});

test("startDirectRun creates a fresh linked child whose first message is materialized sdd-run plus request v1", async () => {
	assert.equal(typeof (orchestrator as Record<string, unknown>).startDirectRun, "function");
	const temporary = await mkdtemp(join(tmpdir(), "direct-sdd-child-"));
	try {
		const project = await realpath(temporary);
		const sessionDirectory = join(project, "sessions");
		const originFile = join(sessionDirectory, "origin.jsonl");
		const childFile = join(sessionDirectory, "child.jsonl");
		const skillPath = join(project, "skills", "sdd-run", "SKILL.md");
		const specPath = join(project, ".sdd", "specs", "local.md");
		await mkdir(dirname(skillPath), { recursive: true });
		await mkdir(dirname(specPath), { recursive: true });
		await mkdir(sessionDirectory, { recursive: true });
		await writeFile(skillPath, "---\nname: sdd-run\ndescription: Run\n---\n# SDD run\n", "utf8");
		await writeFile(specPath, "# Spec — Local\n", "utf8");
		await writeFile(originFile, "{}\n", "utf8");
		const request = specRequest();
		request.cwd = project;
		request.target.path = specPath;
		request.target.canonicalReference = "chichex/skills:.sdd/specs/local.md";
		request.evidence[0]!.reference = ".sdd/specs/local.md";
		let kickoff = "";
		let sessionName = "";
		const context = {
			cwd: project,
			sessionManager: {
				getCwd: () => project,
				getSessionId: () => "origin-id",
				getSessionFile: () => originFile,
				getSessionDir: () => sessionDirectory,
			},
			async newSession(options: {
				parentSession: string;
				setup: (manager: { appendSessionInfo(name: string): string }) => Promise<void>;
				withSession: (replacement: unknown) => Promise<void>;
			}) {
				assert.equal(options.parentSession, originFile);
				await options.setup({ appendSessionInfo(name: string) { sessionName = name; return "info"; } });
				await options.withSession({
					cwd: project,
					sessionManager: {
						getCwd: () => project,
						getSessionId: () => "child-id",
						getSessionFile: () => childFile,
					},
					getSystemPromptOptions: () => ({
						cwd: project,
						contextFiles: [],
						skills: [{
							name: "sdd-run",
							description: "Run",
							filePath: skillPath,
							sourceInfo: { path: skillPath, scope: "temporary" },
							disableModelInvocation: false,
						}],
					}),
					async sendUserMessage(message: string) { kickoff = message; },
				});
				return { cancelled: false };
			},
			async switchSession() { throw new Error("same-project launch must use newSession"); },
		};

		const result = await orchestrator.startDirectRun(request, context as never, {
			commands: [{ name: "skill:sdd-run", source: "skill", sourceInfo: { path: skillPath } }],
			stripSkillFrontmatter: fakeStripFrontmatter,
			resolveGitRoot: async () => project,
		});
		assert.equal(result.ok, true);
		if (!result.ok) return;
		assert.equal(result.target.sessionId, "child-id");
		assert.equal(result.target.artifactPath, specPath);
		assert.equal(sessionName, "SDD run-existing-spec · chichex/skills/local.md");
		assert.doesNotMatch(kickoff, /\/skill:sdd-run|origin transcript/i);
		assert.match(kickoff, new RegExp(`<skill name="sdd-run" location="${skillPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">`));
		const envelope = kickoff.match(/<workflow-launch version="1">\n([\s\S]+)\n<\/workflow-launch>$/)?.[1];
		assert.ok(envelope);
		assert.deepEqual(JSON.parse(envelope), request);
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});

test("startDirectRun stages a cross-project child under the selected spec project", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "direct-sdd-cross-"));
	try {
		const origin = await realpath(temporary);
		const target = join(origin, "target");
		const originSessions = join(origin, "sessions");
		const originFile = join(originSessions, "origin.jsonl");
		const childFile = join(target, "sessions", "child.jsonl");
		const skillPath = join(origin, "global-skills", "sdd-run", "SKILL.md");
		const specPath = join(target, ".sdd", "specs", "local.md");
		await mkdir(dirname(originFile), { recursive: true });
		await mkdir(dirname(skillPath), { recursive: true });
		await mkdir(dirname(specPath), { recursive: true });
		await writeFile(originFile, "{}\n", "utf8");
		await writeFile(skillPath, "---\nname: sdd-run\ndescription: Run\n---\n# Run\n", "utf8");
		await writeFile(specPath, "# Spec — Target\n", "utf8");
		const request = specRequest();
		request.repo = "owner/target";
		request.cwd = target;
		request.target.canonicalReference = "owner/target:.sdd/specs/local.md";
		request.target.path = specPath;
		let stagedInput: unknown;
		let switched = "";
		const context = {
			cwd: origin,
			sessionManager: {
				getCwd: () => origin,
				getSessionId: () => "origin-id",
				getSessionFile: () => originFile,
				getSessionDir: () => originSessions,
			},
			async newSession() { throw new Error("cross-project launch must not use newSession"); },
			async switchSession(path: string, options: { withSession: (context: unknown) => Promise<void> }) {
				switched = path;
				await options.withSession({
					cwd: target,
					sessionManager: { getCwd: () => target, getSessionId: () => "child-id", getSessionFile: () => childFile },
					getSystemPromptOptions: () => ({
						cwd: target,
						contextFiles: [{ path: join(target, "AGENTS.md"), content: "target" }],
						skills: [{
							name: "sdd-run",
							description: "Run",
							filePath: skillPath,
							sourceInfo: { path: skillPath, scope: "global" },
							disableModelInvocation: false,
						}],
					}),
					async sendUserMessage() {},
				});
				return { cancelled: false };
			},
		};
		const result = await orchestrator.startDirectRun(request, context as never, {
			commands: [{ name: "skill:sdd-run", source: "skill", sourceInfo: { path: skillPath } }],
			stripSkillFrontmatter: fakeStripFrontmatter,
			resolveGitRoot: async () => target,
			stageCrossProjectSession: async (input: unknown) => {
				stagedInput = input;
				return { sessionId: "staged-id", sessionFile: childFile, cwd: target };
			},
		});
		assert.equal(result.ok, true);
		assert.equal(switched, childFile);
		assert.deepEqual(stagedInput, {
			cwd: target,
			parentSession: originFile,
			name: "SDD run-existing-spec · owner/target/local.md",
			sourceCwd: origin,
			sourceSessionDir: originSessions,
		});
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});

// Spec #84, CA-12: /sdd-run, launch_sdd_run y __sdd-dispatch aceptan una spec
// en <git-common-dir>/sdd/specs/ desde el checkout principal y desde un
// worktree linkeado. Repo git real; el repositorio de GitHub se inyecta.
async function draftRepo(): Promise<{ base: string; main: string; linked: string; draft: string }> {
	const { execFileSync } = await import("node:child_process");
	const git = (cwd: string, ...args: string[]) => execFileSync("git", [
		"-c", "user.name=sdd", "-c", "user.email=sdd@example.invalid", "-c", "commit.gpgsign=false", ...args,
	], { cwd, encoding: "utf8" });
	const base = await realpath(await mkdtemp(join(tmpdir(), "direct-sdd-draft-")));
	const main = join(base, "repo");
	await mkdir(join(main, ".sdd"), { recursive: true });
	git(main, "init", "-q", "-b", "main");
	await writeFile(join(main, ".sdd", "project.md"), [
		"# Contract",
		"<!-- SDD-Tracking: version=1; type=project; generated-at=2026-10-09 -->",
		"",
	].join("\n"), "utf8");
	git(main, "add", ".sdd/project.md");
	git(main, "commit", "-q", "-m", "contrato");
	const linked = join(base, "repo-wt");
	git(main, "worktree", "add", "-q", "-b", "feature", linked);
	const draftDirectory = join(main, ".git", "sdd", "specs");
	await mkdir(draftDirectory, { recursive: true });
	const draft = join(draftDirectory, "borrador.md");
	await writeFile(draft, [
		"# Spec — Borrador fuera del árbol",
		"<!-- Generada. Estado: aprobada -->",
		"<!-- SDD-Tracking: version=1; type=spec; state=approved; issue=none; grill=none; superseded-by=none -->",
		"",
	].join("\n"), "utf8");
	return { base, main, linked, draft };
}

test("#84 CA-12: /sdd-run acepta una spec en <git-common-dir>/sdd/specs desde el checkout principal y desde un worktree linkeado", async () => {
	const { base, main, linked, draft } = await draftRepo();
	try {
		const dependencies = { async resolveRepository() { return "chichex/skills"; } };
		for (const cwd of [main, linked]) {
			for (const target of [".sdd/specs/borrador.md", draft]) {
				const result = await orchestrator.resolveDirectRunRequest(target, cwd, dependencies);
				assert.equal(result.ok, true, `${cwd} · ${target}: ${result.ok ? "" : `${result.code}: ${result.message}`}`);
				if (!result.ok) continue;
				assert.equal(result.request.cwd, cwd);
				assert.deepEqual(result.request.target, {
					type: "spec",
					canonicalReference: "chichex/skills:.sdd/specs/borrador.md",
					path: draft,
					issue: null,
				});
				assert.equal(orchestrator.describeDirectRun(result.request).skill.args, draft);
				assert.equal(orchestrator.validateDirectRunRequest(result.request).ok, true);
			}
		}
		const missing = await orchestrator.resolveDirectRunRequest(".sdd/specs/no-existe.md", linked, dependencies);
		assert.equal(missing.ok, false);
		if (!missing.ok) assert.equal(missing.code, "unreadable-spec");
	} finally {
		await rm(base, { recursive: true, force: true });
	}
});

test("#84 CA-12: el protocolo directo acepta un borrador del common-dir y sigue rechazando rutas ajenas", () => {
	const request = (path: string, canonicalReference: string) => ({
		version: 1,
		kind: "sdd-run",
		repo: "chichex/skills",
		cwd: "/workspace/skills-wt",
		target: { type: "spec", canonicalReference, path, issue: null },
		summary: "Run SDD spec Borrador.",
		evidence: evidence(),
	});
	assert.equal(orchestrator.validateDirectRunRequest(request("/workspace/skills/.git/sdd/specs/borrador.md", "chichex/skills:.sdd/specs/borrador.md")).ok, true);
	assert.equal(orchestrator.validateDirectRunRequest(request("/workspace/skills-wt/.sdd/specs/x.md", "chichex/skills:.sdd/specs/x.md")).ok, true);
	for (const [path, reference] of [
		["/workspace/skills/.git/sdd/specs/borrador.md", "chichex/skills:.git/sdd/specs/borrador.md"],
		["/workspace/otro/specs/x.md", "chichex/skills:.sdd/specs/x.md"],
		["/workspace/skills/.git/sdd/grills/x.md", "chichex/skills:.sdd/specs/x.md"],
	]) {
		assert.equal(orchestrator.validateDirectRunRequest(request(path!, reference!)).ok, false, path);
	}
});

function draftRequest(cwd: string, path: string, canonicalReference = "chichex/skills:.sdd/specs/borrador.md") {
	return {
		version: 1,
		kind: "sdd-run",
		repo: "chichex/skills",
		cwd,
		target: { type: "spec", canonicalReference, path, issue: null },
		summary: "Run SDD spec Borrador.",
		evidence: evidence(),
	};
}

test("review #86: el protocolo directo solo acepta borradores bajo un directorio .git", () => {
	assert.equal(orchestrator.validateDirectRunRequest(draftRequest("/workspace/skills-wt", "/workspace/skills/.git/sdd/specs/borrador.md")).ok, true);
	assert.equal(orchestrator.validateDirectRunRequest(draftRequest("/workspace/skills-wt", "/srv/repos/skills.git/sdd/specs/borrador.md")).ok, true, "repo bare");
	for (const [cwd, path, reference] of [
		["/workspace/skills-wt", "/tmp/sdd/specs/borrador.md", undefined],
		["/workspace/skills-wt", "/workspace/otro/vendor/sdd/specs/borrador.md", undefined],
		["/workspace/skills-wt", "/workspace/skills-wt/vendor/sdd/specs/borrador.md", undefined],
	] as const) {
		assert.equal(orchestrator.validateDirectRunRequest(draftRequest(cwd, path, reference)).ok, false, path);
	}
});

test("review #86: startFreshStage rechaza un borrador que no está en el common-dir del repo de cwd", async () => {
	const launch = (path: string) => {
		const request = draftRequest("/workspace/skills-wt", path);
		const descriptor = orchestrator.describeDirectRun(request as never);
		return orchestrator.startFreshStage({ direct: { request, ...descriptor.direct }, skill: descriptor.skill }, {} as never, {
			commands: [],
			resolveGitCommonDir: async (cwd: string) => (cwd === "/workspace/skills-wt" ? "/workspace/skills/.git" : null),
		} as never);
	};
	const foreign = await launch("/workspace/otro/.git/sdd/specs/borrador.md");
	assert.equal(foreign.ok, false);
	if (!foreign.ok) assert.equal(foreign.code, "invalid-direct-request");
	const own = await launch("/workspace/skills/.git/sdd/specs/borrador.md");
	assert.ok(own.ok || own.code !== "invalid-direct-request", JSON.stringify(own));
});
