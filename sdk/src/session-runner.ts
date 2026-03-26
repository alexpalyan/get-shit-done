/**
 * Session runner — orchestrates Agent SDK query() calls for plan execution.
 *
 * Takes a parsed plan, builds the executor prompt, configures query() options,
 * processes the message stream, and extracts results into a typed PlanResult.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage, SDKResultMessage, SDKResultSuccess, SDKResultError } from '@anthropic-ai/claude-agent-sdk';
import type { ParsedPlan, PlanResult, SessionOptions, SessionUsage, GSDCostUpdateEvent } from './types.js';
import { GSDEventType } from './types.js';
import type { GSDConfig } from './config.js';
import { buildExecutorPrompt, parseAgentTools, DEFAULT_ALLOWED_TOOLS } from './prompt-builder.js';
import type { GSDEventStream, EventStreamContext } from './event-stream.js';

// ─── Model resolution ────────────────────────────────────────────────────────

/**
 * Resolve model identifier from options or config profile.
 *
 * Priority: explicit model option > config model_profile > default.
 */
function resolveModel(options?: SessionOptions, config?: GSDConfig): string | undefined {
  if (options?.model) return options.model;

  // Map model_profile names to model IDs
  if (config?.model_profile) {
    const profileMap: Record<string, string> = {
      balanced: 'claude-sonnet-4-6',
      quality: 'claude-opus-4-6',
      speed: 'claude-haiku-3-5',
    };
    return profileMap[config.model_profile] ?? config.model_profile;
  }

  return undefined; // Let SDK use its default
}

// ─── Session runner ──────────────────────────────────────────────────────────

/**
 * Run a plan execution session via the Agent SDK query() function.
 *
 * Builds the executor prompt from the parsed plan, configures query() with
 * appropriate permissions, tool restrictions, and budget limits, then iterates
 * the message stream to extract the result.
 *
 * @param plan - Parsed plan structure
 * @param config - GSD project configuration
 * @param options - Session overrides (maxTurns, budget, model, etc.)
 * @param agentDef - Raw agent definition content (optional, for tool/role extraction)
 * @returns Typed PlanResult with cost, duration, success/error status
 */
export async function runPlanSession(
  plan: ParsedPlan,
  config: GSDConfig,
  options?: SessionOptions,
  agentDef?: string,
  eventStream?: GSDEventStream,
  streamContext?: EventStreamContext,
): Promise<PlanResult> {
  // Build the executor prompt
  const executorPrompt = buildExecutorPrompt(plan, agentDef);

  // Resolve allowed tools — from agent definition or defaults
  const allowedTools = options?.allowedTools ??
    (agentDef ? parseAgentTools(agentDef) : DEFAULT_ALLOWED_TOOLS);

  // Resolve model
  const model = resolveModel(options, config);

  // Configure query options
  const maxTurns = options?.maxTurns ?? 50;
  const maxBudgetUsd = options?.maxBudgetUsd ?? 5.0;
  const cwd = options?.cwd ?? process.cwd();

  const queryStream = query({
    prompt: `Execute this plan:\n\n${plan.objective || 'Execute the plan tasks below.'}`,
    options: {
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: executorPrompt,
      },
      settingSources: ['project'],
      allowedTools,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      maxTurns,
      maxBudgetUsd,
      cwd,
      ...(model ? { model } : {}),
    },
  });

  // Process the message stream
  let resultMessage: SDKResultMessage | undefined;

  try {
    for await (const message of queryStream) {
      // Emit event through the stream if provided
      if (eventStream) {
        eventStream.mapAndEmit(message, streamContext ?? {});
      }

      // We only care about the result message — it contains all metrics
      if (isResultMessage(message)) {
        resultMessage = message;
      }
    }
  } catch (err) {
    // Stream-level error (not a query error — those come as result messages)
    return {
      success: false,
      sessionId: '',
      totalCostUsd: 0,
      durationMs: 0,
      usage: emptyUsage(),
      numTurns: 0,
      error: {
        subtype: 'error_during_execution',
        messages: [err instanceof Error ? err.message : String(err)],
      },
    };
  }

  // No result message received (shouldn't happen, but handle defensively)
  if (!resultMessage) {
    return {
      success: false,
      sessionId: '',
      totalCostUsd: 0,
      durationMs: 0,
      usage: emptyUsage(),
      numTurns: 0,
      error: {
        subtype: 'error_during_execution',
        messages: ['No result message received from query stream'],
      },
    };
  }

  // Extract result
  const result = extractResult(resultMessage);

  // Emit a cost_update event with session and cumulative totals
  if (eventStream) {
    const cost = eventStream.getCost();
    eventStream.emitEvent({
      type: GSDEventType.CostUpdate,
      timestamp: new Date().toISOString(),
      sessionId: resultMessage.session_id,
      phase: streamContext?.phase,
      planName: streamContext?.planName,
      sessionCostUsd: result.totalCostUsd,
      cumulativeCostUsd: cost.cumulative,
    } as GSDCostUpdateEvent);
  }

  return result;
}

// ─── Result extraction ───────────────────────────────────────────────────────

function isResultMessage(msg: SDKMessage): msg is SDKResultMessage {
  return msg.type === 'result';
}

function isSuccessResult(msg: SDKResultMessage): msg is SDKResultSuccess {
  return msg.subtype === 'success';
}

function isErrorResult(msg: SDKResultMessage): msg is SDKResultError {
  return msg.subtype !== 'success';
}

function emptyUsage(): SessionUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  };
}

function extractUsage(msg: SDKResultMessage): SessionUsage {
  const u = msg.usage;
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
  };
}

function extractResult(msg: SDKResultMessage): PlanResult {
  const base = {
    sessionId: msg.session_id,
    totalCostUsd: msg.total_cost_usd,
    durationMs: msg.duration_ms,
    usage: extractUsage(msg),
    numTurns: msg.num_turns,
  };

  if (isSuccessResult(msg)) {
    return {
      ...base,
      success: true,
    };
  }

  // Error result
  const errorMsg = msg as SDKResultError;
  return {
    ...base,
    success: false,
    error: {
      subtype: errorMsg.subtype,
      messages: errorMsg.errors ?? [],
    },
  };
}
