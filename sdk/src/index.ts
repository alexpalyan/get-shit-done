/**
 * GSD SDK — Public API for running GSD plans programmatically.
 *
 * The GSD class composes plan parsing, config loading, prompt building,
 * and session running into a single `executePlan()` call.
 *
 * @example
 * ```typescript
 * import { GSD } from '@gsd/sdk';
 *
 * const gsd = new GSD({ projectDir: '/path/to/project' });
 * const result = await gsd.executePlan('.planning/phases/01-auth/01-auth-01-PLAN.md');
 *
 * if (result.success) {
 *   console.log(`Plan completed in ${result.durationMs}ms, cost: $${result.totalCostUsd}`);
 * } else {
 *   console.error(`Plan failed: ${result.error?.messages.join(', ')}`);
 * }
 * ```
 */

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

import type { GSDOptions, PlanResult, SessionOptions, GSDEvent, TransportHandler } from './types.js';
import { parsePlan, parsePlanFile } from './plan-parser.js';
import { loadConfig } from './config.js';
import { GSDTools } from './gsd-tools.js';
import { runPlanSession } from './session-runner.js';
import { buildExecutorPrompt, parseAgentTools } from './prompt-builder.js';
import { GSDEventStream } from './event-stream.js';

// ─── GSD class ───────────────────────────────────────────────────────────────

export class GSD {
  private readonly projectDir: string;
  private readonly gsdToolsPath: string;
  private readonly defaultModel?: string;
  private readonly defaultMaxBudgetUsd: number;
  private readonly defaultMaxTurns: number;
  readonly eventStream: GSDEventStream;

  constructor(options: GSDOptions) {
    this.projectDir = resolve(options.projectDir);
    this.gsdToolsPath =
      options.gsdToolsPath ??
      join(homedir(), '.claude', 'get-shit-done', 'bin', 'gsd-tools.cjs');
    this.defaultModel = options.model;
    this.defaultMaxBudgetUsd = options.maxBudgetUsd ?? 5.0;
    this.defaultMaxTurns = options.maxTurns ?? 50;
    this.eventStream = new GSDEventStream();
  }

  /**
   * Execute a single GSD plan file.
   *
   * Reads the plan from disk, parses it, loads project config,
   * optionally reads the agent definition, then runs a query() session.
   *
   * @param planPath - Path to the PLAN.md file (absolute or relative to projectDir)
   * @param options - Per-execution overrides
   * @returns PlanResult with cost, duration, success/error status
   */
  async executePlan(planPath: string, options?: SessionOptions): Promise<PlanResult> {
    // Resolve plan path relative to project dir
    const absolutePlanPath = resolve(this.projectDir, planPath);

    // Parse the plan
    const plan = await parsePlanFile(absolutePlanPath);

    // Load project config
    const config = await loadConfig(this.projectDir);

    // Try to load agent definition for tool restrictions
    const agentDef = await this.loadAgentDefinition();

    // Merge defaults with per-call options
    const sessionOptions: SessionOptions = {
      maxTurns: options?.maxTurns ?? this.defaultMaxTurns,
      maxBudgetUsd: options?.maxBudgetUsd ?? this.defaultMaxBudgetUsd,
      model: options?.model ?? this.defaultModel,
      cwd: options?.cwd ?? this.projectDir,
      allowedTools: options?.allowedTools,
    };

    return runPlanSession(plan, config, sessionOptions, agentDef, this.eventStream, {
      phase: undefined, // Phase context set by higher-level orchestrators
      planName: plan.frontmatter.plan,
    });
  }

  /**
   * Subscribe a simple handler to receive all GSD events.
   */
  onEvent(handler: (event: GSDEvent) => void): void {
    this.eventStream.on('event', handler);
  }

  /**
   * Subscribe a transport handler to receive all GSD events.
   * Transports provide structured onEvent/close lifecycle.
   */
  addTransport(handler: TransportHandler): void {
    this.eventStream.addTransport(handler);
  }

  /**
   * Create a GSDTools instance for state management operations.
   */
  createTools(): GSDTools {
    return new GSDTools({
      projectDir: this.projectDir,
      gsdToolsPath: this.gsdToolsPath,
    });
  }

  /**
   * Load the gsd-executor agent definition if available.
   * Falls back gracefully — returns undefined if not found.
   */
  private async loadAgentDefinition(): Promise<string | undefined> {
    const paths = [
      join(homedir(), '.claude', 'agents', 'gsd-executor.md'),
      join(this.projectDir, 'agents', 'gsd-executor.md'),
    ];

    for (const p of paths) {
      try {
        return await readFile(p, 'utf-8');
      } catch {
        // Not found at this path, try next
      }
    }

    return undefined;
  }
}

// ─── Re-exports for advanced usage ──────────────────────────────────────────

export { parsePlan, parsePlanFile } from './plan-parser.js';
export { loadConfig } from './config.js';
export type { GSDConfig } from './config.js';
export { GSDTools, GSDToolsError } from './gsd-tools.js';
export { runPlanSession } from './session-runner.js';
export { buildExecutorPrompt, parseAgentTools } from './prompt-builder.js';
export * from './types.js';

// S02: Event stream, context, prompt, and logging modules
export { GSDEventStream } from './event-stream.js';
export type { EventStreamContext } from './event-stream.js';
export { ContextEngine, PHASE_FILE_MANIFEST } from './context-engine.js';
export type { FileSpec } from './context-engine.js';
export { getToolsForPhase, PHASE_AGENT_MAP, PHASE_DEFAULT_TOOLS } from './tool-scoping.js';
export { PromptFactory, extractBlock, extractSteps, PHASE_WORKFLOW_MAP } from './phase-prompt.js';
export { GSDLogger } from './logger.js';
export type { LogLevel, LogEntry, GSDLoggerOptions } from './logger.js';
