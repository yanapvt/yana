import type {
  OrchestrationFlow,
  OrchestrationResult,
} from './Orchestrator.js';

export type ExecutableWorkflow = Exclude<OrchestrationFlow, 'none' | 'profile'>;

export interface WorkflowExecutionResult {
  handled: boolean;
  reply?: string;
}

export type WorkflowExecutor<TContext> = (
  context: TContext,
  plan: OrchestrationResult
) => Promise<WorkflowExecutionResult>;

/**
 * Allow-listed workflow dispatch. The Orchestrator selects the target flow;
 * callers cannot request an arbitrary tool or provider by name.
 */
export class WorkflowExecutorRegistry<TContext> {
  private readonly executors = new Map<ExecutableWorkflow, WorkflowExecutor<TContext>>();

  register(flow: ExecutableWorkflow, executor: WorkflowExecutor<TContext>): void {
    if (this.executors.has(flow)) {
      throw new Error(`Workflow executor already registered: ${flow}`);
    }
    this.executors.set(flow, executor);
  }

  async execute(
    plan: OrchestrationResult,
    context: TContext,
    options: { requireActiveFlow?: boolean } = {}
  ): Promise<WorkflowExecutionResult> {
    const flow = plan.decision.targetFlow;
    if (flow === 'none' || flow === 'profile') return { handled: false };
    if (options.requireActiveFlow && plan.context.activeSession?.flow !== flow) {
      return { handled: false };
    }

    const executor = this.executors.get(flow);
    if (!executor) return { handled: false };
    return executor(context, plan);
  }

  has(flow: ExecutableWorkflow): boolean {
    return this.executors.has(flow);
  }
}
