import { describe, expect, it } from 'vitest';
import type { MemoryAgent } from '@lody/shared';
import { buildMemoryAgentRows } from '../src/lib/memory-agent-rows';

const everme = (overrides: Partial<MemoryAgent> & { id: string }): MemoryAgent => ({
  displayName: overrides.id,
  integration: 'mcp',
  supported: true,
  connectable: true,
  connected: false,
  ...overrides,
});

describe('memory agent rows', () => {
  it('lists the machine’s own agents, not the provider’s catalogue', () => {
    const rows = buildMemoryAgentRows(
      [
        { agentType: 'claude', name: 'Claude Code' },
        { agentType: 'grok', name: 'Grok' },
      ],
      [everme({ id: 'claude' }), everme({ id: 'devin' }), everme({ id: 'pi' })]
    );
    // Devin and Pi are the provider's, not this machine's.
    expect(rows.map((row) => row.agentType)).toEqual(['claude', 'grok']);
  });

  it('puts an agent the provider has not adapted last, with nothing to act on', () => {
    const rows = buildMemoryAgentRows(
      [
        { agentType: 'grok', name: 'Grok' },
        { agentType: 'claude', name: 'Claude Code' },
      ],
      [everme({ id: 'claude' })]
    );
    expect(rows.map((row) => row.agentType)).toEqual(['claude', 'grok']);
    expect(rows[1]?.everme).toBeUndefined();
  });

  it('orders connected first, so connecting one lifts it on the next inventory', () => {
    const rows = buildMemoryAgentRows(
      [
        { agentType: 'bub', name: 'Bub' },
        { agentType: 'kimi', name: 'Kimi Code' },
        { agentType: 'claude', name: 'Claude Code' },
      ],
      [everme({ id: 'kimi' }), everme({ id: 'claude', connected: true })]
    );
    expect(rows.map((row) => row.agentType)).toEqual(['claude', 'kimi', 'bub']);
  });

  it('keeps an adapted but unreachable agent with the adapted ones', () => {
    const rows = buildMemoryAgentRows(
      [
        { agentType: 'devin', name: 'Devin' },
        { agentType: 'dimcode', name: 'Dimcode' },
      ],
      [everme({ id: 'devin', connectable: false, notice: 'absent_on_machine' })]
    );
    // Known-but-absent is a row the provider will act on once the agent is
    // there; never-heard-of is not. They must not share a place.
    expect(rows.map((row) => row.agentType)).toEqual(['devin', 'dimcode']);
    expect(rows[0]?.everme?.connectable).toBe(false);
    expect(rows[1]?.everme).toBeUndefined();
  });

  it('recognises a config saved under an alias as the row it already has', () => {
    const rows = buildMemoryAgentRows(
      [{ agentType: 'kimi-code', name: 'Kimi Code' }],
      [everme({ id: 'kimi', aliases: ['kimi-code'], displayName: 'Kimi Code' })]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.everme?.id).toBe('kimi');
  });

  it('collapses two configs for one agent into a single row', () => {
    const rows = buildMemoryAgentRows(
      [
        { agentType: 'claude', name: 'Claude Code' },
        { agentType: 'claude', name: 'Claude' },
      ],
      [everme({ id: 'claude' })]
    );
    // Connecting is per agent, not per config, so two configs cannot disagree.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.displayName).toBe('Claude Code');
  });

  it('shows one row when two agent types drive the same agent', () => {
    // `claude-p` runs the user's own Claude Code through a pty, so both config
    // types reach one connection. Two rows would always agree and each would
    // act on the other — a switch that appears twice is a switch nobody trusts.
    const rows = buildMemoryAgentRows(
      [
        { agentType: 'claude', name: 'Claude Code' },
        { agentType: 'claude-p', name: 'Interactive Claude' },
      ],
      [everme({ id: 'claude', aliases: ['claude-p'], displayName: 'Claude Code', connected: true })]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.displayName).toBe('Claude Code');
  });

  it('keeps two unadapted agents apart even though neither has a provider row', () => {
    const rows = buildMemoryAgentRows(
      [
        { agentType: 'bub', name: 'Bub' },
        { agentType: 'dimcode', name: 'Dimcode' },
      ],
      []
    );
    expect(rows.map((row) => row.agentType)).toEqual(['bub', 'dimcode']);
  });

  it('prefers Lody’s own name over a renamed config', () => {
    const rows = buildMemoryAgentRows(
      [{ agentType: 'codex', name: 'My Work Codex' }],
      [everme({ id: 'codex', displayName: 'Codex' })]
    );
    expect(rows[0]?.displayName).toBe('Codex');
  });

  it('names an agent only this machine knows by its own config', () => {
    const rows = buildMemoryAgentRows([{ agentType: 'acp-my-thing', name: 'My Agent' }], []);
    expect(rows[0]?.displayName).toBe('My Agent');
    expect(rows[0]?.everme).toBeUndefined();
  });

  it('does not call an agent unadapted before the provider has answered', () => {
    // Configs arrive from a local atom, the provider's state from a machine
    // round-trip. In between, every row would otherwise claim a verdict the
    // provider never gave.
    const rows = buildMemoryAgentRows([{ agentType: 'claude', name: 'Claude Code' }], [], false);
    expect(rows[0]?.pending).toBe(true);
    expect(rows[0]?.everme).toBeUndefined();
  });

  it('calls an agent unadapted once the provider has answered without it', () => {
    const rows = buildMemoryAgentRows([{ agentType: 'grok', name: 'Grok' }], [everme({ id: 'pi' })]);
    expect(rows[0]?.pending).toBeUndefined();
  });

  it('shows nothing rather than the provider’s catalogue when configs are absent', () => {
    // A silent fall-back would hide "configs never arrived" behind a list that
    // looks right, which is exactly the failure it is meant to protect from.
    expect(buildMemoryAgentRows([], [everme({ id: 'claude' })])).toEqual([]);
  });
});
