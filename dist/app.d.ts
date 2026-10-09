/**
 * @git-fabric/k8s — FabricApp factory
 *
 * 26 tools covering:
 *   Cluster info, namespaces, pods, deployments, services, nodes,
 *   events, PVCs, CronJobs, Jobs, Traefik IngressRoutes,
 *   ArgoCD Applications, KEDA ScaledObjects, Longhorn Volumes.
 */
import type { K8sAdapter } from './types.js';
interface FabricTool {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations?: {
        readOnlyHint?: boolean;
        destructiveHint?: boolean;
        idempotentHint?: boolean;
        openWorldHint?: boolean;
    };
    execute: (args: Record<string, unknown>) => Promise<unknown>;
}
interface FabricApp {
    name: string;
    version: string;
    description: string;
    tools: FabricTool[];
    health: () => Promise<{
        app: string;
        status: 'healthy' | 'degraded' | 'unavailable';
        latencyMs?: number;
        details?: Record<string, unknown>;
    }>;
}
export declare function createApp(adapterOverride?: K8sAdapter): FabricApp;
export {};
//# sourceMappingURL=app.d.ts.map