import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';
import { agentService } from '@/services/agent';
import { useAgentStore } from '@/store/agent';
import { useToolStore } from '@/store/tool';
import { ComposioServerStatus } from '@/store/tool/slices/composioStore';

import {
  createBrowserContextFactProviders,
  resolveBrowserConnectorFeatures,
} from './contextFactProviders';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { market: { creds: { listForContext: { query: vi.fn() } } } },
}));

vi.mock('@/services/agent', () => ({
  agentService: { queryAgents: vi.fn() },
}));

beforeEach(() => {
  useAgentStore.setState({ agentDocumentsMap: {}, availableAgents: undefined } as any);
  useToolStore.setState({
    composioServers: [],
    installedPlugins: [],
    lobehubSkillServers: [],
  } as any);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('createBrowserContextFactProviders', () => {
  it('reports no connector features when the server config store is not mounted', () => {
    expect(resolveBrowserConnectorFeatures()).toEqual({ composio: false, lobehubSkill: false });
  });

  it('reuses the prefetched agent list and only queries when it is missing', async () => {
    const providers = createBrowserContextFactProviders();
    vi.mocked(agentService.queryAgents).mockResolvedValue([{ id: 'agent-2' }] as any);

    useAgentStore.setState({ availableAgents: [{ id: 'agent-1' }] } as any);
    await expect(providers.listRecentAgents!(12)).resolves.toEqual([{ id: 'agent-1' }]);
    expect(agentService.queryAgents).not.toHaveBeenCalled();

    useAgentStore.setState({ availableAgents: undefined } as any);
    await expect(providers.listRecentAgents!(12)).resolves.toEqual([{ id: 'agent-2' }]);
    expect(agentService.queryAgents).toHaveBeenCalledWith({ limit: 12 });
  });

  it('treats only active Composio connections and every installed LobeHub skill provider as connected', async () => {
    useToolStore.setState({
      composioServers: [
        { identifier: 'gmail', status: ComposioServerStatus.ACTIVE },
        { identifier: 'slack', status: ComposioServerStatus.PENDING_AUTH },
      ],
      lobehubSkillServers: [{ identifier: 'linear', isConnected: false }],
    } as any);

    const connected = await createBrowserContextFactProviders().listConnectedConnectorIds!();

    expect(new Set(connected)).toEqual(new Set(['gmail', 'linear']));
  });

  it('answers agent documents from the store cache first', async () => {
    useAgentStore.setState({
      agentDocumentsMap: { 'agent-1': [{ content: 'cached', id: 'doc-1' }] },
    } as any);

    await expect(
      createBrowserContextFactProviders().listAgentDocuments!('agent-1'),
    ).resolves.toEqual([{ content: 'cached', id: 'doc-1' }]);
  });

  it('hydrates agent documents through the store when the cache is empty', async () => {
    const { agentDocumentService } = await import('@/services/agentDocument');
    const getContextDocuments = vi
      .spyOn(agentDocumentService, 'getContextDocuments')
      .mockResolvedValue([
        {
          content: 'Project setup steps',
          filename: 'setup.md',
          id: 'doc-1',
          loadRules: [],
          policy: null,
          policyLoadFormat: null,
          policyLoadPosition: null,
          templateId: null,
          title: 'Setup',
        },
      ] as any);

    const documents = await createBrowserContextFactProviders().listAgentDocuments!('agent-1');

    expect(getContextDocuments).toHaveBeenCalledWith({ agentId: 'agent-1' });
    expect(documents).toEqual([
      expect.objectContaining({
        content: 'Project setup steps',
        filename: 'setup.md',
        id: 'doc-1',
      }),
    ]);
  });

  it('lets the server scope the credential list to the verified workspace', async () => {
    vi.mocked(lambdaClient.market.creds.listForContext.query).mockResolvedValue({
      data: [{ key: 'ORG_SECRET', name: 'Org', ownerType: 'organization', type: 'kv-env' }],
    } as any);

    const creds = await createBrowserContextFactProviders().listCredentials!({
      workspaceId: 'ws-1',
    });

    expect(creds?.map((c) => c.key)).toEqual(['ORG_SECRET']);
  });

  it('scopes referenced-topic reads to the executing agent and group', async () => {
    const { messageService } = await import('@/services/message');
    const getMessages = vi
      .spyOn(messageService, 'getMessages')
      .mockResolvedValue([{ content: 'hi', role: 'user' }] as any);

    const messages = await createBrowserContextFactProviders({
      agentId: 'agent-1',
      groupId: 'group-1',
    }).listTopicMessages!({ id: 'tpc_1' });

    expect(getMessages).toHaveBeenCalledWith({
      agentId: 'agent-1',
      groupId: 'group-1',
      topicId: 'tpc_1',
    });
    expect(messages).toEqual([{ content: 'hi', role: 'user' }]);
  });
});
