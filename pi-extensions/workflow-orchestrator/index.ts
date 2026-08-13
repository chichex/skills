import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export * from "./lifecycle.ts";
export * from "./materialize.ts";
export * from "./protocol.ts";
export * from "./staging.ts";

/**
 * submit_workflow_resolution (see protocol.ts createSubmitWorkflowResolutionTool)
 * has no consumer yet — wiring it into an actual orchestration flow is
 * deferred to issue #14. Pi auto-activates every extension-registered tool in
 * every session, so registering a terminate:true tool here would make it
 * model-callable in projects that have nothing to do with orchestration: a
 * valid payload would hard-stop any agent run mid-task ("Workflow resolution
 * accepted"). createSubmitWorkflowResolutionTool stays exported and fully
 * testable (see protocol.test.ts) so issue #14 can register it explicitly
 * once a real consumer exists, without registering it here in the meantime.
 */
export default function registerWorkflowOrchestrator(_pi: ExtensionAPI): void {}
