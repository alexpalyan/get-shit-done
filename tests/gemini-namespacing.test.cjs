/**
 * Regression tests for Gemini namespacing (PR #2768)
 * 
 * Verifies that slash commands are correctly converted to colon format (/gsd:)
 * while preserving URLs, file paths, and agent names.
 */

'use strict';

process.env.GSD_TEST_MODE = '1';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTempDir, cleanup } = require('./helpers.cjs');

const {
  convertSlashCommandsToGeminiMentions,
  convertClaudeToGeminiMarkdown,
  install
} = require('../bin/install.js');

describe('Gemini Slash Command Namespacing (Regex)', () => {
  test('converts simple slash commands', () => {
    const input = 'Run /gsd-plan-phase to start.';
    const expected = 'Run /gsd:plan-phase to start.';
    assert.strictEqual(convertSlashCommandsToGeminiMentions(input), expected);
  });

  test('preserves URLs with /gsd- in them', () => {
    const input = 'Documentation: https://example.com/gsd-tools/info';
    assert.strictEqual(convertSlashCommandsToGeminiMentions(input), input);
  });

  test('preserves sub-paths: bin/gsd-tools.cjs', () => {
    const input = 'See bin/gsd-tools.cjs for details.';
    assert.strictEqual(convertSlashCommandsToGeminiMentions(input), input);
  });

  test('preserves root-relative paths with extensions: /gsd-tools.cjs', () => {
    const input = 'Load /gsd-tools.cjs now.';
    assert.strictEqual(convertSlashCommandsToGeminiMentions(input), input);
  });

  test('preserves agent names: gsd-planner', () => {
    const input = 'The gsd-planner agent will help you.';
    assert.strictEqual(convertSlashCommandsToGeminiMentions(input), input);
  });

  test('converts commands in backticks', () => {
    const input = 'Run `/gsd-new-project` in a terminal.';
    const expected = 'Run `/gsd:new-project` in a terminal.';
    assert.strictEqual(convertSlashCommandsToGeminiMentions(input), expected);
  });

  test('converts commands ending with punctuation', () => {
    const input = 'Run /gsd-help. Or /gsd-scan!';
    const expected = 'Run /gsd:help. Or /gsd:scan!';
    assert.strictEqual(convertSlashCommandsToGeminiMentions(input), expected);
  });
});

describe('Gemini Markdown Processor', () => {
  test('handles command to TOML conversion', () => {
    const input = '---\ndescription: Test\n---\nRun /gsd-help.';
    const result = convertClaudeToGeminiMarkdown(input, { isCommand: true });
    assert.ok(result.includes('description = "Test"'), 'Should contain TOML description');
    assert.ok(result.includes('/gsd:help'), 'Should contain namespaced command');
  });
});

describe('Gemini Install (Behavioral)', () => {
  let tmpDir;
  let previousCwd;

  beforeEach(() => {
    tmpDir = createTempDir('gsd-gemini-test-');
    previousCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(previousCwd);
    cleanup(tmpDir);
  });

  test('install creates correct directory structure for Gemini', () => {
    // Run install in silent mode
    const oldLog = console.log;
    console.log = () => {};
    try {
      install(false, 'gemini');
    } finally {
      console.log = oldLog;
    }
    
    // Check if commands are in gsd/ folder inside .gemini/
    const commandsDir = path.join(tmpDir, '.gemini', 'commands', 'gsd');
    assert.ok(fs.existsSync(commandsDir), `Commands should be in ${commandsDir}`);
    
    // Check if agents are installed
    const agentsDir = path.join(tmpDir, '.gemini', 'agents');
    assert.ok(fs.existsSync(agentsDir), 'Agents should be installed');
  });
});
