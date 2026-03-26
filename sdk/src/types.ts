/**
 * Core type definitions for GSD-1 PLAN.md structures.
 *
 * These types model the YAML frontmatter + XML task bodies
 * that make up a GSD plan file.
 */

// ─── Frontmatter types ───────────────────────────────────────────────────────

export interface MustHaveArtifact {
  path: string;
  provides: string;
  min_lines?: number;
  exports?: string[];
  contains?: string;
}

export interface MustHaveKeyLink {
  from: string;
  to: string;
  via: string;
  pattern?: string;
}

export interface MustHaves {
  truths: string[];
  artifacts: MustHaveArtifact[];
  key_links: MustHaveKeyLink[];
}

export interface UserSetupEnvVar {
  name: string;
  source: string;
}

export interface UserSetupDashboardConfig {
  task: string;
  location: string;
  details: string;
}

export interface UserSetupItem {
  service: string;
  why: string;
  env_vars?: UserSetupEnvVar[];
  dashboard_config?: UserSetupDashboardConfig[];
  local_dev?: string[];
}

export interface PlanFrontmatter {
  phase: string;
  plan: string;
  type: string;
  wave: number;
  depends_on: string[];
  files_modified: string[];
  autonomous: boolean;
  requirements: string[];
  user_setup?: UserSetupItem[];
  must_haves: MustHaves;
  [key: string]: unknown; // Allow additional fields
}

// ─── Task types ──────────────────────────────────────────────────────────────

export interface PlanTask {
  type: string;
  name: string;
  files: string[];
  read_first: string[];
  action: string;
  verify: string;
  acceptance_criteria: string[];
  done: string;
}

// ─── Parsed plan ─────────────────────────────────────────────────────────────

export interface ParsedPlan {
  frontmatter: PlanFrontmatter;
  objective: string;
  execution_context: string[];
  context_refs: string[];
  tasks: PlanTask[];
  raw: string;
}
