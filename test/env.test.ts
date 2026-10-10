import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAdapterFromEnv } from '../src/adapters/env.js';

const apiMocks = vi.hoisted(() => ({
  listNamespace: vi.fn(),
  readNamespacedPodLog: vi.fn(),
}));

vi.mock('@kubernetes/client-node', () => {
  class CoreV1Api {}
  class AppsV1Api {}
  class BatchV1Api {}
  class VersionApi {}
  class CustomObjectsApi {}

  class KubeConfig {
    loadFromCluster() {}
    loadFromDefault() {}

    makeApiClient(api: unknown) {
      return api === CoreV1Api ? apiMocks : {};
    }
  }

  return { KubeConfig, CoreV1Api, AppsV1Api, BatchV1Api, VersionApi, CustomObjectsApi };
});

describe('createAdapterFromEnv', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses named parameters and returns API resources directly', async () => {
    apiMocks.listNamespace.mockResolvedValue({
      items: [{ metadata: { name: 'default' }, status: { phase: 'Active' } }],
    });

    const adapter = createAdapterFromEnv();

    await expect(adapter.listNamespaces()).resolves.toEqual([
      { name: 'default', status: 'Active', age: 'unknown' },
    ]);
    expect(apiMocks.listNamespace).toHaveBeenCalledWith({});
  });

  it('passes pod log options using named parameters', async () => {
    apiMocks.readNamespacedPodLog.mockResolvedValue('pod logs');

    const adapter = createAdapterFromEnv();

    await expect(adapter.getPodLogs('default', 'pod', {
      container: 'app',
      previous: true,
      sinceSeconds: 60,
      tailLines: 25,
    })).resolves.toBe('pod logs');
    expect(apiMocks.readNamespacedPodLog).toHaveBeenCalledWith({
      name: 'pod',
      namespace: 'default',
      container: 'app',
      previous: true,
      sinceSeconds: 60,
      tailLines: 25,
      timestamps: true,
    });
  });
});
