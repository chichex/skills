import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { createSubmitWorkflowResolutionTool } from "./protocol.ts";

export * from "./materialize.ts";
export * from "./protocol.ts";

export default function registerWorkflowOrchestrator(pi: ExtensionAPI): void {
	pi.registerTool(createSubmitWorkflowResolutionTool() as never);
}
