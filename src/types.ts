/**
 * @git-fabric/k8s — shared types
 *
 * Covers: cluster, namespaces, pods, deployments, services, nodes,
 * events, PVCs, CronJobs/Jobs, IngressRoutes (Traefik), ArgoCD apps,
 * KEDA ScaledObjects, Longhorn volumes.
 */

export interface K8sAdapter {
  // Cluster
  getClusterInfo(): Promise<ClusterInfo>;

  // Namespaces
  listNamespaces(): Promise<NamespaceSummary[]>;

  // Pods
  listPods(namespace?: string): Promise<PodSummary[]>;
  getPod(namespace: string, name: string): Promise<PodDetail>;
  getPodLogs(namespace: string, name: string, opts?: LogOpts): Promise<string>;
  getPodProblems(namespace?: string): Promise<PodProblem[]>;

  // Deployments
  listDeployments(namespace?: string): Promise<DeploymentSummary[]>;
  getDeployment(namespace: string, name: string): Promise<DeploymentDetail>;

  // Services
  listServices(namespace?: string): Promise<ServiceSummary[]>;

  // Nodes
  listNodes(): Promise<NodeSummary[]>;
  getNode(name: string): Promise<NodeDetail>;

  // Events
  listEvents(namespace?: string, limit?: number): Promise<EventSummary[]>;

  // PVCs
  listPVCs(namespace?: string): Promise<PVCSummary[]>;

  // CronJobs & Jobs
  listCronJobs(namespace?: string): Promise<CronJobSummary[]>;
  listJobs(namespace?: string): Promise<JobSummary[]>;

  // IngressRoutes (Traefik)
  listIngressRoutes(namespace?: string): Promise<IngressRouteSummary[]>;

  // ArgoCD Applications
  listArgoCDApps(): Promise<ArgoCDAppSummary[]>;
  getArgoCDApp(name: string): Promise<ArgoCDAppDetail>;

  // KEDA ScaledObjects
  listScaledObjects(namespace?: string): Promise<ScaledObjectSummary[]>;

  // Longhorn Volumes
  listLonghornVolumes(): Promise<LonghornVolumeSummary[]>;
}

// ── Cluster ──────────────────────────────────────────────────────────────────

export interface ClusterInfo {
  serverVersion: string;
  platform: string;
  nodeCount: number;
  namespaceCount: number;
  podCount: number;
}

// ── Namespaces ───────────────────────────────────────────────────────────────

export interface NamespaceSummary {
  name: string;
  status: string;
  age: string;
}

// ── Pods ─────────────────────────────────────────────────────────────────────

export interface PodSummary {
  namespace: string;
  name: string;
  status: string;
  ready: string;
  restarts: number;
  age: string;
  node?: string;
}

export interface PodDetail extends PodSummary {
  ip?: string;
  containers: ContainerStatus[];
  conditions: { type: string; status: string; reason?: string }[];
  events?: PodEvent[];
}

export interface ContainerStatus {
  name: string;
  image: string;
  ready: boolean;
  restarts: number;
  state: string;
  reason?: string;
}

export interface PodEvent {
  type: string;
  reason: string;
  message: string;
  count: number;
  lastSeen: string;
}

export interface LogOpts {
  container?: string;
  tailLines?: number;
  sinceSeconds?: number;
  previous?: boolean;
}

export interface PodProblem {
  namespace: string;
  name: string;
  status: string;
  restarts: number;
  reason?: string;
  message?: string;
}

// ── Deployments ───────────────────────────────────────────────────────────────

export interface DeploymentSummary {
  namespace: string;
  name: string;
  ready: string;
  upToDate: number;
  available: number;
  age: string;
}

export interface DeploymentDetail extends DeploymentSummary {
  image: string;
  replicas: number;
  strategy: string;
  conditions: { type: string; status: string; reason?: string; message?: string }[];
  labels: Record<string, string>;
  annotations: Record<string, string>;
}

// ── Services ──────────────────────────────────────────────────────────────────

export interface ServiceSummary {
  namespace: string;
  name: string;
  type: string;
  clusterIP: string;
  externalIP?: string;
  ports: string;
  age: string;
}

// ── Nodes ─────────────────────────────────────────────────────────────────────

export interface NodeSummary {
  name: string;
  status: string;
  roles: string;
  age: string;
  version: string;
  os: string;
}

export interface NodeDetail extends NodeSummary {
  cpu: string;
  memory: string;
  podCIDR?: string;
  taints: { key: string; effect: string }[];
  conditions: { type: string; status: string; reason?: string }[];
  allocatable: { cpu: string; memory: string; pods: string };
  capacity: { cpu: string; memory: string; pods: string };
}

// ── Events ────────────────────────────────────────────────────────────────────

export interface EventSummary {
  namespace: string;
  name: string;
  type: string;        // Normal | Warning
  reason: string;
  message: string;
  count: number;
  involvedObject: string;
  lastSeen: string;
}

// ── PVCs ──────────────────────────────────────────────────────────────────────

export interface PVCSummary {
  namespace: string;
  name: string;
  status: string;
  volume: string;
  capacity: string;
  accessModes: string;
  storageClass: string;
  age: string;
}

// ── CronJobs & Jobs ───────────────────────────────────────────────────────────

export interface CronJobSummary {
  namespace: string;
  name: string;
  schedule: string;
  suspend: boolean;
  active: number;
  lastSchedule?: string;
  age: string;
}

export interface JobSummary {
  namespace: string;
  name: string;
  completions: string;
  duration?: string;
  age: string;
  status: 'Complete' | 'Failed' | 'Running';
}

// ── IngressRoutes (Traefik) ───────────────────────────────────────────────────

export interface IngressRouteSummary {
  namespace: string;
  name: string;
  entryPoints: string[];
  rules: { match: string; services: string[] }[];
  age: string;
}

// ── ArgoCD ────────────────────────────────────────────────────────────────────

export interface ArgoCDAppSummary {
  name: string;
  project: string;
  syncStatus: string;
  healthStatus: string;
  repo: string;
  path: string;
  targetRevision: string;
  namespace: string;
}

export interface ArgoCDAppDetail extends ArgoCDAppSummary {
  conditions: { type: string; message: string }[];
  resources: { group: string; kind: string; namespace: string; name: string; status: string; health?: string }[];
  history: { revision: string; deployedAt: string; id: number }[];
}

// ── KEDA ──────────────────────────────────────────────────────────────────────

export interface ScaledObjectSummary {
  namespace: string;
  name: string;
  scaleTargetKind: string;
  scaleTargetName: string;
  minReplicas: number;
  maxReplicas: number;
  triggers: string;
  ready: string;
  active: string;
  age: string;
}

// ── Longhorn ──────────────────────────────────────────────────────────────────

export interface LonghornVolumeSummary {
  name: string;
  state: string;
  robustness: string;
  accessMode: string;
  size: string;
  replicas: number;
  namespace?: string;
  pvc?: string;
}
