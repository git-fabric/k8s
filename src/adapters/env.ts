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

import * as k8s from '@kubernetes/client-node';
import type {
  K8sAdapter, ClusterInfo, NamespaceSummary, PodSummary, PodDetail,
  ContainerStatus, PodEvent, LogOpts, PodProblem, DeploymentSummary,
  DeploymentDetail, ServiceSummary, NodeSummary, NodeDetail,
  EventSummary, PVCSummary, CronJobSummary, JobSummary,
  IngressRouteSummary, ArgoCDAppSummary, ArgoCDAppDetail,
  ScaledObjectSummary, LonghornVolumeSummary,
} from '../types.js';

function age(date: Date | string | undefined): string {
  if (!date) return 'unknown';
  const ms = Date.now() - new Date(date).getTime();
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return `${d}d${h}h`;
  if (h > 0) return `${h}h${m}m`;
  return `${m}m`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function listCustomObjects(customApi: k8s.CustomObjectsApi, group: string, version: string, plural: string, namespace?: string): Promise<any[]> {
  try {
    const res = namespace
      ? await customApi.listNamespacedCustomObject(group, version, namespace, plural)
      : await customApi.listClusterCustomObject(group, version, plural);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (res.body as any).items ?? [];
  } catch {
    return [];
  }
}

export function createAdapterFromEnv(): K8sAdapter {
  const kc = new k8s.KubeConfig();
  const inCluster = process.env.K8S_IN_CLUSTER !== 'false';
  if (inCluster) {
    kc.loadFromCluster();
  } else {
    kc.loadFromDefault();
  }

  const coreV1    = kc.makeApiClient(k8s.CoreV1Api);
  const appsV1    = kc.makeApiClient(k8s.AppsV1Api);
  const batchV1   = kc.makeApiClient(k8s.BatchV1Api);
  const versionApi = kc.makeApiClient(k8s.VersionApi);
  const customApi = kc.makeApiClient(k8s.CustomObjectsApi);

  return {
    // ── Cluster ──────────────────────────────────────────────────────────────

    async getClusterInfo(): Promise<ClusterInfo> {
      const [versionRes, nodesRes, namespacesRes, podsRes] = await Promise.all([
        versionApi.getCode(),
        coreV1.listNode(),
        coreV1.listNamespace(),
        coreV1.listPodForAllNamespaces(),
      ]);
      return {
        serverVersion: `${versionRes.body.major}.${versionRes.body.minor}`,
        platform: versionRes.body.platform ?? 'unknown',
        nodeCount: nodesRes.body.items.length,
        namespaceCount: namespacesRes.body.items.length,
        podCount: podsRes.body.items.length,
      };
    },

    // ── Namespaces ────────────────────────────────────────────────────────────

    async listNamespaces(): Promise<NamespaceSummary[]> {
      const { body } = await coreV1.listNamespace();
      return body.items.map((ns) => ({
        name: ns.metadata?.name ?? '',
        status: ns.status?.phase ?? 'Unknown',
        age: age(ns.metadata?.creationTimestamp),
      }));
    },

    // ── Pods ──────────────────────────────────────────────────────────────────

    async listPods(namespace?: string): Promise<PodSummary[]> {
      const { body } = namespace
        ? await coreV1.listNamespacedPod(namespace)
        : await coreV1.listPodForAllNamespaces();
      return body.items.map((pod) => {
        const cs = pod.status?.containerStatuses ?? [];
        const ready = cs.filter((c) => c.ready).length;
        const restarts = cs.reduce((sum, c) => sum + (c.restartCount ?? 0), 0);
        return {
          namespace: pod.metadata?.namespace ?? '',
          name: pod.metadata?.name ?? '',
          status: pod.status?.phase ?? 'Unknown',
          ready: `${ready}/${cs.length}`,
          restarts,
          age: age(pod.metadata?.creationTimestamp),
          node: pod.spec?.nodeName,
        };
      });
    },

    async getPod(namespace: string, name: string): Promise<PodDetail> {
      const [podRes, eventsRes] = await Promise.all([
        coreV1.readNamespacedPod(name, namespace),
        coreV1.listNamespacedEvent(namespace, undefined, undefined, undefined, `involvedObject.name=${name}`),
      ]);
      const pod = podRes.body;
      const cs = pod.status?.containerStatuses ?? [];
      const ready = cs.filter((c) => c.ready).length;
      const restarts = cs.reduce((sum, c) => sum + (c.restartCount ?? 0), 0);

      const containers: ContainerStatus[] = cs.map((c) => {
        let state = 'unknown';
        let reason: string | undefined;
        if (c.state?.running) state = 'running';
        else if (c.state?.waiting) { state = 'waiting'; reason = c.state.waiting.reason; }
        else if (c.state?.terminated) { state = 'terminated'; reason = c.state.terminated.reason; }
        return { name: c.name, image: c.image, ready: c.ready, restarts: c.restartCount ?? 0, state, reason };
      });

      const events: PodEvent[] = eventsRes.body.items
        .sort((a, b) => new Date(b.lastTimestamp ?? 0).getTime() - new Date(a.lastTimestamp ?? 0).getTime())
        .slice(0, 10)
        .map((e) => ({
          type: e.type ?? '',
          reason: e.reason ?? '',
          message: e.message ?? '',
          count: e.count ?? 1,
          lastSeen: age(e.lastTimestamp ?? undefined),
        }));

      return {
        namespace, name,
        status: pod.status?.phase ?? 'Unknown',
        ready: `${ready}/${cs.length}`,
        restarts,
        age: age(pod.metadata?.creationTimestamp),
        node: pod.spec?.nodeName,
        ip: pod.status?.podIP,
        containers,
        conditions: (pod.status?.conditions ?? []).map((c) => ({
          type: c.type, status: c.status, reason: c.reason,
        })),
        events,
      };
    },

    async getPodLogs(namespace: string, name: string, opts?: LogOpts): Promise<string> {
      const { body } = await coreV1.readNamespacedPodLog(
        name, namespace,
        opts?.container,
        undefined, undefined, undefined, undefined,
        opts?.previous ?? false,
        opts?.sinceSeconds,
        opts?.tailLines ?? 100,
        true,
      );
      return body;
    },

    async getPodProblems(namespace?: string): Promise<PodProblem[]> {
      const { body } = namespace
        ? await coreV1.listNamespacedPod(namespace)
        : await coreV1.listPodForAllNamespaces();
      return body.items
        .filter((pod) => {
          const phase = pod.status?.phase;
          if (phase === 'Running' || phase === 'Succeeded') {
            const statuses = pod.status?.containerStatuses ?? [];
            const highRestarts = statuses.some((c) => (c.restartCount ?? 0) > 5);
            const notReady = statuses.some((c) => !c.ready);
            return highRestarts || (notReady && phase === 'Running');
          }
          return phase === 'Failed' || phase === 'Pending' || phase === 'Unknown';
        })
        .map((pod) => {
          const statuses = pod.status?.containerStatuses ?? [];
          const restarts = statuses.reduce((sum, c) => sum + (c.restartCount ?? 0), 0);
          const waiting = statuses.find((c) => c.state?.waiting);
          return {
            namespace: pod.metadata?.namespace ?? '',
            name: pod.metadata?.name ?? '',
            status: pod.status?.phase ?? 'Unknown',
            restarts,
            reason: waiting?.state?.waiting?.reason ?? pod.status?.conditions?.find((c) => c.status === 'False')?.reason,
            message: waiting?.state?.waiting?.message ?? pod.status?.message,
          };
        });
    },

    // ── Deployments ───────────────────────────────────────────────────────────

    async listDeployments(namespace?: string): Promise<DeploymentSummary[]> {
      const { body } = namespace
        ? await appsV1.listNamespacedDeployment(namespace)
        : await appsV1.listDeploymentForAllNamespaces();
      return body.items.map((d) => ({
        namespace: d.metadata?.namespace ?? '',
        name: d.metadata?.name ?? '',
        ready: `${d.status?.readyReplicas ?? 0}/${d.spec?.replicas ?? 0}`,
        upToDate: d.status?.updatedReplicas ?? 0,
        available: d.status?.availableReplicas ?? 0,
        age: age(d.metadata?.creationTimestamp),
      }));
    },

    async getDeployment(namespace: string, name: string): Promise<DeploymentDetail> {
      const { body: d } = await appsV1.readNamespacedDeployment(name, namespace);
      const containers = d.spec?.template?.spec?.containers ?? [];
      return {
        namespace, name,
        ready: `${d.status?.readyReplicas ?? 0}/${d.spec?.replicas ?? 0}`,
        upToDate: d.status?.updatedReplicas ?? 0,
        available: d.status?.availableReplicas ?? 0,
        age: age(d.metadata?.creationTimestamp),
        image: containers.map((c) => c.image).join(', '),
        replicas: d.spec?.replicas ?? 0,
        strategy: d.spec?.strategy?.type ?? 'RollingUpdate',
        conditions: (d.status?.conditions ?? []).map((c) => ({
          type: c.type, status: c.status, reason: c.reason, message: c.message,
        })),
        labels: d.metadata?.labels ?? {},
        annotations: d.metadata?.annotations ?? {},
      };
    },

    // ── Services ──────────────────────────────────────────────────────────────

    async listServices(namespace?: string): Promise<ServiceSummary[]> {
      const { body } = namespace
        ? await coreV1.listNamespacedService(namespace)
        : await coreV1.listServiceForAllNamespaces();
      return body.items.map((svc) => {
        const ports = (svc.spec?.ports ?? []).map((p) => `${p.port}/${p.protocol ?? 'TCP'}`).join(',');
        const externalIPs = svc.status?.loadBalancer?.ingress?.map((i) => i.ip ?? i.hostname).join(',');
        return {
          namespace: svc.metadata?.namespace ?? '',
          name: svc.metadata?.name ?? '',
          type: svc.spec?.type ?? 'ClusterIP',
          clusterIP: svc.spec?.clusterIP ?? '',
          externalIP: externalIPs || undefined,
          ports,
          age: age(svc.metadata?.creationTimestamp),
        };
      });
    },

    // ── Nodes ─────────────────────────────────────────────────────────────────

    async listNodes(): Promise<NodeSummary[]> {
      const { body } = await coreV1.listNode();
      return body.items.map((node) => {
        const ready = node.status?.conditions?.find((c) => c.type === 'Ready');
        const roles = Object.keys(node.metadata?.labels ?? {})
          .filter((k) => k.startsWith('node-role.kubernetes.io/'))
          .map((k) => k.replace('node-role.kubernetes.io/', ''))
          .join(',') || 'worker';
        return {
          name: node.metadata?.name ?? '',
          status: ready?.status === 'True' ? 'Ready' : 'NotReady',
          roles,
          age: age(node.metadata?.creationTimestamp),
          version: node.status?.nodeInfo?.kubeletVersion ?? '',
          os: node.status?.nodeInfo?.osImage ?? '',
        };
      });
    },

    async getNode(name: string): Promise<NodeDetail> {
      const { body: node } = await coreV1.readNode(name);
      const ready = node.status?.conditions?.find((c) => c.type === 'Ready');
      const roles = Object.keys(node.metadata?.labels ?? {})
        .filter((k) => k.startsWith('node-role.kubernetes.io/'))
        .map((k) => k.replace('node-role.kubernetes.io/', ''))
        .join(',') || 'worker';
      return {
        name: node.metadata?.name ?? '',
        status: ready?.status === 'True' ? 'Ready' : 'NotReady',
        roles,
        age: age(node.metadata?.creationTimestamp),
        version: node.status?.nodeInfo?.kubeletVersion ?? '',
        os: node.status?.nodeInfo?.osImage ?? '',
        cpu: node.status?.nodeInfo?.architecture ?? '',
        memory: node.status?.allocatable?.memory ?? '',
        podCIDR: node.spec?.podCIDR,
        taints: (node.spec?.taints ?? []).map((t) => ({ key: t.key, effect: t.effect ?? '' })),
        conditions: (node.status?.conditions ?? []).map((c) => ({
          type: c.type, status: c.status, reason: c.reason,
        })),
        allocatable: {
          cpu: node.status?.allocatable?.cpu ?? '',
          memory: node.status?.allocatable?.memory ?? '',
          pods: node.status?.allocatable?.pods ?? '',
        },
        capacity: {
          cpu: node.status?.capacity?.cpu ?? '',
          memory: node.status?.capacity?.memory ?? '',
          pods: node.status?.capacity?.pods ?? '',
        },
      };
    },

    // ── Events ────────────────────────────────────────────────────────────────

    async listEvents(namespace?: string, limit = 50): Promise<EventSummary[]> {
      const { body } = namespace
        ? await coreV1.listNamespacedEvent(namespace)
        : await coreV1.listEventForAllNamespaces();
      return body.items
        .sort((a, b) => new Date(b.lastTimestamp ?? 0).getTime() - new Date(a.lastTimestamp ?? 0).getTime())
        .slice(0, limit)
        .map((e) => ({
          namespace: e.metadata?.namespace ?? '',
          name: e.metadata?.name ?? '',
          type: e.type ?? 'Normal',
          reason: e.reason ?? '',
          message: e.message ?? '',
          count: e.count ?? 1,
          involvedObject: `${e.involvedObject.kind}/${e.involvedObject.name}`,
          lastSeen: age(e.lastTimestamp ?? undefined),
        }));
    },

    // ── PVCs ──────────────────────────────────────────────────────────────────

    async listPVCs(namespace?: string): Promise<PVCSummary[]> {
      const { body } = namespace
        ? await coreV1.listNamespacedPersistentVolumeClaim(namespace)
        : await coreV1.listPersistentVolumeClaimForAllNamespaces();
      return body.items.map((pvc) => ({
        namespace: pvc.metadata?.namespace ?? '',
        name: pvc.metadata?.name ?? '',
        status: pvc.status?.phase ?? 'Unknown',
        volume: pvc.spec?.volumeName ?? '',
        capacity: pvc.status?.capacity?.storage ?? '',
        accessModes: (pvc.spec?.accessModes ?? []).join(','),
        storageClass: pvc.spec?.storageClassName ?? '',
        age: age(pvc.metadata?.creationTimestamp),
      }));
    },

    // ── CronJobs & Jobs ───────────────────────────────────────────────────────

    async listCronJobs(namespace?: string): Promise<CronJobSummary[]> {
      const { body } = namespace
        ? await batchV1.listNamespacedCronJob(namespace)
        : await batchV1.listCronJobForAllNamespaces();
      return body.items.map((cj) => ({
        namespace: cj.metadata?.namespace ?? '',
        name: cj.metadata?.name ?? '',
        schedule: cj.spec?.schedule ?? '',
        suspend: cj.spec?.suspend ?? false,
        active: cj.status?.active?.length ?? 0,
        lastSchedule: cj.status?.lastScheduleTime
          ? age(cj.status.lastScheduleTime)
          : undefined,
        age: age(cj.metadata?.creationTimestamp),
      }));
    },

    async listJobs(namespace?: string): Promise<JobSummary[]> {
      const { body } = namespace
        ? await batchV1.listNamespacedJob(namespace)
        : await batchV1.listJobForAllNamespaces();
      return body.items.map((job) => {
        const succeeded = job.status?.succeeded ?? 0;
        const completions = job.spec?.completions ?? 1;
        let status: JobSummary['status'] = 'Running';
        if (job.status?.conditions?.find((c) => c.type === 'Complete' && c.status === 'True')) status = 'Complete';
        else if (job.status?.conditions?.find((c) => c.type === 'Failed' && c.status === 'True')) status = 'Failed';

        let duration: string | undefined;
        if (job.status?.startTime && job.status?.completionTime) {
          const ms = new Date(job.status.completionTime).getTime() - new Date(job.status.startTime).getTime();
          duration = `${Math.round(ms / 1000)}s`;
        }

        return {
          namespace: job.metadata?.namespace ?? '',
          name: job.metadata?.name ?? '',
          completions: `${succeeded}/${completions}`,
          duration,
          age: age(job.metadata?.creationTimestamp),
          status,
        };
      });
    },

    // ── IngressRoutes (Traefik) ───────────────────────────────────────────────

    async listIngressRoutes(namespace?: string): Promise<IngressRouteSummary[]> {
      const items = await listCustomObjects(customApi, 'traefik.io', 'v1alpha1', 'ingressroutes', namespace);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return items.map((ir: any) => ({
        namespace: ir.metadata?.namespace ?? '',
        name: ir.metadata?.name ?? '',
        entryPoints: ir.spec?.entryPoints ?? [],
        rules: (ir.spec?.routes ?? []).map((r: any) => ({
          match: r.match ?? '',
          services: (r.services ?? []).map((s: any) => `${s.name}:${s.port}`),
        })),
        age: age(ir.metadata?.creationTimestamp),
      }));
    },

    // ── ArgoCD Applications ───────────────────────────────────────────────────

    async listArgoCDApps(): Promise<ArgoCDAppSummary[]> {
      const items = await listCustomObjects(customApi, 'argoproj.io', 'v1alpha1', 'applications', 'argocd');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return items.map((app: any) => ({
        name: app.metadata?.name ?? '',
        project: app.spec?.project ?? 'default',
        syncStatus: app.status?.sync?.status ?? 'Unknown',
        healthStatus: app.status?.health?.status ?? 'Unknown',
        repo: app.spec?.source?.repoURL ?? '',
        path: app.spec?.source?.path ?? '',
        targetRevision: app.spec?.source?.targetRevision ?? 'HEAD',
        namespace: app.spec?.destination?.namespace ?? '',
      }));
    },

    async getArgoCDApp(name: string): Promise<ArgoCDAppDetail> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await customApi.getNamespacedCustomObject('argoproj.io', 'v1alpha1', 'argocd', 'applications', name) as any;
      const app = res.body;
      return {
        name: app.metadata?.name ?? '',
        project: app.spec?.project ?? 'default',
        syncStatus: app.status?.sync?.status ?? 'Unknown',
        healthStatus: app.status?.health?.status ?? 'Unknown',
        repo: app.spec?.source?.repoURL ?? '',
        path: app.spec?.source?.path ?? '',
        targetRevision: app.spec?.source?.targetRevision ?? 'HEAD',
        namespace: app.spec?.destination?.namespace ?? '',
        conditions: (app.status?.conditions ?? []).map((c: any) => ({
          type: c.type, message: c.message,
        })),
        resources: (app.status?.resources ?? []).map((r: any) => ({
          group: r.group ?? '',
          kind: r.kind ?? '',
          namespace: r.namespace ?? '',
          name: r.name ?? '',
          status: r.status ?? '',
          health: r.health?.status,
        })),
        history: (app.status?.history ?? []).slice(-10).map((h: any) => ({
          revision: h.revision ?? '',
          deployedAt: h.deployedAt ?? '',
          id: h.id ?? 0,
        })),
      };
    },

    // ── KEDA ScaledObjects ────────────────────────────────────────────────────

    async listScaledObjects(namespace?: string): Promise<ScaledObjectSummary[]> {
      const items = await listCustomObjects(customApi, 'keda.sh', 'v1alpha1', 'scaledobjects', namespace);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return items.map((so: any) => ({
        namespace: so.metadata?.namespace ?? '',
        name: so.metadata?.name ?? '',
        scaleTargetKind: so.spec?.scaleTargetRef?.kind ?? 'Deployment',
        scaleTargetName: so.spec?.scaleTargetRef?.name ?? '',
        minReplicas: so.spec?.minReplicaCount ?? 0,
        maxReplicas: so.spec?.maxReplicaCount ?? 100,
        triggers: (so.spec?.triggers ?? []).map((t: any) => t.type).join(','),
        ready: so.status?.conditions?.find((c: any) => c.type === 'Ready')?.status ?? 'Unknown',
        active: so.status?.conditions?.find((c: any) => c.type === 'Active')?.status ?? 'Unknown',
        age: age(so.metadata?.creationTimestamp),
      }));
    },

    // ── Longhorn Volumes ──────────────────────────────────────────────────────

    async listLonghornVolumes(): Promise<LonghornVolumeSummary[]> {
      const items = await listCustomObjects(customApi, 'longhorn.io', 'v1beta2', 'volumes', 'longhorn-system');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return items.map((v: any) => ({
        name: v.metadata?.name ?? '',
        state: v.status?.state ?? 'unknown',
        robustness: v.status?.robustness ?? 'unknown',
        accessMode: v.spec?.accessMode ?? '',
        size: v.spec?.size ?? '',
        replicas: v.spec?.numberOfReplicas ?? 0,
        namespace: v.status?.kubernetesStatus?.namespace,
        pvc: v.status?.kubernetesStatus?.pvcName,
      }));
    },
  };
}
