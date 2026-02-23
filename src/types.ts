/**
 * @git-fabric/k8s — shared types
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
}

export interface ClusterInfo {
  serverVersion: string;
  platform: string;
  nodeCount: number;
  namespaceCount: number;
  podCount: number;
}

export interface NamespaceSummary {
  name: string;
  status: string;
  age: string;
}

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

export interface ServiceSummary {
  namespace: string;
  name: string;
  type: string;
  clusterIP: string;
  externalIP?: string;
  ports: string;
  age: string;
}

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
