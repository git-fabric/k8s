/**
 * @git-fabric/k8s — FabricApp factory
 *
 * 11 tools covering Kubernetes cluster operations.
 */

import { createAdapterFromEnv } from './adapters/env.js';
import type { K8sAdapter } from './types.js';

interface FabricTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

interface FabricApp {
  name: string;
  version: string;
  description: string;
  tools: FabricTool[];
  health: () => Promise<{ app: string; status: 'healthy' | 'degraded' | 'unavailable'; latencyMs?: number; details?: Record<string, unknown> }>;
}

export function createApp(adapterOverride?: K8sAdapter): FabricApp {
  const k8s = adapterOverride ?? createAdapterFromEnv();

  const tools: FabricTool[] = [
    {
      name: 'k8s_cluster_info',
      description: 'Get Kubernetes cluster information: server version, node count, namespace count, pod count.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => k8s.getClusterInfo(),
    },
    {
      name: 'k8s_list_namespaces',
      description: 'List all namespaces in the cluster.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => k8s.listNamespaces(),
    },
    {
      name: 'k8s_list_pods',
      description: 'List pods, optionally filtered by namespace.',
      inputSchema: {
        type: 'object',
        properties: {
          namespace: { type: 'string', description: 'Filter by namespace. Omit for all namespaces.' },
        },
      },
      execute: async (args) => k8s.listPods(args.namespace as string | undefined),
    },
    {
      name: 'k8s_get_pod',
      description: 'Get full details for a pod including containers, conditions, and recent events.',
      inputSchema: {
        type: 'object',
        properties: {
          namespace: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['namespace', 'name'],
      },
      execute: async (args) => k8s.getPod(args.namespace as string, args.name as string),
    },
    {
      name: 'k8s_get_pod_logs',
      description: 'Get logs from a pod container.',
      inputSchema: {
        type: 'object',
        properties: {
          namespace: { type: 'string' },
          name: { type: 'string' },
          container: { type: 'string', description: 'Container name (required for multi-container pods).' },
          tailLines: { type: 'number', description: 'Number of lines from the end. Default: 100.' },
          sinceSeconds: { type: 'number', description: 'Return logs from the last N seconds.' },
          previous: { type: 'boolean', description: 'Return logs from previous container instance.' },
        },
        required: ['namespace', 'name'],
      },
      execute: async (args) => ({
        logs: await k8s.getPodLogs(args.namespace as string, args.name as string, {
          container: args.container as string | undefined,
          tailLines: args.tailLines as number | undefined,
          sinceSeconds: args.sinceSeconds as number | undefined,
          previous: args.previous as boolean | undefined,
        }),
      }),
    },
    {
      name: 'k8s_pod_problems',
      description: 'List pods that are failing, crashing, or not ready — across all or a single namespace.',
      inputSchema: {
        type: 'object',
        properties: {
          namespace: { type: 'string', description: 'Filter by namespace. Omit for all namespaces.' },
        },
      },
      execute: async (args) => k8s.getPodProblems(args.namespace as string | undefined),
    },
    {
      name: 'k8s_list_deployments',
      description: 'List deployments, optionally filtered by namespace.',
      inputSchema: {
        type: 'object',
        properties: {
          namespace: { type: 'string' },
        },
      },
      execute: async (args) => k8s.listDeployments(args.namespace as string | undefined),
    },
    {
      name: 'k8s_get_deployment',
      description: 'Get full details for a deployment including image, strategy, and conditions.',
      inputSchema: {
        type: 'object',
        properties: {
          namespace: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['namespace', 'name'],
      },
      execute: async (args) => k8s.getDeployment(args.namespace as string, args.name as string),
    },
    {
      name: 'k8s_list_services',
      description: 'List services, optionally filtered by namespace.',
      inputSchema: {
        type: 'object',
        properties: {
          namespace: { type: 'string' },
        },
      },
      execute: async (args) => k8s.listServices(args.namespace as string | undefined),
    },
    {
      name: 'k8s_list_nodes',
      description: 'List all nodes in the cluster with status, roles, and version.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => k8s.listNodes(),
    },
    {
      name: 'k8s_get_node',
      description: 'Get full details for a node including capacity, allocatable resources, taints, and conditions.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Node name.' },
        },
        required: ['name'],
      },
      execute: async (args) => k8s.getNode(args.name as string),
    },
  ];

  return {
    name: '@git-fabric/k8s',
    version: '0.1.0',
    description: 'Kubernetes operations fabric app — cluster, pods, deployments, services, and logs',
    tools,
    async health() {
      const start = Date.now();
      try {
        await k8s.getClusterInfo();
        return { app: '@git-fabric/k8s', status: 'healthy', latencyMs: Date.now() - start };
      } catch (e: unknown) {
        return { app: '@git-fabric/k8s', status: 'unavailable', latencyMs: Date.now() - start, details: { error: String(e) } };
      }
    },
  };
}
