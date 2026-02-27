/**
 * Environment adapter — creates K8sAdapter from in-cluster config or kubeconfig.
 *
 * Required env vars (in-cluster):
 *   K8S_IN_CLUSTER=true  — use service account token (default when deployed on k3s)
 *
 * Optional env vars (out-of-cluster / local dev):
 *   KUBECONFIG           — path to kubeconfig file
 *   K8S_IN_CLUSTER=false — use kubeconfig instead of in-cluster
 *
 * CRD-backed resources (Traefik IngressRoutes, ArgoCD Applications,
 * KEDA ScaledObjects, Longhorn Volumes) are fetched via the custom objects API.
 * Missing CRDs return empty arrays gracefully.
 */
import type { K8sAdapter } from '../types.js';
export declare function createAdapterFromEnv(): K8sAdapter;
//# sourceMappingURL=env.d.ts.map