/**
 * TUI Harness integration seam. Lifecycle modules here are the only TUI
 * source that talks to Agent, Session, preset, jobs, and workflow services.
 * Rendering, fold, and the projection sidecar stay outside this directory.
 * @module @deepseek-ai/dsh-tui/src/harness
 */

export { createForkAgent, createForkArtifact } from '../fork-lifecycle'
export type { ForkAgentInput, ForkArtifactInput } from '../fork-lifecycle'

export { createTuiAgent, recordedPreset, resolveTuiPreset, SessionPresetQueue } from '../preset-lifecycle'
export type { CreatedTuiAgent, TuiPresetResolution } from '../preset-lifecycle'

export { prepareTuiResume, replayTuiResumeOrDispose, resolveTuiReasoning } from '../resume-lifecycle'
export type { PreparedTuiResume, TuiReasoningState, TuiResumeSnapshot } from '../resume-lifecycle'

export { jobsChangeVisibleTo, projectJobsRows, subscribeVisibleJobs } from '../jobs-projection'

export {
  applyWorkflowSessionEvent,
  createWorkflowProjection,
  foldWorkflowSessionEvents,
  projectWorkflowSessionDelivery,
} from '../workflow-projection'

export {
  EXIT_FAILURE,
  EXIT_OK,
  EXIT_USAGE,
  lastTurnNumber,
  mapTurnEndToExitCode,
  resolveContinueSession,
  resolveResumeTarget,
  selectionFromRequestHistory,
  turnEndReasonAfter,
} from '../startup'
export type { ResumeCandidate, ResumeResolution } from '../startup'
