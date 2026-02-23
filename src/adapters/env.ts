/**
 * Environment adapter — creates K8sAdapter from in-cluster config or kubeconfig.
 *
 * Required env vars (in-cluster):
 *   K8S_IN_CLUSTER=true  — use service account token (default)
 *
 * Optional env vars (out-of-cluster):
 *   KUBECONFIG           — path to kubeconfig file
 *   K8S_IN_CLUSTER=false — use kubeconfig instead of in-cluster
 */

import * as k8s from '@kubernetes/client-node';
import type {
  K8sAdapter, ClusterInfo, NamespaceSummary, PodSummary, PodDetail,
  ContainerStatus, PodEvent, LogOpts, PodProblem, DeploymentSummary,
  DeploymentDetail, ServiceSummary, NodeSummary, NodeDetail,
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

export function createAdapterFromEnv(): K8sAdapter {
  const kc = new k8s.KubeConfig();
  const inCluster = process.env.K8S_IN_CLUSTER !== 'false';
  if (inCluster) {
    kc.loadFromCluster();
  } else {
    kc.loadFromDefault();
  }

  const coreV1 = kc.makeApiClient(k8s.CoreV1Api);
  const appsV1 = kc.makeApiClient(k8s.AppsV1Api);
  const versionApi = kc.makeApiClient(k8s.VersionApi);

  return {
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

    async listNamespaces(): Promise<NamespaceSummary[]> {
      const { body } = await coreV1.listNamespace();
      return body.items.map((ns) => ({
        name: ns.metadata?.name ?? '',
        status: ns.status?.phase ?? 'Unknown',
        age: age(ns.metadata?.creationTimestamp),
      }));
    },

    async listPods(namespace?: string): Promise<PodSummary[]> {
      const { body } = namespace
        ? await coreV1.listNamespacedPod(namespace)
        : await coreV1.listPodForAllNamespaces();
      return body.items.map((pod) => {
        const containerStatuses = pod.status?.containerStatuses ?? [];
        const ready = containerStatuses.filter((c) => c.ready).length;
        const total = containerStatuses.length;
        const restarts = containerStatuses.reduce((sum, c) => sum + (c.restartCount ?? 0), 0);
        return {
          namespace: pod.metadata?.namespace ?? '',
          name: pod.metadata?.name ?? '',
          status: pod.status?.phase ?? 'Unknown',
          ready: `${ready}/${total}`,
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
      const containerStatuses = pod.status?.containerStatuses ?? [];
      const ready = containerStatuses.filter((c) => c.ready).length;
      const restarts = containerStatuses.reduce((sum, c) => sum + (c.restartCount ?? 0), 0);

      const containers: ContainerStatus[] = containerStatuses.map((c) => {
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
        ready: `${ready}/${containerStatuses.length}`,
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
          const containerStatuses = pod.status?.containerStatuses ?? [];
          const restarts = containerStatuses.reduce((sum, c) => sum + (c.restartCount ?? 0), 0);
          const waitingContainer = containerStatuses.find((c) => c.state?.waiting);
          return {
            namespace: pod.metadata?.namespace ?? '',
            name: pod.metadata?.name ?? '',
            status: pod.status?.phase ?? 'Unknown',
            restarts,
            reason: waitingContainer?.state?.waiting?.reason ?? pod.status?.conditions?.find((c) => c.status === 'False')?.reason,
            message: waitingContainer?.state?.waiting?.message ?? pod.status?.message,
          };
        });
    },

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
  };
}
