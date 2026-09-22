import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";

import {
	abortRunningJobs,
	awaitJobsExit,
	createJobRegistry,
	formatAbortNotice,
	formatDuration,
	formatJobLine,
	KILL_GRACE_MS,
	killJob,
	type RunnerDeps,
	type SpawnLike,
	subagentsCommand,
} from "./jobs.ts";

// Issue #44 CA-5 (kill en session_shutdown) y CA-6 (comando /subagents), sobre
// el registro de jobs en memoria con un hijo simulado: nada de `pi` real.

class FakeChild extends EventEmitter {
	pid = 4242;
	exitCode: number | null = null;
	signals: string[] = [];
	stdout = new EventEmitter();
	stderr = new EventEmitter();
	kill(signal: NodeJS.Signals | number = "SIGTERM"): boolean {
		this.signals.push(String(signal));
		return true;
	}
	close(code = 0): void {
		this.exitCode = code;
		this.emit("close", code);
	}
}

interface FakeTimer {
	callback: () => void;
	ms: number;
	cleared: boolean;
}

function fakeDeps(): { deps: RunnerDeps; children: FakeChild[]; timers: FakeTimer[]; clock: { now: number } } {
	const children: FakeChild[] = [];
	const timers: FakeTimer[] = [];
	const clock = { now: 1_000_000 };
	const spawn: SpawnLike = () => {
		const child = new FakeChild();
		child.pid = 4242 + children.length;
		children.push(child);
		return child;
	};
	const deps: RunnerDeps = {
		spawn,
		resolveInvocation: (args) => ({ command: "pi", args }),
		env: {},
		now: () => clock.now,
		setTimeout: (callback, ms) => {
			const timer: FakeTimer = { callback, ms, cleared: false };
			timers.push(timer);
			return timer;
		},
		clearTimeout: (handle) => {
			(handle as FakeTimer).cleared = true;
		},
	};
	return { deps, children, timers, clock };
}

// Un job "running" con un proceso simulado ya asociado, como lo deja
// launchAgent despues del spawn (jobs.test no necesita el pipeline de stdout).
function runningJob(registry: ReturnType<typeof createJobRegistry>, agent: string, child: FakeChild, startedAt: number) {
	const job = registry.create(agent, `task ${agent}`, true);
	job.proc = child;
	job.pid = child.pid;
	job.startedAt = startedAt;
	child.on("close", () => {
		job.exited = true;
	});
	return job;
}

test("CA-5: el registro asigna ids sa-1, sa-2, … por sesion y nace `running`", () => {
	const registry = createJobRegistry();
	const first = registry.create("implementer", "t1", true);
	const second = registry.create("scout", "t2", false);
	assert.equal(first.id, "sa-1");
	assert.equal(second.id, "sa-2");
	assert.equal(first.status, "running");
	assert.equal(first.background, true);
	assert.equal(second.background, false);
	assert.deepEqual(registry.list().map((job) => job.id), ["sa-1", "sa-2"]);
	assert.equal(registry.get("sa-2"), second);
	assert.equal(registry.get("sa-9"), undefined);
	assert.deepEqual(registry.running().map((job) => job.id), ["sa-1", "sa-2"]);
	assert.equal(KILL_GRACE_MS, 5000);
});

test("CA-5: session_shutdown manda SIGTERM a cada job running, SIGKILL a los 5 s solo a los que siguen vivos, y es idempotente", () => {
	const { deps, timers, clock } = fakeDeps();
	const registry = createJobRegistry();
	const alive = new FakeChild();
	const quick = new FakeChild();
	const done = new FakeChild();
	const jobAlive = runningJob(registry, "implementer", alive, clock.now - 10_000);
	const jobQuick = runningJob(registry, "scout", quick, clock.now - 5_000);
	const jobDone = runningJob(registry, "reviewer", done, clock.now - 60_000);
	// El tercero ya termino antes del shutdown: no recibe señales.
	jobDone.status = "completed";
	jobDone.exited = true;
	done.exitCode = 0;

	const aborted = abortRunningJobs(registry, deps);
	assert.deepEqual(aborted.map((job) => job.id), ["sa-1", "sa-2"]);
	assert.deepEqual(alive.signals, ["SIGTERM"]);
	assert.deepEqual(quick.signals, ["SIGTERM"]);
	assert.deepEqual(done.signals, []);
	assert.equal(jobAlive.status, "aborted");
	assert.equal(jobQuick.status, "aborted");
	assert.equal(timers.length, 2, "un timer de gracia por job señalizado");
	assert.ok(timers.every((timer) => timer.ms === KILL_GRACE_MS));
	assert.equal(formatAbortNotice(aborted), "Abortados 2 subagentes: sa-1 (implementer), sa-2 (scout)");

	// Segunda llamada (Pi puede emitir el evento mas de una vez): sin señales nuevas.
	assert.deepEqual(abortRunningJobs(registry, deps), []);
	assert.deepEqual(alive.signals, ["SIGTERM"]);
	assert.equal(timers.length, 2);

	// A los 5 s: el que ya cerro no recibe SIGKILL; el que sigue vivo si.
	quick.close(143);
	for (const timer of timers) timer.callback();
	assert.deepEqual(quick.signals, ["SIGTERM"]);
	assert.deepEqual(alive.signals, ["SIGTERM", "SIGKILL"]);
	// Un job abortado sigue abortado aunque el hijo cierre con 0 despues.
	alive.close(0);
	assert.equal(jobAlive.status, "aborted");
	assert.equal(jobQuick.status, "aborted");
});

test("CA-5: sin jobs running, el shutdown no manda nada ni crea timers", () => {
	const { deps, timers } = fakeDeps();
	const registry = createJobRegistry();
	assert.deepEqual(abortRunningJobs(registry, deps), []);
	assert.equal(timers.length, 0);
	assert.equal(formatAbortNotice([]), "");
});

test("CA-5: killJob es idempotente por job y devuelve si mando la señal", () => {
	const { deps, timers } = fakeDeps();
	const registry = createJobRegistry();
	const child = new FakeChild();
	const job = runningJob(registry, "implementer", child, deps.now!());
	assert.equal(killJob(job, deps), true);
	assert.equal(killJob(job, deps), false);
	assert.deepEqual(child.signals, ["SIGTERM"]);
	assert.equal(timers.length, 1);
	child.close(143);
	timers[0]!.callback();
	assert.deepEqual(child.signals, ["SIGTERM"], "sin SIGKILL si el hijo ya cerro");
});

// PR #48 review (comment 4076517086, hallazgo confirmado): Pi ejecuta
// `process.exit(0)` apenas el handler de session_shutdown resuelve (ver
// dispose() en interactive-mode.js), asi que si el handler no espera el
// cierre real del hijo, un hijo que ignora SIGTERM sobrevive al proceso
// padre aunque killJob haya agendado el SIGKILL de gracia.
test("CA-5: awaitJobsExit no resuelve mientras el hijo sigue vivo, ni bien se manda el SIGKILL de gracia: solo tras el close real", async () => {
	const { deps, timers } = fakeDeps();
	const registry = createJobRegistry();
	const child = new FakeChild();
	const job = runningJob(registry, "implementer", child, deps.now!());

	const aborted = abortRunningJobs(registry, deps);
	assert.deepEqual(child.signals, ["SIGTERM"]);

	let resolved = false;
	const waitPromise = awaitJobsExit(aborted).then(() => {
		resolved = true;
	});

	// El hijo ignora el SIGTERM: sigue vivo, no debe resolver todavia.
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(resolved, false, "no debe resolver mientras el hijo sigue vivo");

	// A los 5 s de gracia, killJob manda el SIGKILL, pero el hijo TODAVIA no
	// cerro (el SO tarda un tick en reportar el close real).
	for (const timer of timers) timer.callback();
	assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(resolved, false, "no debe resolver solo porque se mando el SIGKILL: falta el close real");

	// Recien cuando el hijo efectivamente cierra (fallback de SIGKILL), resuelve.
	child.close(137);
	await waitPromise;
	assert.equal(resolved, true);
});

test("CA-5: awaitJobsExit resuelve al toque si el hijo ya cerro antes del shutdown", async () => {
	const registry = createJobRegistry();
	const child = new FakeChild();
	const job = runningJob(registry, "implementer", child, 0);
	job.exited = true;
	job.status = "aborted";
	await awaitJobsExit([job]);
});

test("CA-6: /subagents sin args lista una linea por job con duracion mm:ss, o avisa que no hay", () => {
	const { deps, clock } = fakeDeps();
	const registry = createJobRegistry();
	const notices: Array<{ text: string; level: string }> = [];
	const notify = (text: string, level: string) => notices.push({ text, level });

	subagentsCommand("", registry, notify, deps);
	assert.deepEqual(notices, [{ text: "Sin subagentes en esta sesión", level: "info" }]);
	notices.length = 0;

	const running = runningJob(registry, "implementer", new FakeChild(), clock.now - 133_000);
	const finished = runningJob(registry, "scout", new FakeChild(), clock.now - 400_000);
	finished.status = "completed";
	finished.endedAt = clock.now - 100_000;
	finished.exited = true;
	assert.equal(formatDuration(133_000), "02:13");
	assert.equal(formatJobLine(running, clock.now), "sa-1 implementer running 02:13");
	assert.equal(formatJobLine(finished, clock.now), "sa-2 scout completed 05:00");

	subagentsCommand("", registry, notify, deps);
	assert.deepEqual(notices, [{ text: "sa-1 implementer running 02:13\nsa-2 scout completed 05:00", level: "info" }]);
});

test("CA-6: /subagents abort <id> aplica el kill de CA-5 y marca aborted; un id inexistente notifica error sin excepcion", () => {
	const { deps, timers } = fakeDeps();
	const registry = createJobRegistry();
	const notices: Array<{ text: string; level: string }> = [];
	const notify = (text: string, level: string) => notices.push({ text, level });
	const child = new FakeChild();
	const job = runningJob(registry, "implementer", child, deps.now!());

	subagentsCommand("abort sa-1", registry, notify, deps);
	assert.deepEqual(child.signals, ["SIGTERM"]);
	assert.equal(job.status, "aborted");
	assert.equal(timers.length, 1);
	assert.deepEqual(notices, [{ text: "sa-1 (implementer) abortado", level: "warning" }]);
	notices.length = 0;

	assert.doesNotThrow(() => subagentsCommand("abort sa-9", registry, notify, deps));
	assert.deepEqual(notices, [{ text: "No existe el job sa-9", level: "error" }]);
	notices.length = 0;

	// Un job que ya termino no se puede abortar.
	subagentsCommand("abort sa-1", registry, notify, deps);
	assert.deepEqual(notices, [{ text: "sa-1 ya no esta running (aborted)", level: "error" }]);
	notices.length = 0;

	subagentsCommand("otra cosa", registry, notify, deps);
	assert.deepEqual(notices, [{ text: "Uso: /subagents [abort <id>]", level: "error" }]);
});
