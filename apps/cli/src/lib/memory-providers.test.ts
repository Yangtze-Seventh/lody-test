import { describe, expect, it } from 'vitest';
import { MemoryCreateInputSchema } from '@lody/shared';
import {
  createNowledgeMemoryProvider,
  handleMemoryProviderRequest,
  memoryEnvironment,
  withoutInheritedPackageManagerConfig,
} from './memory-providers';

describe('Nowledge memory provider', () => {
  it('distinguishes an absent executable, inactive service, and malformed output', async () => {
    for (const [result, status] of [
      [{ stdout: '', code: 'ENOENT' }, 'not_installed'],
      [{ stdout: '{"status":"starting"}' }, 'not_running'],
      [{ stdout: '{"status":"ok"}', code: 1 }, 'not_running'],
      [{ stdout: '{"status":"healthy"}', code: 1 }, 'not_running'],
      [{ stdout: '', code: 1 }, 'not_running'],
      [{ stdout: 'invalid' }, 'error'],
    ] as const) {
      const provider = createNowledgeMemoryProvider(async () => result);
      expect(
        await handleMemoryProviderRequest({ action: 'list', providerId: provider.id }, [provider])
      ).toEqual({ type: 'machine/memory', status, memories: [] });
    }
  });
  it.each(['ok', 'healthy'])('returns a ready empty inventory for %s', async (status) => {
    const provider = createNowledgeMemoryProvider(async (args) => ({
      stdout: JSON.stringify(args[0] === 'status' ? { status } : { agentProfiles: [] }),
    }));
    expect(
      await handleMemoryProviderRequest({ action: 'list', providerId: provider.id }, [provider])
    ).toEqual({ type: 'machine/memory', status: 'ready', memories: [] });
  });
  it.each(['ok', 'healthy'])(
    'enrolls a literal identity with %s status and returns the updated provider catalog',
    async (status) => {
      const profiles: {
        id: string;
        displayName: string;
        sourceApp: string;
        defaultSpaceId: string;
      }[] = [];
      const provider = createNowledgeMemoryProvider(async (args) => {
        if (args[0] === 'status') return { stdout: JSON.stringify({ status }) };
        if (args[1] === 'enroll') {
          // Model the CLI argv boundary: metacharacters must remain one literal value.
          const name = args[args.indexOf('--name') + 1];
          profiles.push({
            id: args[2] ?? '',
            displayName: name ?? '',
            sourceApp: args[args.indexOf('--source-app') + 1] ?? '',
            defaultSpaceId: args.includes('--default-space')
              ? (args[args.indexOf('--default-space') + 1] ?? '')
              : '',
          });
          return { stdout: '{}' };
        }
        return { stdout: JSON.stringify({ agentProfiles: profiles }) };
      });
      const result = await handleMemoryProviderRequest(
        {
          action: 'create',
          providerId: provider.id,
          input: { id: 'reviewer', name: 'Review $(literal); name' },
        },
        [provider]
      );
      expect(result).toEqual({
        type: 'machine/memory',
        status: 'ready',
        memories: [
          {
            id: 'reviewer',
            name: 'Review $(literal); name',
            description: undefined,
          },
        ],
      });
      expect(profiles[0]).toMatchObject({ sourceApp: 'lody.ai', defaultSpaceId: '' });
      expect(memoryEnvironment({ providerId: provider.id, memoryId: 'reviewer' })).toEqual({
        NMEM_AGENT_ID: 'reviewer',
      });
    }
  );
  it.each(['ok', 'healthy'])('updates the provider profile with %s status', async (status) => {
    const profile = { id: 'reviewer', displayName: 'Before' };
    const provider = createNowledgeMemoryProvider(async (args) => {
      if (args[0] === 'status') return { stdout: JSON.stringify({ status }) };
      if (args[1] === 'set') {
        profile.displayName = args[args.indexOf('--name') + 1] ?? '';
        return { stdout: '{}' };
      }
      return { stdout: JSON.stringify({ agentProfiles: [profile] }) };
    });
    const result = await handleMemoryProviderRequest(
      { action: 'update', providerId: provider.id, input: { id: profile.id, name: 'After' } },
      [provider]
    );
    expect(profile.displayName).toBe('After');
    expect(result).toEqual({
      type: 'machine/memory',
      status: 'ready',
      memories: [{ id: 'reviewer', name: 'After', description: undefined, role: undefined }],
    });
  });
  it.each(['ok', 'healthy'])(
    'does not mutate identities after a failed %s probe',
    async (status) => {
      const profiles: string[] = [];
      const provider = createNowledgeMemoryProvider(async (args) => {
        if (args[0] === 'status') return { stdout: JSON.stringify({ status }), code: 1 };
        profiles.push(args[2] ?? 'unexpected inventory');
        return { stdout: '{}' };
      });
      for (const action of ['create', 'update'] as const) {
        expect(
          await handleMemoryProviderRequest(
            { action, providerId: provider.id, input: { id: 'reviewer', name: 'Reviewer' } },
            [provider]
          )
        ).toEqual({ type: 'machine/memory', status: 'not_running', memories: [] });
      }
      expect(profiles).toEqual([]);
    }
  );
  it('requires a non-blank name and normalizes surrounding whitespace', () => {
    for (const name of [undefined, '', '   ']) {
      expect(MemoryCreateInputSchema.safeParse({ id: 'reviewer', name }).success).toBe(false);
    }
    expect(MemoryCreateInputSchema.parse({ id: 'reviewer', name: ' Reviewer ' }).name).toBe(
      'Reviewer'
    );
  });
  it('does not present failed or malformed catalogs as an empty success', async () => {
    const provider = createNowledgeMemoryProvider(async (args) =>
      args[0] === 'status'
        ? { stdout: '{"status":"ok"}' }
        : { stdout: '{"agentProfiles":[{"name":"missing id"}]}' }
    );
    expect(
      (await handleMemoryProviderRequest({ action: 'list', providerId: provider.id }, [provider]))
        .status
    ).toBe('error');
    expect(() => memoryEnvironment({ providerId: 'missing', memoryId: 'reviewer' })).toThrow(
      'Unsupported memory provider'
    );
  });
  it('refuses to connect agents through a provider that only manages identities', async () => {
    const provider = createNowledgeMemoryProvider(async () => ({ stdout: '{"status":"ok"}' }));
    expect(
      await handleMemoryProviderRequest(
        { action: 'connect', providerId: provider.id, targets: ['claude'] },
        [provider]
      )
    ).toMatchObject({ status: 'error' });
  });

  it('refuses to sign in through a provider that holds no account', async () => {
    const provider = createNowledgeMemoryProvider(async () => ({ stdout: '{"status":"ok"}' }));
    expect(
      await handleMemoryProviderRequest({ action: 'signIn', providerId: provider.id }, [provider])
    ).toMatchObject({ status: 'error' });
  });
});

describe('global install environment', () => {
  it('drops the package manager settings a parent script exported', () => {
    // `npm_config_prefix` names the directory of the package whose script is
    // running. Left in place, `npm install --global` put EverCLI inside the
    // checkout, where the machine could never find it.
    const cleaned = withoutInheritedPackageManagerConfig({
      PATH: '/usr/bin',
      HOME: '/home/someone',
      npm_config_prefix: '/repo/apps/electron',
      npm_config_registry: 'https://example.invalid/',
      NPM_CONFIG_PREFIX: '/repo/apps/electron',
    });
    expect(cleaned).toEqual({ PATH: '/usr/bin', HOME: '/home/someone' });
  });
});
