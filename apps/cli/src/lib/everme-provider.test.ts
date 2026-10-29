import { describe, expect, it } from 'vitest';
import type { MemoryProviderRequest } from '@lody/shared';
import { handleMemoryProviderRequest } from './memory-providers';
import { createEverMeMemoryProvider } from './everme-provider';

type EverMeRow = { installed?: boolean; hasEverMeEntry?: boolean; connectionStatus?: string };
type EverMeState = {
  platforms: Record<string, EverMeRow>;
  calls: string[][];
  /** null stands for an installed CLI that nobody has signed in on. */
  account?: string | null;
  failing?: readonly string[];
  /** Platforms whose command succeeds on disk but still exits non-zero. */
  noisy?: readonly string[];
  /** Replaces the inventory reply, to model a CLI that stops answering. */
  listReply?: { stdout: string; code?: string | number };
  /** Applies `listReply` only from the Nth inventory call onward (1-based). */
  listFailsFrom?: number;
  listCalls?: number;
  /** Device-flow replies, one consumed per `auth login`, in order. */
  login?: { stdout: string; code?: string | number }[];
};
const everMeRunner = (state: EverMeState) => async (args: string[]) => {
  state.calls.push(args);
  if (args[0] === 'auth' && args[1] === 'login')
    return state.login?.shift() ?? { stdout: '{"ok":false}', code: 1 };
  if (args[0] === 'auth')
    return {
      stdout: JSON.stringify(
        state.account === null ? { ok: false } : { ok: true, data: { accountId: 'account' } }
      ),
    };
  if (args[1] === 'list') {
    state.listCalls = (state.listCalls ?? 0) + 1;
    if (state.listReply && state.listCalls >= (state.listFailsFrom ?? 1)) return state.listReply;
    return {
      stdout: JSON.stringify({
        ok: true,
        data: {
          platforms: Object.entries(state.platforms).map(([platform, row]) => ({
            platform,
            installed: row.installed,
            hasEverMeEntry: row.hasEverMeEntry,
            registeredAgent: row.connectionStatus
              ? { connectionStatus: row.connectionStatus }
              : null,
          })),
        },
      }),
    };
  }
  const platform = args[2] ?? '';
  if (state.failing?.includes(platform)) return { stdout: '{"ok":false}', code: 1 };
  state.platforms[platform] = {
    ...state.platforms[platform],
    hasEverMeEntry: args[1] === 'install',
  };
  // EverCLI can finish the write and still exit non-zero, e.g. when a host
  // plugin registry is unreachable.
  return state.noisy?.includes(platform)
    ? { stdout: '{"ok":false}', code: 1 }
    : { stdout: '{"ok":true}' };
};
const agentsOf = async (state: EverMeState, request: Omit<MemoryProviderRequest, 'providerId'>) => {
  const provider = createEverMeMemoryProvider(everMeRunner(state));
  const response = await handleMemoryProviderRequest(
    { ...request, providerId: provider.id } as MemoryProviderRequest,
    [provider]
  );
  return { response, agent: (id: string) => response.agents?.find((entry) => entry.id === id) };
};
/** One provider across the whole flow: the started flow lives on the provider. */
const signInOf = (state: EverMeState) => {
  const provider = createEverMeMemoryProvider(everMeRunner(state));
  return (action: 'signIn' | 'signInPoll') =>
    handleMemoryProviderRequest({ action, providerId: provider.id }, [provider]);
};
/** As above, plus the installer, so a job can be started and then asked after. */
const installOf = (state: EverMeState, npm: string[][], reply: { code?: number } = {}) => {
  const provider = createEverMeMemoryProvider(everMeRunner(state), async (args) => {
    npm.push(args);
    return { stdout: '', ...reply };
  });
  return (action: 'list' | 'install' | 'installPoll') =>
    handleMemoryProviderRequest({ action, providerId: provider.id }, [provider]);
};
/** Lets a started install settle before the next poll reads its outcome. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
/** Shaped after a real `evercli auth login --no-wait --format json` reply. */
const pendingLogin = (overrides: Record<string, unknown> = {}) => ({
  stdout: JSON.stringify({
    ok: true,
    data: {
      status: 'pending',
      userCode: 'WXYZ-1234',
      verificationUrl: 'https://everme.evermind.ai/cli-auth?userCode=WXYZ-1234',
      expiresInSec: 3600,
      deviceCode: 'dc_secret',
      resumeCommand: 'evercli auth login --device-code dc_secret --format json',
      ...overrides,
    },
  }),
});

/** The reply a resumed flow gets once the browser has approved it. */
const approvedLogin = {
  stdout: JSON.stringify({
    ok: true,
    data: {
      status: 'approved',
      accountId: 'a43ced06-442d-476e-b391-a6a368b115c5',
      email: 'someone@example.com',
      apiKeyPrefix: 'emk_b6e0',
      scopes: ['mem:read', 'mem:write', 'mem:search', 'plugin:manage'],
    },
  }),
};
/** What EverCLI answers once a device code has already been redeemed. */
const spentLogin = {
  stdout: JSON.stringify({
    ok: false,
    error: {
      type: 'auth',
      code: 30103,
      message: 'Authorization already processed',
      hint: 'Run `evercli auth login` to re-authenticate',
      detail: { requestId: '4b0f0caa-406e-431e-bb9e-a744a2f036b2' },
    },
    meta: { requestId: '4b0f0caa-406e-431e-bb9e-a744a2f036b2' },
  }),
  code: 3,
};

describe('EverMe memory provider', () => {
  it('separates a missing CLI from one nobody has signed in on', async () => {
    for (const [result, status] of [
      [{ stdout: '', code: 'ENOENT' }, 'not_installed'],
      // The real reply after `evercli auth logout`.
      [
        {
          stdout: JSON.stringify({
            ok: false,
            error: {
              type: 'not_logged_in',
              message: 'Not logged in',
              hint: 'Run `evercli auth login` first',
            },
          }),
        },
        'not_running',
      ],
      [{ stdout: 'invalid' }, 'error'],
    ] as const) {
      const provider = createEverMeMemoryProvider(async () => result);
      expect(
        await handleMemoryProviderRequest({ action: 'list', providerId: provider.id }, [provider])
      ).toEqual({ type: 'machine/memory', status, memories: [] });
    }
  });

  it('lists agents without identities and explains the rows it cannot act on', async () => {
    const { response, agent } = await agentsOf(
      { platforms: { 'claude-code': { installed: true, hasEverMeEntry: true } }, calls: [] },
      { action: 'list' }
    );
    expect(response.status).toBe('ready');
    expect(response.memories).toEqual([]);
    expect(agent('claude')).toMatchObject({
      connected: true,
      connectable: true,
      integration: 'hook',
    });
    // Codex is a hook harness too, even though this machine has not got it yet.
    expect(agent('codex')).toMatchObject({ integration: 'hook', connectable: false });
    expect(agent('opencode')).toMatchObject({ integration: 'mcp', connected: false });
    expect(agent('devin')?.notice).toBe('absent_on_machine');
  });

  it('leaves an already connected agent alone so its token survives the click', async () => {
    const state: EverMeState = {
      platforms: { 'claude-code': { installed: true, hasEverMeEntry: true }, codex: {} },
      calls: [],
    };
    const { agent } = await agentsOf(state, { action: 'connect', targets: ['claude', 'codex'] });
    expect(state.calls.filter((call) => call[1] === 'install').map((call) => call[2])).toEqual([
      'codex',
    ]);
    expect(agent('claude')?.connected).toBe(true);
    expect(agent('codex')?.connected).toBe(true);
  });

  it('forces agents EverCLI cannot see on PATH, since Lody runs managed binaries', async () => {
    const state: EverMeState = {
      platforms: { codex: { installed: false }, 'claude-code': { installed: true } },
      calls: [],
    };
    await agentsOf(state, { action: 'connect', targets: ['codex', 'claude'] });
    const install = (platform: string) =>
      state.calls.find((call) => call[1] === 'install' && call[2] === platform) ?? [];
    expect(install('codex')).toContain('--force');
    expect(install('claude-code')).not.toContain('--force');
  });

  it('keeps going when one agent fails and reports only that row as unconnected', async () => {
    const state: EverMeState = {
      platforms: { 'claude-code': { installed: true }, codex: { installed: true } },
      calls: [],
      failing: ['codex'],
    };
    const { agent } = await agentsOf(state, { action: 'connect', targets: ['claude', 'codex'] });
    expect(agent('claude')?.connected).toBe(true);
    expect(agent('codex')?.connected).toBe(false);
    expect(agent('codex')?.notice).toBe('connect_failed');
  });

  it('trusts the refreshed inventory over a noisy exit code', async () => {
    const state: EverMeState = {
      platforms: { 'claude-code': { installed: true } },
      calls: [],
      noisy: ['claude-code'],
    };
    const { agent } = await agentsOf(state, { action: 'connect', targets: ['claude'] });
    // Reconnecting after a disconnect must never report both states at once.
    expect(agent('claude')?.connected).toBe(true);
    expect(agent('claude')?.notice).toBeUndefined();
  });

  it('keeps the failure when the agent really did not reach the asked-for state', async () => {
    const state: EverMeState = {
      platforms: { 'claude-code': { installed: true } },
      calls: [],
      failing: ['claude-code'],
    };
    const { agent } = await agentsOf(state, { action: 'connect', targets: ['claude'] });
    expect(agent('claude')?.connected).toBe(false);
    expect(agent('claude')?.notice).toBe('connect_failed');
  });

  it('installs one platform once when two agentTypes share it', async () => {
    const state: EverMeState = { platforms: { kimicode: { installed: true } }, calls: [] };
    await agentsOf(state, { action: 'connect', targets: ['kimi', 'kimi-code'] });
    expect(state.calls.filter((call) => call[1] === 'install')).toHaveLength(1);
  });

  it('disconnects only what is connected and flags a stale cloud agent', async () => {
    const state: EverMeState = {
      platforms: {
        'claude-code': { installed: true, hasEverMeEntry: true },
        codex: { installed: true, hasEverMeEntry: true, connectionStatus: 'disconnected' },
      },
      calls: [],
    };
    const { agent } = await agentsOf(state, { action: 'disconnect', targets: ['claude'] });
    expect(state.calls.filter((call) => call[1] === 'uninstall').map((call) => call[2])).toEqual([
      'claude-code',
    ]);
    expect(agent('claude')?.connected).toBe(false);
    expect(agent('codex')).toMatchObject({ connected: true });
    expect(agent('codex')?.notice).toBe('cloud_disconnected');
  });

  it('reports an unreadable inventory as an error rather than an empty machine', async () => {
    for (const listReply of [
      { stdout: '', code: 1 },
      { stdout: 'not json' },
      { stdout: '{"ok":false,"error":"rate limited"}' },
    ] as const) {
      const { response } = await agentsOf(
        { platforms: { 'claude-code': { installed: true } }, calls: [], listReply },
        { action: 'list' }
      );
      // An empty agent list would read as "nothing to connect here", which is a
      // different claim from "EverMe could not be read".
      expect(response.status).toBe('error');
      expect(response.agents).toBeUndefined();
    }
  });

  it('surfaces an error when the state after a write cannot be read back', async () => {
    const state: EverMeState = {
      platforms: { 'claude-code': { installed: true } },
      calls: [],
      listReply: { stdout: '', code: 1 },
      listFailsFrom: 2,
    };
    const { response } = await agentsOf(state, { action: 'connect', targets: ['claude'] });
    expect(state.calls.some((call) => call[1] === 'install')).toBe(true);
    // The write happened, but its outcome is unknown; claiming either way lies.
    expect(response.status).toBe('error');
  });

  it('never rotates a token for an agent the user did not click', async () => {
    const state: EverMeState = {
      platforms: {
        'claude-code': { installed: true },
        codex: { installed: true, hasEverMeEntry: true },
        kimicode: { installed: true },
      },
      calls: [],
    };
    await agentsOf(state, { action: 'connect', targets: ['claude'] });
    expect(state.calls.filter((call) => call[1] === 'install').map((call) => call[2])).toEqual([
      'claude-code',
    ]);
  });

  it('ignores an agentType it does not know without disturbing the rest', async () => {
    const state: EverMeState = {
      platforms: { 'claude-code': { installed: true }, hermes: { installed: true } },
      calls: [],
    };
    // `hermes` is a platform EverMe has but Lody never launches; `grok` is the
    // reverse. Neither is a target this provider can act on.
    const { response, agent } = await agentsOf(state, {
      action: 'connect',
      targets: ['grok', 'hermes', 'claude'],
    });
    expect(state.calls.filter((call) => call[1] === 'install').map((call) => call[2])).toEqual([
      'claude-code',
    ]);
    expect(response.agents?.map((entry) => entry.id)).not.toContain('grok');
    expect(agent('claude')?.connected).toBe(true);
  });

  it('runs nothing when the click asks for a state the agent is already in', async () => {
    const state: EverMeState = {
      platforms: { 'claude-code': { installed: true }, codex: { installed: true } },
      calls: [],
    };
    // codex is already absent, so disconnecting it has nothing to undo.
    await agentsOf(state, { action: 'disconnect', targets: ['codex'] });
    expect(state.calls.filter((call) => call[1] === 'uninstall')).toHaveLength(0);
  });

  it('does not force a disconnect, which would be a different command', async () => {
    const state: EverMeState = {
      platforms: { codex: { installed: false, hasEverMeEntry: true } },
      calls: [],
    };
    await agentsOf(state, { action: 'disconnect', targets: ['codex'] });
    const uninstall = state.calls.find((call) => call[1] === 'uninstall') ?? [];
    expect(uninstall).toContain('--yes');
    expect(uninstall).not.toContain('--force');
  });

  it('skips an agent EverMe does not know on this machine instead of guessing', async () => {
    const state: EverMeState = { platforms: { 'claude-code': { installed: true } }, calls: [] };
    const { agent } = await agentsOf(state, { action: 'connect', targets: ['devin'] });
    expect(state.calls.filter((call) => call[1] === 'install')).toHaveLength(0);
    expect(agent('devin')).toMatchObject({ connectable: false, connected: false });
    expect(agent('devin')?.notice).toBe('absent_on_machine');
  });

  it('keeps reporting a stale cloud agent that this batch never touched', async () => {
    const state: EverMeState = {
      platforms: {
        'claude-code': { installed: true },
        opencode: { installed: true, hasEverMeEntry: true, connectionStatus: 'disconnected' },
      },
      calls: [],
    };
    const { agent } = await agentsOf(state, { action: 'connect', targets: ['claude'] });
    expect(agent('claude')?.notice).toBeUndefined();
    expect(agent('opencode')?.notice).toBe('cloud_disconnected');
  });

  it('treats a signalled command as a failure, not a silent success', async () => {
    const state: EverMeState = { platforms: { 'claude-code': { installed: true } }, calls: [] };
    const provider = createEverMeMemoryProvider(async (args) => {
      if (args[0] === 'auth') return { stdout: '{"ok":true,"data":{"accountId":"a"}}' };
      if (args[1] === 'list') return everMeRunner(state)(args);
      // A killed process reports no exit code at all.
      return { stdout: '', code: 'failed' };
    });
    const response = await handleMemoryProviderRequest(
      { action: 'connect', providerId: provider.id, targets: ['claude'] },
      [provider]
    );
    const claude = response.agents?.find((entry) => entry.id === 'claude');
    expect(claude?.connected).toBe(false);
    expect(claude?.notice).toBe('connect_failed');
  });

  it('rejects a batch with no targets before reaching the CLI', async () => {
    const state: EverMeState = { platforms: { 'claude-code': { installed: true } }, calls: [] };
    const provider = createEverMeMemoryProvider(everMeRunner(state));
    expect(
      await handleMemoryProviderRequest(
        { action: 'connect', providerId: provider.id, targets: [] } as never,
        [provider]
      )
    ).toMatchObject({ status: 'error' });
    expect(state.calls).toHaveLength(0);
  });

  it('refuses to connect while nobody is signed in', async () => {
    const state: EverMeState = {
      platforms: { 'claude-code': { installed: true } },
      calls: [],
      account: null,
    };
    const { response } = await agentsOf(state, { action: 'connect', targets: ['claude'] });
    expect(response.status).toBe('not_running');
    expect(state.calls.some((call) => call[1] === 'install')).toBe(false);
  });

  it('says which account the machine is signed in as', async () => {
    const provider = createEverMeMemoryProvider(async (args) => ({
      stdout: JSON.stringify(
        args[0] === 'auth'
          ? { ok: true, data: { accountId: 'a43ced06', email: 'someone@example.com' } }
          : { ok: true, data: { platforms: [] } }
      ),
    }));
    const response = await handleMemoryProviderRequest(
      { action: 'list', providerId: provider.id },
      [provider]
    );
    // Without this the panel never names whose memory its agents reach.
    expect(response.account).toBe('someone@example.com');
  });

  it('falls back to the account id when EverMe reports no email', async () => {
    const provider = createEverMeMemoryProvider(async (args) => ({
      stdout: JSON.stringify(
        args[0] === 'auth'
          ? { ok: true, data: { accountId: 'a43ced06' } }
          : { ok: true, data: { platforms: [] } }
      ),
    }));
    expect(
      (await handleMemoryProviderRequest({ action: 'list', providerId: provider.id }, [provider]))
        .account
    ).toBe('a43ced06');
  });

  it('hands back a page to approve and keeps the device code on the machine', async () => {
    const state: EverMeState = { platforms: {}, calls: [], account: null, login: [pendingLogin()] };
    const response = await signInOf(state)('signIn');
    expect(response).toMatchObject({
      status: 'not_running',
      signIn: {
        status: 'pending',
        userCode: 'WXYZ-1234',
        verificationUrl: 'https://everme.evermind.ai/cli-auth?userCode=WXYZ-1234',
        expiresInSec: 3600,
      },
    });
    // The half that claims an account never travels to the browser and back.
    expect(JSON.stringify(response)).not.toContain('dc_secret');
    expect(state.calls.find((call) => call[1] === 'login')).toContain('--no-wait');
  });

  it('answers an approved sign-in with the inventory that account unlocked', async () => {
    const state: EverMeState = {
      platforms: { 'claude-code': { installed: true } },
      calls: [],
      account: null,
      login: [pendingLogin(), approvedLogin],
    };
    const signIn = signInOf(state);
    await signIn('signIn');
    // Approval is what makes the CLI signed in, so the fake becomes one too.
    state.account = 'account';
    const response = await signIn('signInPoll');
    expect(response.status).toBe('ready');
    expect(response.signIn).toEqual({ status: 'approved' });
    expect(response.agents?.find((entry) => entry.id === 'claude')).toMatchObject({
      connectable: true,
      connected: false,
    });
  });

  it('keeps waiting through a blip and gives up only once the code is spent', async () => {
    const state: EverMeState = {
      platforms: {},
      calls: [],
      account: null,
      login: [
        pendingLogin(),
        { stdout: JSON.stringify({ ok: false, error: { type: 'network' } }), code: 1 },
        spentLogin,
      ],
    };
    const signIn = signInOf(state);
    await signIn('signIn');
    expect((await signIn('signInPoll')).signIn).toEqual({ status: 'pending' });
    expect((await signIn('signInPoll')).signIn).toEqual({ status: 'expired' });
    // A spent code ends the flow, so the next poll never reaches the CLI.
    const spoken = state.calls.length;
    expect((await signIn('signInPoll')).signIn).toEqual({ status: 'expired' });
    expect(state.calls).toHaveLength(spoken);
  });

  it('will not finish a flow it never started', async () => {
    const state: EverMeState = { platforms: {}, calls: [], account: null };
    expect((await signInOf(state)('signInPoll')).signIn).toEqual({ status: 'expired' });
    expect(state.calls).toHaveLength(0);
  });

  it('refuses a sign-in page a browser should not be sent to', async () => {
    const state: EverMeState = {
      platforms: {},
      calls: [],
      account: null,
      login: [pendingLogin({ verificationUrl: 'javascript:alert(1)' })],
    };
    expect(await signInOf(state)('signIn')).toMatchObject({ status: 'error' });
  });

  it('fetches EverCLI for a machine that has not got it, and says so while it runs', async () => {
    const npm: string[][] = [];
    const state: EverMeState = { platforms: {}, calls: [], account: null };
    const absent = createEverMeMemoryProvider(
      async () => ({ stdout: '', code: 'ENOENT' }),
      async (args) => {
        npm.push(args);
        return { stdout: '' };
      }
    );
    const response = await handleMemoryProviderRequest(
      { action: 'install', providerId: absent.id },
      [absent]
    );
    expect(response).toMatchObject({ status: 'not_installed', install: { status: 'running' } });
    expect(npm[0]).toEqual(['install', '--global', '@everme/cli']);
    expect(state.calls).toHaveLength(0);
  });

  it('will not upgrade an EverCLI that is already working', async () => {
    const npm: string[][] = [];
    const state: EverMeState = { platforms: {}, calls: [] };
    // Install probes before it acts, so a returning machine answers for itself
    // even if the click somehow arrived without the page asking first.
    expect((await installOf(state, npm)('install')).install).toEqual({ status: 'done' });
    expect(npm).toHaveLength(0);
  });

  it('answers an install on a signed-in machine with the agents it already has', async () => {
    const npm: string[][] = [];
    const state: EverMeState = {
      platforms: { 'claude-code': { installed: true, hasEverMeEntry: true }, codex: {} },
      calls: [],
    };
    // Without these the panel spends a whole refresh interval telling a user
    // who just installed that EverMe adapts none of their agents.
    const response = await installOf(state, npm)('install');
    expect(response.install).toEqual({ status: 'done' });
    expect(response.agents?.find((agent) => agent.id === 'claude')?.connected).toBe(true);
  });

  it('reports an install that could not be made, rather than retrying forever', async () => {
    const npm: string[][] = [];
    const absent = createEverMeMemoryProvider(
      async () => ({ stdout: '', code: 'ENOENT' }),
      async (args) => {
        npm.push(args);
        return { stdout: '', code: 1 };
      }
    );
    const ask = (action: 'install' | 'installPoll') =>
      handleMemoryProviderRequest({ action, providerId: absent.id }, [absent]);
    await ask('install');
    await settle();
    expect((await ask('installPoll')).install).toEqual({ status: 'failed' });
    // Asking after a job is not asking for another one.
    expect(npm).toHaveLength(1);
  });

  it('fetches a fresh build when EverCLI is there but will not answer', async () => {
    const npm: string[][] = [];
    // Installed — the command runs — but its output is not something to read.
    const unreadable = createEverMeMemoryProvider(
      async () => ({ stdout: 'not json' }),
      async (args) => {
        npm.push(args);
        return { stdout: '' };
      }
    );
    expect(
      await handleMemoryProviderRequest({ action: 'install', providerId: unreadable.id }, [
        unreadable,
      ])
    ).toMatchObject({ status: 'error', install: { status: 'running' } });
    expect(npm[0]).toEqual(['install', '--global', '@everme/cli']);
  });

  it('leaves a signed-in machine alone instead of minting it a second key', async () => {
    const state: EverMeState = { platforms: {}, calls: [], login: [pendingLogin()] };
    expect((await signInOf(state)('signIn')).signIn).toEqual({ status: 'approved' });
    expect(state.calls.some((call) => call[1] === 'login')).toBe(false);
  });

  it('maps a registry agent whose Lody id differs from its EverMe platform', async () => {
    // Lody's registry calls it `minimax-code`; EverMe's platform is
    // `minimaxcode`. Neither name can be derived from the other, so a missing
    // row here reads in the panel as "EverMe has not adapted this agent" —
    // which is exactly wrong when the user already connected it elsewhere.
    const { agent } = await agentsOf(
      {
        platforms: {
          minimaxcode: { installed: true, hasEverMeEntry: true },
          cursor: { installed: false },
        },
        calls: [],
      },
      { action: 'list' }
    );
    expect(agent('minimax-code')).toMatchObject({ connected: true, integration: 'hook' });
    expect(agent('cursor')).toMatchObject({ connected: false, integration: 'mcp' });
  });

  it('injects nothing, because EverMe keeps its credentials in its own config', () => {
    expect(createEverMeMemoryProvider(async () => ({ stdout: '{}' })).environment('any')).toEqual(
      {}
    );
  });
});
