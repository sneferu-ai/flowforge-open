/**
 * StepExecutor interface — the interface for all step type executors.
 * Third parties can implement this and embed the engine.
 */

export interface SecretResolver {
  get(name: string): string | null;
}

export interface LoopContext {
  item: unknown;
  index: number;
  outer: LoopContext | null;
}

export interface StepExecutionContext {
  readonly runId: string;
  readonly workspaceId: string;
  readonly stepPath: string;
  readonly attempt: number;
  readonly iteration: number;
  readonly config: Record<string, unknown>;
  readonly inputs: Record<string, unknown>;
  readonly steps: Record<string, { output: unknown; status: string }>;
  readonly loop: { item: unknown; index: number; outer: LoopContext | null } | null;
  readonly trigger: { type: string; payload: unknown };
  readonly secrets: SecretResolver;
  readonly env: { FF_APP_URL: string | null };
  readonly run: { id: string; scheduled_at: string | null };
  resolveExpression(expr: string): unknown;
  resolveInterpolation(str: string): string;
  log(level: 'info' | 'warn' | 'error', message: string): void;
}

export interface StepResult {
  status: 'succeeded' | 'failed' | 'waiting' | 'paused' | 'skipped';
  output: unknown;
  error?: { code: string; message: string };
  resumeAt?: string;
  approvalTaskId?: string;
}

export interface StepExecutor {
  readonly type: string;
  execute(ctx: StepExecutionContext): Promise<StepResult>;
}
