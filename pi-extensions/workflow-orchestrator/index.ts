import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { createWorkflowController } from "./controller.ts";

export * from "./controller.ts";
export * from "./direct-launch.ts";
export * from "./dispatch.ts";
export * from "./lifecycle.ts";
export * from "./materialize.ts";
export * from "./protocol.ts";
export * from "./same-session.ts";
export * from "./staging.ts";

/**
 * The terminal resolution tool is registered lazily by the controller only
 * while /issues owns an active triage attempt. Commands and lifecycle cleanup
 * can be registered safely at extension load without making that terminating
 * tool available to unrelated conversations.
 */
export default function registerWorkflowOrchestrator(pi: ExtensionAPI): void {
	createWorkflowController(pi);
}
