import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { createSubmitWorkflowResolutionTool } from "./protocol.ts";

export * from "./lifecycle.ts";
export * from "./materialize.ts";
export * from "./protocol.ts";
export * from "./staging.ts";

export default function registerWorkflowOrchestrator(pi: ExtensionAPI): void {
	pi.registerTool(createSubmitWorkflowResolutionTool() as never);
}
