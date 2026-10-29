import { useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import * as stylex from '@stylexjs/stylex';
import { Check, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Tooltip } from '@lody/ui/tooltip';
import { Popover } from '@lody/ui/popover';
import { useIsMobile } from '@/hooks/use-mobile';
import { Button } from '@lody/ui/button';
import { Input } from '@lody/ui/input';
import { Textarea } from '@lody/ui/textarea';
import { Tabs } from '@lody/ui/tabs';
import { Checkbox } from '@lody/ui/checkbox';
import { Spinner } from '@lody/ui/spinner';
import { colors } from '@lody/ui/tokens/colors.stylex';
import { space, text } from '@lody/ui/tokens/scales.stylex';
import { Dialog } from '@/ui/dialog';
import {
  MEMORY_PROVIDERS,
  getAgentRoleEmoji,
  getAgentRoleTarget,
  type AgentRole,
  MemoryCreateInputSchema,
  isAgentConnectProvider,
  providerInstalls,
  providerSignsIn,
  isMemoryIdentityMissing,
  machineSupportsMemoryProviders,
  type MachineId,
  type MemoryAssociation,
  type MemoryBinding,
  type MemoryCreateInput,
  type MemoryIdentity,
  type MemoryProviderResponse,
} from '@lody/shared';
import evermeLogo from '@/assets/everme.png';
import nowledgeLogo from '@/assets/nowledge-mem.png';
import { localMachineIdAtom } from '@/atoms/local-probe';
import { useVisibleMachineMetas } from '@/hooks/use-visible-machine-metas';
import { useMachineOnlineStatus, useOnlineMachineIds } from '@/hooks/use-machine-online-status';
import { useMemoryProvider } from '@/hooks/use-memory-provider';
import { useOpenSettings } from '@/hooks/use-open-settings';
import { useWorkspaceAgentRoles } from '@/hooks/use-workspace-agent-roles';
import { useMemoryAssociations } from '@/hooks/use-memory-associations';
import { useAppCapability } from '@/lib/app-platform';
import { openExternalUrl } from '@/lib/native-browser';
import { MachinePills } from './machine-pills';
import { MemoryAgentConnectList } from './memory-agent-connect';
import { getAgentConfigsByMachineAtomFamily } from '@/atoms/agents';
import { useMachineFlockAgentConfigsForMachineIds } from '@/hooks/use-machine-flock-agent-configs';
import { MemoryInstallCard } from './memory-install';
import { MemorySignInCard } from './memory-sign-in';
import { Field, FormMessage } from './form-primitives';
import { settingsCatalog as catalog, settingsSurface as surface } from './surface';
import { SettingsEmptyList, settingsRecordsCard } from './compact-layout';
import { SettingsLineTabs } from './settings-line-tabs';
import { SettingsPageActions, SettingsPageLead, useInSettingsPane } from './settings-page-header';

type ProviderDefinition = {
  id: string;
  name: string;
  installUrl?: string;
  createFields: readonly (keyof MemoryCreateInput)[];
};
const styles = stylex.create({
  stack: { display: 'flex', flexDirection: 'column', gap: space[4], minWidth: 0 },
  row: { display: 'flex', alignItems: 'center', gap: space[2] },
  machineDot: {
    flexShrink: 0,
    width: '6px',
    height: '6px',
    borderRadius: '999px',
    backgroundColor: colors.tertiaryLabel,
  },
  machineDotOnline: { backgroundColor: colors.success },
  recordLogo: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    flexShrink: 0,
    width: '32px',
    height: '32px',
  },
  assignedRoles: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    // Keep the cluster at its content width: a shrinking cluster wraps its
    // avatar under the label, so the label's position depends on how long the
    // description happens to be.
    flexShrink: 0,
    // The title line is the stable anchor. Centring against the row would move
    // the label whenever a description wraps to another line. The small start
    // margin centres the avatar controls with the name, not the row.
    alignSelf: 'flex-start',
    gap: space[1],
    maxWidth: '45%',
    marginBlockStart: space[1],
  },
  assignedLabel: { whiteSpace: 'nowrap' },
  unlinkRow: { display: 'flex', justifyContent: 'flex-end' },
  record: { position: 'relative' },
  actions: {
    opacity: {
      default: 0,
      [stylex.when.ancestor(':hover')]: 1,
      [stylex.when.ancestor(':focus-within')]: 1,
      '@media (hover: none)': 1,
    },
    pointerEvents: {
      default: 'none',
      [stylex.when.ancestor(':hover')]: 'auto',
      [stylex.when.ancestor(':focus-within')]: 'auto',
      '@media (hover: none)': 'auto',
    },
  },
  logo: {
    width: '20px',
    height: '20px',
    flexShrink: 0,
    objectFit: 'contain',
    filter: 'grayscale(1)',
  },
  logoBrandColor: { filter: 'none' },
  description: {
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
    overflow: 'hidden',
    fontSize: text.footnoteSize,
    color: colors.secondaryLabel,
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
  },
  note: { padding: space[4] },
  // Full width, the way it read before: the one thing to do about a missing
  // provider, not a link tucked beside the sentence explaining it. A column
  // flex so the button stretches; the padding keeps it its own step.
  installAction: { display: 'flex', flexDirection: 'column', paddingBlock: space[1] },
  emptyHint: {
    color: colors.tertiaryLabel,
    textAlign: 'center',
    fontSize: text.footnoteSize,
    paddingBlock: space[4],
    margin: 0,
  },
  layout: {
    display: 'flex',
    height: '100%',
    minHeight: 0,
    '@media (max-width: 600px)': { flexDirection: 'column' },
  },
  rail: {
    display: 'flex',
    flexDirection: 'column',
    gap: space[2],
    flexShrink: 0,
    width: '292px',
    paddingBlock: space[4],
    paddingInline: space[2],
    boxSizing: 'border-box',
    backgroundColor: `color-mix(in oklab, transparent, ${colors.label} 3%)`,
    borderInlineEnd: `1px solid ${colors.separator}`,
    '@media (max-width: 600px)': {
      width: '100%',
      borderInlineEnd: 'none',
      borderBottom: `1px solid ${colors.separator}`,
    },
  },
  railTitle: { paddingInline: space[2] },
  railItem: { gap: '10px', fontSize: '13px' },
  railIcon: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
  },
  detail: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    padding: space[6],
    gap: space[4],
  },
  form: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: space[4] },
  scroll: {
    display: 'flex',
    flexDirection: 'column',
    gap: space[4],
    overflowY: 'auto',
    flex: 1,
    minHeight: 0,
    padding: space[1],
  },
  fields: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: space[4] },
  fullField: { gridColumn: '1 / -1' },
});

const PROVIDER_LOGOS: Record<string, { src: string; alt: string }> = {
  'nowledge-mem': { src: nowledgeLogo, alt: 'Nowledge Mem' },
  everme: { src: evermeLogo, alt: 'EverMe' },
};
export function MemoryProviderLogo({
  providerId,
  brandColor,
  decorative,
}: {
  providerId: string;
  /** Section headings keep the mark in colour; list rows stay desaturated. */
  brandColor?: boolean;
  /**
   * The provider's name is already beside it. Naming the mark too makes a
   * screen reader say it twice.
   */
  decorative?: boolean;
}) {
  const logo = PROVIDER_LOGOS[providerId];
  return logo ? (
    <img
      src={logo.src}
      alt={decorative ? '' : logo.alt}
      {...stylex.props(styles.logo, brandColor && styles.logoBrandColor)}
    />
  ) : null;
}

function MemoryRoleAvatar({ role }: { role: AgentRole }) {
  const mobile = useIsMobile();
  const trigger = (
    <Button type="button" variant="ghost" size="small" icon aria-label={role.name}>
      <span aria-hidden="true">{getAgentRoleEmoji(role)}</span>
    </Button>
  );
  return mobile ? (
    <Popover.Root>
      <Popover.Trigger render={trigger} />
      <Popover.Content>{role.name}</Popover.Content>
    </Popover.Root>
  ) : (
    <Tooltip.Root>
      <Tooltip.Trigger render={trigger} />
      <Tooltip.Content>{role.name}</Tooltip.Content>
    </Tooltip.Root>
  );
}

/** The list is Lody's saved associations, never the complete external inventory. */
export function MemoryAssociationList({
  entries,
  inventory,
  onEdit,
  onRemove,
  onSelect,
  selected,
  onAssociateRole,
  getAssignedRoles,
}: {
  onAssociateRole?: (entry: MemoryAssociation) => void;
  getAssignedRoles?: (entry: MemoryAssociation) => readonly AgentRole[];
  entries: MemoryAssociation[];
  inventory?: MemoryProviderResponse;
  onEdit?: (entry: MemoryAssociation) => void;
  onRemove?: (entry: MemoryAssociation) => void;
  onSelect?: (entry: MemoryAssociation) => void;
  selected?: MemoryBinding;
}) {
  const { t } = useTranslation();
  if (!entries.length)
    return <SettingsEmptyList>{t('settings.memory.emptyLinked')}</SettingsEmptyList>;
  return (
    <div {...stylex.props(settingsRecordsCard)}>
      {entries.map((entry, index) => {
        const assignedRoles = getAssignedRoles?.(entry) ?? [];
        const Main = onSelect ? 'button' : 'div';
        const missing = isMemoryIdentityMissing(entry, inventory);
        const linked =
          selected?.providerId === entry.providerId && selected.memoryId === entry.memoryId;
        return (
          <div
            key={`${entry.providerId}:${entry.memoryId}`}
            {...stylex.props(
              stylex.defaultMarker(),
              catalog.row,
              styles.record,
              surface.line,
              linked && surface.listRowSelected,
              index > 0 && surface.lineRuled
            )}
          >
            <Main
              type={onSelect ? 'button' : undefined}
              disabled={onSelect ? missing : undefined}
              onClick={onSelect ? () => onSelect(entry) : undefined}
              aria-pressed={onSelect ? linked : undefined}
              {...stylex.props(catalog.rowMain)}
            >
              <span {...stylex.props(styles.recordLogo)}>
                <MemoryProviderLogo providerId={entry.providerId} />
              </span>
              <div {...stylex.props(catalog.body)}>
                <div {...stylex.props(catalog.titleLine)}>
                  <span {...stylex.props(catalog.name)}>{entry.name}</span>
                </div>
                {entry.description ? (
                  <span {...stylex.props(styles.description)}>{entry.description}</span>
                ) : null}
                {missing ? (
                  <FormMessage tone="warning">{t('settings.memory.missing')}</FormMessage>
                ) : null}
              </div>
            </Main>
            {assignedRoles.length > 0 ? (
              <div {...stylex.props(styles.assignedRoles)}>
                <span {...stylex.props(catalog.meta, styles.assignedLabel)}>
                  {t('settings.memory.assignedRoles')}
                </span>
                {assignedRoles.map((role) => (
                  <MemoryRoleAvatar key={role.id} role={role} />
                ))}
              </div>
            ) : onAssociateRole ? (
              <Button
                type="button"
                size="small"
                variant="secondary"
                onClick={() => onAssociateRole(entry)}
              >
                {t('settings.memory.associateRole')}
              </Button>
            ) : null}
            <div {...stylex.props(catalog.actions, !onSelect && styles.actions)}>
              {onSelect ? (
                <Button
                  type="button"
                  size="small"
                  variant={linked ? 'secondary' : 'ghost'}
                  disabled={missing}
                  aria-pressed={linked}
                  onClick={() => onSelect(entry)}
                >
                  {linked ? <Check size={14} /> : null}
                  {t(linked ? 'settings.memory.linked' : 'settings.memory.link')}
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    size="small"
                    variant="ghost"
                    icon
                    aria-label={t('settings.memory.editName', { name: entry.name })}
                    onClick={() => onEdit?.(entry)}
                  >
                    <Pencil size={14} />
                  </Button>
                  <Button
                    type="button"
                    size="small"
                    variant="ghost"
                    icon
                    aria-label={t('settings.memory.deleteName', { name: entry.name })}
                    onClick={() => onRemove?.(entry)}
                  >
                    <Trash2 size={14} />
                  </Button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Multiple selection of provider identities in the Import tab. */
export function MemoryIdentityList({
  memories,
  linkedIds = [],
  selected = [],
  onSelect,
  disabled = false,
}: {
  memories: MemoryIdentity[];
  linkedIds?: string[];
  selected?: string[];
  onSelect?: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  if (!memories.length) return <SettingsEmptyList>{t('settings.memory.empty')}</SettingsEmptyList>;
  return (
    <div role="group" aria-label={t('settings.memory.identities')}>
      {memories.map((memory) => (
        <label
          key={memory.id}
          {...stylex.props(
            surface.listRow,
            selected.includes(memory.id) && surface.listRowSelected,
            styles.row,
            styles.note
          )}
        >
          <Checkbox
            checked={selected.includes(memory.id) && !linkedIds.includes(memory.id)}
            onCheckedChange={(checked) =>
              onSelect?.(
                checked ? [...selected, memory.id] : selected.filter((id) => id !== memory.id)
              )
            }
            aria-label={memory.name}
            disabled={disabled || linkedIds.includes(memory.id)}
          />
          <div {...stylex.props(catalog.body)}>
            <span {...stylex.props(catalog.name)}>
              {memory.name}
              {linkedIds.includes(memory.id) ? ` · ${t('settings.memory.imported')}` : null}
            </span>
            {memory.description ? (
              <span {...stylex.props(styles.description)}>{memory.description}</span>
            ) : null}
          </div>
        </label>
      ))}
    </div>
  );
}

export function MemorySetting() {
  const { t } = useTranslation();
  const { machines, accessByMachineId } = useVisibleMachineMetas();
  const localId = useAtomValue(localMachineIdAtom);
  const onlineIds = useOnlineMachineIds();
  const remote = useAppCapability('remoteMachines');
  const inPane = useInSettingsPane();
  const [selected, setSelected] = useState<MachineId | null>(null);
  const machineId = remote
    ? selected && machines.has(selected)
      ? selected
      : localId
        ? localId
        : (machines.keys().next().value ?? null)
    : localId;
  const pills = useMemo(
    () =>
      [...machines.values()]
        .map((machine) => ({
          id: machine.id,
          label: machine.name || machine.id,
          online: onlineIds.has(machine.id),
          private: !(accessByMachineId.get(machine.id)?.sharedWithTeam ?? false),
        }))
        .sort(
          (a, b) =>
            Number(b.id === localId) - Number(a.id === localId) ||
            Number(b.online) - Number(a.online) ||
            a.label.localeCompare(b.label)
        ),
    [machines, onlineIds, accessByMachineId, localId]
  );
  return (
    <div {...stylex.props(surface.container, styles.stack)}>
      <SettingsPageLead>{t('settings.memory.description')}</SettingsPageLead>
      {remote && !inPane ? (
        <MachinePills
          pills={pills}
          selectedId={machineId}
          onSelect={(id) => setSelected(id as MachineId)}
        />
      ) : null}
      {remote && inPane && pills.length > 1 ? (
        <SettingsLineTabs
          tabs={pills.map((pill) => ({
            ...pill,
            leading: (
              <span
                aria-hidden="true"
                {...stylex.props(styles.machineDot, pill.online && styles.machineDotOnline)}
              />
            ),
          }))}
          current={machineId ?? ''}
          onChange={(id) => setSelected(id as MachineId)}
          label={t('settings.agent.machineTabs.machine', 'Machine')}
        />
      ) : null}
      {machineId ? (
        <MachineMemories
          key={machineId}
          machineId={machineId}
          supported={machineSupportsMemoryProviders(machines.get(machineId))}
        />
      ) : (
        <p>{t('settings.memory.noMachine')}</p>
      )}
    </div>
  );
}

type Editor = { providerId: string; entry?: MemoryAssociation };
function MachineMemories({ machineId, supported }: { machineId: MachineId; supported: boolean }) {
  const { t } = useTranslation();
  const associations = useMemoryAssociations(machineId);
  const { roles, synced } = useWorkspaceAgentRoles();
  const { openSettings } = useOpenSettings();
  const getAssignedRoles = (entry: MemoryAssociation) =>
    roles.filter((role) => {
      const memory = getAgentRoleTarget(role, machineId)?.runConfig.memory;
      return memory?.providerId === entry.providerId && memory.memoryId === entry.memoryId;
    });

  const [editor, setEditor] = useState<Editor | null>(null);
  const [error, setError] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const online = useMachineOnlineStatus(machineId) === 'online';
  const providers: ProviderDefinition[] = [...MEMORY_PROVIDERS];
  for (const entry of associations.entries)
    if (!providers.some((p) => p.id === entry.providerId))
      providers.push({ id: entry.providerId, name: entry.providerId, createFields: [] });
  return (
    <>
      <SettingsPageActions>
        <Button
          type="button"
          size="small"
          variant="ghost"
          icon
          disabled={!online || !supported}
          aria-label={t('settings.memory.refresh')}
          onClick={() => setRefreshToken((value) => value + 1)}
        >
          <RefreshCw size={14} />
        </Button>
        <Button
          type="button"
          size="small"
          variant="secondary"
          onClick={() =>
            setEditor({
              providerId: (MEMORY_PROVIDERS.find((item) => !isAgentConnectProvider(item.id)) ??
                MEMORY_PROVIDERS[0])!.id,
            })
          }
        >
          <Plus size={14} />
          {t('settings.memory.add')}
        </Button>
      </SettingsPageActions>
      {error ? <FormMessage tone="error">{t('settings.memory.saveError')}</FormMessage> : null}
      {providers.map((provider) => (
        <ProviderRecords
          key={provider.id}
          machineId={machineId}
          provider={provider}
          refreshToken={refreshToken}
          getAssignedRoles={getAssignedRoles}
          onAssociateRole={synced ? () => openSettings('agent-roles', { machineId }) : undefined}
          supported={supported}
          entries={associations.entries.filter((entry) => entry.providerId === provider.id)}
          editor={editor?.providerId === provider.id ? editor : null}
          setEditor={setEditor}
          save={async (entry, edit) => {
            await (edit ? associations.edit : associations.link)(entry);
          }}
          remove={async (entry) => {
            setError(false);
            try {
              await associations.remove(entry);
            } catch {
              setError(true);
            }
          }}
        />
      ))}
    </>
  );
}

function ProviderRecords({
  machineId,
  provider,
  supported,
  refreshToken,
  entries,
  editor,
  setEditor,
  save,
  remove,
  getAssignedRoles,
  onAssociateRole,
}: {
  getAssignedRoles: (entry: MemoryAssociation) => readonly AgentRole[];
  onAssociateRole?: (entry: MemoryAssociation) => void;
  machineId: MachineId;
  provider: ProviderDefinition;
  supported: boolean;
  refreshToken: number;
  entries: MemoryAssociation[];
  editor: Editor | null;
  setEditor: (editor: Editor | null) => void;
  save: (entry: MemoryAssociation, edit: boolean) => Promise<void>;
  remove: (entry: MemoryAssociation) => Promise<void>;
}) {
  const { t } = useTranslation();
  const online = useMachineOnlineStatus(machineId) === 'online';
  const state = useMemoryProvider(machineId, provider.id, online && supported, refreshToken);
  // The panel lists this machine's own agents, so it reads Lody's configs
  // rather than the provider's catalogue. The subscription has to be mounted
  // for the rows to arrive; without it the atom stays empty.
  const machineIds = useMemo(() => [machineId], [machineId]);
  useMachineFlockAgentConfigsForMachineIds(machineIds);
  const agentConfigs = useAtomValue(getAgentConfigsByMachineAtomFamily(machineId));
  // A fetch the user asked for carries on into signing in: the button said it
  // would set the provider up, and stopping half-way would be a promise kept
  // only in part.
  const [justInstalled, setJustInstalled] = useState(false);
  const ready = online && supported && state.result?.status === 'ready';
  const missing = state.result?.status === 'not_installed';
  // One failed reply is not evidence the provider broke: the runner times out,
  // a machine drops mid-refresh. Once it has answered properly, keep showing
  // what it said rather than tearing the list down and offering a reinstall.
  const everAnswered = useRef(false);
  if (ready) everAnswered.current = true;
  // Installed and reachable, with nobody signed in — the one unready state a
  // provider can settle itself, so it offers a sign-in, not a line of advice.
  const signedOut =
    online && supported && state.result?.status === 'not_running' && providerSignsIn(provider.id);
  // Something is installed but will not answer. For a provider Lody can fetch
  // this is actionable rather than just bad news, so it gets the same card the
  // missing case gets — pointed at repair instead of first install.
  const unreadable =
    online &&
    supported &&
    state.result?.status === 'error' &&
    providerInstalls(provider.id) &&
    !everAnswered.current;
  return (
    <div {...stylex.props(styles.stack)}>
      {/* Each card below answers one unready state itself, naming the provider
          and saying what it is for, so a sentence here would only repeat it.
          Whatever none of them claims — installed but will not start, an error
          after a list was already working — still has to be said out loud, or
          the page simply goes quiet about it. */}
      {!online ||
      !supported ||
      (state.result && !ready && !missing && !signedOut && !unreadable) ? (
        <MemoryProviderStatus
          provider={provider}
          online={online}
          supported={supported}
          busy={false}
          result={state.result}
        />
      ) : null}
      {missing || unreadable ? (
        // Every provider that cannot be used yet gets the same card, so the
        // page presents them as two choices rather than one product and one
        // loose sentence. Only the action differs.
        <MemoryInstallCard
          logo={<MemoryProviderLogo providerId={provider.id} brandColor decorative />}
          name={provider.name}
          providerKey={provider.id}
          installUrl={provider.installUrl}
          reason={providerInstalls(provider.id) ? (missing ? 'missing' : 'unreadable') : undefined}
          onInstalled={() => setJustInstalled(true)}
          state={state}
        />
      ) : signedOut ? (
        <MemorySignInCard
          logo={<MemoryProviderLogo providerId={provider.id} brandColor decorative />}
          name={provider.name}
          providerKey={provider.id}
          autoStart={justInstalled}
          state={state}
        />
      ) : isAgentConnectProvider(provider.id) ? (
        <MemoryAgentConnectList
          logo={<MemoryProviderLogo providerId={provider.id} brandColor decorative />}
          name={provider.name}
          providerKey={provider.id}
          configs={agentConfigs}
          agents={state.result?.agents ?? []}
          state={state}
          disabled={!ready}
        />
      ) : entries.length ? (
        <MemoryAssociationList
          entries={entries}
          inventory={state.result}
          getAssignedRoles={getAssignedRoles}
          onAssociateRole={onAssociateRole}
          onEdit={(entry) => setEditor({ providerId: provider.id, entry })}
          onRemove={(entry) => void remove(entry)}
        />
      ) : ready ? (
        <p {...stylex.props(styles.emptyHint)}>{t('settings.memory.emptyLinked')}</p>
      ) : null}
      {editor && !isAgentConnectProvider(provider.id) ? (
        <MemoryEditor
          key={editor.entry?.memoryId ?? 'new'}
          machineId={machineId}
          provider={provider}
          entry={editor.entry}
          entries={entries}
          online={online}
          supported={supported}
          state={state}
          onProvider={(providerId) => setEditor({ providerId })}
          onClose={() => setEditor(null)}
          save={save}
        />
      ) : null}
    </div>
  );
}

export function MemoryProviderStatus({
  provider,
  online,
  supported,
  busy,
  result,
}: {
  provider: ProviderDefinition;
  online: boolean;
  supported: boolean;
  busy: boolean;
  result?: MemoryProviderResponse;
}) {
  const { t } = useTranslation();
  if (!online) return <span {...stylex.props(catalog.meta)}>{t('settings.memory.offline')}</span>;
  if (!supported)
    return <span {...stylex.props(catalog.meta)}>{t('settings.memory.unsupported')}</span>;
  if (busy) return <Spinner size="small" />;
  if (result?.status === 'ready') return null;
  return (
    <div {...stylex.props(styles.stack)}>
      <span {...stylex.props(catalog.meta)}>
        {/* Each provider names its own CLI, so fall back only when it has no copy. */}
        {t(
          [
            `settings.memory.status.${provider.id}.${result?.status ?? 'error'}`,
            `settings.memory.status.${result?.status ?? 'error'}`,
          ],
          { provider: provider.name }
        )}
      </span>
      {result?.status === 'not_installed' && provider.installUrl ? (
        // The one thing to do when a provider is missing, so it looks like a
        // control rather than the hover state a ghost button reads as.
        <span {...stylex.props(styles.installAction)}>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void openExternalUrl(provider.installUrl!)}
          >
            {t([`settings.memory.install.${provider.id}`, 'settings.memory.install'])}
          </Button>
        </span>
      ) : null}
    </div>
  );
}

export function MemoryEditor({
  machineId,
  provider,
  entry,
  entries,
  online,
  supported,
  state,
  onProvider,
  onClose,
  save,
}: {
  machineId: MachineId;
  provider: ProviderDefinition;
  entry?: MemoryAssociation;
  entries: MemoryAssociation[];
  online: boolean;
  supported: boolean;
  state: ReturnType<typeof useMemoryProvider>;
  onProvider: (id: string) => void;
  onClose: () => void;
  save: (entry: MemoryAssociation, edit: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState('create');
  const identity = entry
    ? state.result?.memories.find((memory) => memory.id === entry.memoryId)
    : undefined;
  const hydrated = useRef(false);
  const [values, setValues] = useState<Record<string, string>>({
    id: entry?.memoryId ?? '',
    role: identity?.role ?? '',
    name: identity?.name ?? entry?.name ?? '',
    description: identity?.description ?? entry?.description ?? '',
  });
  useEffect(() => {
    if (identity && !hydrated.current) {
      hydrated.current = true;
      setValues({
        id: identity.id,
        name: identity.name,
        description: identity.description ?? '',
        role: identity.role ?? '',
      });
    }
  }, [identity]);
  const [selected, setSelected] = useState<string[]>([]);
  const [idEdited, setIdEdited] = useState(false);
  const [created, setCreated] = useState<MemoryIdentity>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const busy = saving || state.busy;
  const available = online && supported && state.result?.status === 'ready';
  const candidates =
    state.result?.memories.filter(
      (memory) => !entries.some((saved) => saved.memoryId === memory.id)
    ) ?? [];
  const submit = async () => {
    if (busy || !available) return;
    setError(false);
    setSaving(true);
    try {
      const saveIdentity = (memory: MemoryIdentity) =>
        save(
          {
            machineId,
            providerId: provider.id,
            memoryId: memory.id,
            name: memory.name,
            description: memory.description,
          },
          !!entry
        );
      if (!entry && tab === 'link') {
        const pending = candidates.filter((memory) => selected.includes(memory.id));
        if (!pending.length) return;
        for (const memory of pending) {
          await saveIdentity(memory);
          setSelected((ids) => ids.filter((id) => id !== memory.id));
        }
        onClose();
        return;
      }
      let savedIdentity: MemoryIdentity | undefined;
      if (entry) {
        const result = await state.update(
          MemoryCreateInputSchema.parse({ ...values, id: entry.memoryId })
        );
        savedIdentity =
          result?.status === 'ready'
            ? result.memories.find((memory) => memory.id === entry.memoryId)
            : undefined;
      } else {
        savedIdentity = created;
        if (!savedIdentity) {
          const input = MemoryCreateInputSchema.parse(values);
          const result = await state.create(input);
          savedIdentity =
            result?.status === 'ready'
              ? result.memories.find((memory) => memory.id === input.id)
              : undefined;
          if (savedIdentity) setCreated(savedIdentity);
        }
      }
      if (!savedIdentity) throw new Error('Memory identity unavailable');
      await saveIdentity(savedIdentity);
      onClose();
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <Dialog.Content
        style={{
          width: 'min(900px, 96dvw)',
          maxWidth: 'none',
          height: 'min(600px, 92dvh)',
          padding: 0,
          gap: 0,
          overflow: 'hidden',
        }}
      >
        <div {...stylex.props(styles.layout)}>
          <aside {...stylex.props(styles.rail)} aria-label={t('settings.memory.providers')}>
            <span {...stylex.props(catalog.meta, styles.railTitle)}>
              {t('settings.memory.providers')}
            </span>
            <div role="listbox" aria-label={t('settings.memory.providers')}>
              {/* Agent-connect providers hold one memory per account, so this
                  editor has nothing to create for them. Offering them here
                  selected a provider the editor then refuses to render,
                  leaving an empty dialog. */}
              {MEMORY_PROVIDERS.filter((item) => !isAgentConnectProvider(item.id)).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={item.id === provider.id}
                  disabled={busy || (!!entry && item.id !== provider.id)}
                  onClick={() => onProvider(item.id)}
                  {...stylex.props(
                    surface.listRow,
                    item.id === provider.id && surface.listRowSelected,
                    styles.railItem
                  )}
                >
                  <span {...stylex.props(styles.railIcon)}>
                    <MemoryProviderLogo providerId={item.id} />
                  </span>
                  <span {...stylex.props(surface.listRowLabel)}>{item.name}</span>
                </button>
              ))}
            </div>
          </aside>
          <section {...stylex.props(styles.detail)}>
            <Dialog.Header>
              <Dialog.Title>
                {t(entry ? 'settings.memory.edit' : 'settings.memory.add')}
              </Dialog.Title>
              <Dialog.Description>
                {t(entry ? 'settings.memory.editHint' : 'settings.memory.editorHint')}
              </Dialog.Description>
            </Dialog.Header>
            {!entry ? (
              <Tabs.Root
                value={tab}
                onValueChange={(value) => {
                  setTab(String(value));
                  setError(false);
                }}
              >
                <Tabs.List>
                  <Tabs.Tab value="create" disabled={busy}>
                    {t('settings.memory.createTab')}
                  </Tabs.Tab>
                  <Tabs.Tab value="link" disabled={busy}>
                    {t('settings.memory.linkTab')}
                  </Tabs.Tab>
                </Tabs.List>
              </Tabs.Root>
            ) : null}
            <form
              {...stylex.props(styles.form)}
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <div {...stylex.props(styles.scroll)}>
                {!entry || !available ? (
                  <MemoryProviderStatus
                    provider={provider}
                    online={online}
                    supported={supported}
                    busy={state.busy}
                    result={state.result}
                  />
                ) : null}
                {entry || (available && tab === 'create') ? (
                  <div {...stylex.props(styles.fields)}>
                    {provider.createFields.map((key) => (
                      <div
                        key={key}
                        {...stylex.props(key !== 'name' && key !== 'id' && styles.fullField)}
                      >
                        <Field
                          label={t(
                            key === 'name'
                              ? 'settings.memory.name'
                              : `settings.memory.fields.${key}`
                          )}
                        >
                          {key === 'description' ? (
                            <Textarea
                              aria-label={t(`settings.memory.fields.${key}`)}
                              value={values[key] ?? ''}
                              disabled={saving || !!created || (!!entry && !identity)}
                              onChange={(event) =>
                                setValues({ ...values, [key]: event.target.value })
                              }
                            />
                          ) : (
                            <Input
                              aria-label={t(
                                key === 'name'
                                  ? 'settings.memory.name'
                                  : `settings.memory.fields.${key}`
                              )}
                              required={key === 'id' || key === 'name'}
                              readOnly={!!entry && key === 'id'}
                              value={values[key] ?? ''}
                              disabled={saving || !!created || (!!entry && !identity)}
                              onChange={(event) => {
                                const value = event.target.value;
                                if (key === 'id') setIdEdited(value !== '');
                                setValues((previous) => ({
                                  ...previous,
                                  [key]: value,
                                  ...(key === 'name' && !idEdited && !entry
                                    ? { id: value.toLowerCase() }
                                    : {}),
                                }));
                              }}
                            />
                          )}
                        </Field>
                      </div>
                    ))}
                  </div>
                ) : null}
                {!entry && available && tab === 'link' ? (
                  <MemoryIdentityList
                    memories={state.result?.memories ?? []}
                    linkedIds={entries.map((saved) => saved.memoryId)}
                    selected={selected}
                    onSelect={setSelected}
                    disabled={busy}
                  />
                ) : null}
                {error ? (
                  <FormMessage tone="error">
                    {t(created ? 'settings.memory.createdSaveError' : 'settings.memory.saveError')}
                  </FormMessage>
                ) : null}
              </div>
              <Dialog.Footer>
                <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
                  {t('common.cancel')}
                </Button>
                <Button
                  type="submit"
                  disabled={
                    busy ||
                    (!!entry && (!available || !identity)) ||
                    (!entry &&
                      (!available ||
                        (tab === 'link' &&
                          !candidates.some((memory) => selected.includes(memory.id)))))
                  }
                >
                  {saving ? <Spinner size="small" /> : null}
                  {t(
                    entry
                      ? 'common.save'
                      : tab === 'create' && !created
                        ? 'settings.memory.createAndLink'
                        : 'settings.memory.import'
                  )}
                </Button>
              </Dialog.Footer>
            </form>
          </section>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}

export function RoleMemoryPicker({
  machineId,
  value,
  onChange,
}: {
  machineId: MachineId;
  value?: MemoryBinding;
  onChange: (value?: MemoryBinding) => void;
}) {
  const { t } = useTranslation();
  const { entries } = useMemoryAssociations(machineId);
  const { machines } = useVisibleMachineMetas();
  const supported = machineSupportsMemoryProviders(machines.get(machineId));
  return (
    <div {...stylex.props(styles.stack)}>
      <span {...stylex.props(catalog.meta)}>{t('settings.memory.rolePromptHint')}</span>
      {value ? (
        <div {...stylex.props(styles.unlinkRow)}>
          <Button type="button" size="small" variant="ghost" onClick={() => onChange(undefined)}>
            {t('settings.memory.unlink')}
          </Button>
        </div>
      ) : null}
      {!entries.length ? (
        <p {...stylex.props(catalog.meta)}>{t('settings.memory.emptyRole')}</p>
      ) : (
        MEMORY_PROVIDERS.filter((provider) => !isAgentConnectProvider(provider.id)).map(
          (provider) => (
            <RoleProviderMemories
              key={provider.id}
              machineId={machineId}
              provider={provider}
              entries={entries.filter((entry) => entry.providerId === provider.id)}
              supported={supported}
              value={value}
              onChange={onChange}
            />
          )
        )
      )}
    </div>
  );
}
function RoleProviderMemories({
  machineId,
  provider,
  entries,
  supported,
  value,
  onChange,
}: {
  machineId: MachineId;
  provider: ProviderDefinition;
  entries: MemoryAssociation[];
  supported: boolean;
  value?: MemoryBinding;
  onChange: (value: MemoryBinding) => void;
}) {
  const online = useMachineOnlineStatus(machineId) === 'online';
  const state = useMemoryProvider(machineId, provider.id, online && supported);
  return (
    <>
      {!online || !supported || (state.result && state.result.status !== 'ready') ? (
        <MemoryProviderStatus
          provider={provider}
          online={online}
          supported={supported}
          busy={false}
          result={state.result}
        />
      ) : null}
      <MemoryAssociationList
        entries={entries}
        inventory={state.result}
        selected={value}
        onSelect={(entry) => onChange({ providerId: entry.providerId, memoryId: entry.memoryId })}
      />
    </>
  );
}
