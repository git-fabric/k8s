/**
 * @git-fabric/k8s — FabricApp factory
 *
 * 26 tools covering:
 *   Cluster info, namespaces, pods, deployments, services, nodes,
 *   events, PVCs, CronJobs, Jobs, Traefik IngressRoutes,
 *   ArgoCD Applications, KEDA ScaledObjects, Longhorn Volumes.
 */
import { createAdapterFromEnv } from './adapters/env.js';
export function createApp(adapterOverride) {
    const k8s = adapterOverride ?? createAdapterFromEnv();
    const tools = [
        // ── Cluster ───────────────────────────────────────────────────────────────
        {
            name: 'k8s_cluster_info',
            description: 'Get cluster info: server version, node count, namespace count, pod count.',
            inputSchema: { type: 'object', properties: {} },
            execute: async () => k8s.getClusterInfo(),
        },
        // ── Namespaces ────────────────────────────────────────────────────────────
        {
            name: 'k8s_list_namespaces',
            description: 'List all namespaces in the cluster.',
            inputSchema: { type: 'object', properties: {} },
            execute: async () => k8s.listNamespaces(),
        },
        // ── Pods ──────────────────────────────────────────────────────────────────
        {
            name: 'k8s_list_pods',
            description: 'List pods, optionally filtered by namespace.',
            inputSchema: {
                type: 'object',
                properties: {
                    namespace: { type: 'string', description: 'Filter by namespace. Omit for all namespaces.' },
                },
            },
            execute: async (a) => k8s.listPods(a.namespace),
        },
        {
            name: 'k8s_get_pod',
            description: 'Get full details for a pod: containers, conditions, and recent events.',
            inputSchema: {
                type: 'object',
                properties: {
                    namespace: { type: 'string' },
                    name: { type: 'string' },
                },
                required: ['namespace', 'name'],
            },
            execute: async (a) => k8s.getPod(a.namespace, a.name),
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
                    tailLines: { type: 'number', description: 'Lines from the end. Default: 100.' },
                    sinceSeconds: { type: 'number', description: 'Logs from the last N seconds.' },
                    previous: { type: 'boolean', description: 'Logs from previous container instance.' },
                },
                required: ['namespace', 'name'],
            },
            execute: async (a) => ({
                logs: await k8s.getPodLogs(a.namespace, a.name, {
                    container: a.container,
                    tailLines: a.tailLines,
                    sinceSeconds: a.sinceSeconds,
                    previous: a.previous,
                }),
            }),
        },
        {
            name: 'k8s_pod_problems',
            description: 'List pods that are failing, crashing, or not ready.',
            inputSchema: {
                type: 'object',
                properties: {
                    namespace: { type: 'string', description: 'Filter by namespace. Omit for all namespaces.' },
                },
            },
            execute: async (a) => k8s.getPodProblems(a.namespace),
        },
        // ── Deployments ───────────────────────────────────────────────────────────
        {
            name: 'k8s_list_deployments',
            description: 'List deployments, optionally filtered by namespace.',
            inputSchema: {
                type: 'object',
                properties: { namespace: { type: 'string' } },
            },
            execute: async (a) => k8s.listDeployments(a.namespace),
        },
        {
            name: 'k8s_get_deployment',
            description: 'Get full details for a deployment: image, strategy, conditions.',
            inputSchema: {
                type: 'object',
                properties: {
                    namespace: { type: 'string' },
                    name: { type: 'string' },
                },
                required: ['namespace', 'name'],
            },
            execute: async (a) => k8s.getDeployment(a.namespace, a.name),
        },
        // ── Services ──────────────────────────────────────────────────────────────
        {
            name: 'k8s_list_services',
            description: 'List services, optionally filtered by namespace.',
            inputSchema: {
                type: 'object',
                properties: { namespace: { type: 'string' } },
            },
            execute: async (a) => k8s.listServices(a.namespace),
        },
        // ── Nodes ─────────────────────────────────────────────────────────────────
        {
            name: 'k8s_list_nodes',
            description: 'List all nodes with status, roles, and version.',
            inputSchema: { type: 'object', properties: {} },
            execute: async () => k8s.listNodes(),
        },
        {
            name: 'k8s_get_node',
            description: 'Get full details for a node: capacity, allocatable resources, taints, conditions.',
            inputSchema: {
                type: 'object',
                properties: { name: { type: 'string' } },
                required: ['name'],
            },
            execute: async (a) => k8s.getNode(a.name),
        },
        // ── Events ────────────────────────────────────────────────────────────────
        {
            name: 'k8s_list_events',
            description: 'List recent cluster events, optionally filtered by namespace. Warning events surface failures and scheduling issues.',
            inputSchema: {
                type: 'object',
                properties: {
                    namespace: { type: 'string', description: 'Filter by namespace. Omit for all namespaces.' },
                    limit: { type: 'number', description: 'Max events to return. Default: 50.' },
                },
            },
            execute: async (a) => k8s.listEvents(a.namespace, a.limit),
        },
        // ── PVCs ──────────────────────────────────────────────────────────────────
        {
            name: 'k8s_list_pvcs',
            description: 'List PersistentVolumeClaims with status, capacity, and storage class.',
            inputSchema: {
                type: 'object',
                properties: {
                    namespace: { type: 'string', description: 'Filter by namespace. Omit for all namespaces.' },
                },
            },
            execute: async (a) => k8s.listPVCs(a.namespace),
        },
        // ── CronJobs & Jobs ───────────────────────────────────────────────────────
        {
            name: 'k8s_list_cronjobs',
            description: 'List CronJobs with schedule, suspend status, and last schedule time.',
            inputSchema: {
                type: 'object',
                properties: {
                    namespace: { type: 'string', description: 'Filter by namespace. Omit for all namespaces.' },
                },
            },
            execute: async (a) => k8s.listCronJobs(a.namespace),
        },
        {
            name: 'k8s_list_jobs',
            description: 'List Jobs with completion status and duration.',
            inputSchema: {
                type: 'object',
                properties: {
                    namespace: { type: 'string', description: 'Filter by namespace. Omit for all namespaces.' },
                },
            },
            execute: async (a) => k8s.listJobs(a.namespace),
        },
        // ── IngressRoutes (Traefik) ───────────────────────────────────────────────
        {
            name: 'k8s_list_ingress_routes',
            description: 'List Traefik IngressRoutes with entry points and routing rules.',
            inputSchema: {
                type: 'object',
                properties: {
                    namespace: { type: 'string', description: 'Filter by namespace. Omit for all namespaces.' },
                },
            },
            execute: async (a) => k8s.listIngressRoutes(a.namespace),
        },
        // ── ArgoCD ────────────────────────────────────────────────────────────────
        {
            name: 'k8s_list_argocd_apps',
            description: 'List all ArgoCD Applications with sync and health status.',
            inputSchema: { type: 'object', properties: {} },
            execute: async () => k8s.listArgoCDApps(),
        },
        {
            name: 'k8s_get_argocd_app',
            description: 'Get full ArgoCD Application details: resources, conditions, and deploy history.',
            inputSchema: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'ArgoCD Application name.' },
                },
                required: ['name'],
            },
            execute: async (a) => k8s.getArgoCDApp(a.name),
        },
        // ── KEDA ──────────────────────────────────────────────────────────────────
        {
            name: 'k8s_list_scaled_objects',
            description: 'List KEDA ScaledObjects with target, replica bounds, and trigger types.',
            inputSchema: {
                type: 'object',
                properties: {
                    namespace: { type: 'string', description: 'Filter by namespace. Omit for all namespaces.' },
                },
            },
            execute: async (a) => k8s.listScaledObjects(a.namespace),
        },
        // ── Longhorn ──────────────────────────────────────────────────────────────
        {
            name: 'k8s_list_longhorn_volumes',
            description: 'List Longhorn volumes with state, robustness, replica count, and bound PVC.',
            inputSchema: { type: 'object', properties: {} },
            execute: async () => k8s.listLonghornVolumes(),
        },
    ];
    return {
        name: '@git-fabric/k8s',
        version: '0.2.0',
        description: 'Kubernetes fabric app — cluster, pods, deployments, services, nodes, events, PVCs, CronJobs, IngressRoutes, ArgoCD, KEDA, Longhorn',
        tools,
        async health() {
            const start = Date.now();
            try {
                await k8s.getClusterInfo();
                return { app: '@git-fabric/k8s', status: 'healthy', latencyMs: Date.now() - start };
            }
            catch (e) {
                return { app: '@git-fabric/k8s', status: 'unavailable', latencyMs: Date.now() - start, details: { error: String(e) } };
            }
        },
    };
}
//# sourceMappingURL=app.js.map