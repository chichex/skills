import type {
	WorkflowMode,
	WorkflowResolutionV1,
	WorkflowRoute,
	WorkflowStage,
} from "../workflow-resolution/index.ts";

export const ACTIONABLE_ROUTE_CONTRACT = {
	grill: { stage: "grill", mode: "new" },
	"join-grill": { stage: "grill", mode: "new" },
	spec: { stage: "spec", mode: "new" },
	"join-spec": { stage: "spec", mode: "new" },
	"quick-run": { stage: "quick-run", mode: "new" },
	"join-quick-run": { stage: "quick-run", mode: "new" },
	"resume-grill": { stage: "grill", mode: "resume" },
	"spec-from-grill": { stage: "spec", mode: "from-grill" },
	"update-existing-spec": { stage: "spec", mode: "update" },
	"audit-existing-spec": { stage: "spec", mode: "update" },
	"run-existing-spec": { stage: "run-existing-spec", mode: null },
} as const satisfies Partial<Record<WorkflowRoute, { stage: WorkflowStage; mode: WorkflowMode | null }>>;

export type ActionableWorkflowRoute = keyof typeof ACTIONABLE_ROUTE_CONTRACT;
export type ConfirmedWorkflowStart = WorkflowResolutionV1 & {
	outcome: "start";
	code: ActionableWorkflowRoute;
	selectedRoute: ActionableWorkflowRoute;
};

export function isActionableWorkflowRoute(route: WorkflowRoute | null): route is ActionableWorkflowRoute {
	return route !== null && Object.hasOwn(ACTIONABLE_ROUTE_CONTRACT, route);
}

export function isConfirmedCoherentStart(resolution: WorkflowResolutionV1): resolution is ConfirmedWorkflowStart {
	if (resolution.outcome !== "start"
		|| !isActionableWorkflowRoute(resolution.selectedRoute)
		|| resolution.code !== resolution.selectedRoute) {
		return false;
	}
	const expected = ACTIONABLE_ROUTE_CONTRACT[resolution.selectedRoute];
	return resolution.stage === expected.stage && resolution.mode === expected.mode;
}
