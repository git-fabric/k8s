# @git-fabric/k8s

Kubernetes operations fabric — cluster, pods, deployments, services, nodes, events, storage, ArgoCD, and ingress as a composable MCP layer.

Part of the [git-fabric](https://github.com/git-fabric) ecosystem. See [git-fabric/sdk](https://github.com/git-fabric/sdk) for the architecture specification (ADR-001, ADR-002, BGP routing model).

## OSI Layer Architecture

```
Layer 7 — Application    app.ts (FabricApp factory, 26 tools)
Layer 6 — Presentation   bin/cli.js (MCP stdio + HTTP, aiana_query)
Layer 5 — Session        (stateless — direct API queries)
Layer 4 — Transport      MCP protocol (stdio + StreamableHTTP)
Layer 3 — Network        Gateway registration (AS65002, fabric.k8s.*)
Layer 2 — Data Link      adapters/env.ts (Kubernetes client)
Layer 1 — Physical       Kubernetes API server
```

## Gateway Registration

When `GATEWAY_URL` is set, fabric-k8s registers with the gateway as **AS65002** and advertises the following route prefixes:

| Prefix | Description |
|--------|-------------|
| `fabric.k8s` | Kubernetes cluster operations — pods, deployments, services, nodes, events |
| `fabric.k8s.pods` | Pod management — list, describe, logs, problems |
| `fabric.k8s.deployments` | Deployment management — list, describe, rollout status |
| `fabric.k8s.services` | Service management — list, describe |
| `fabric.k8s.nodes` | Node management — list, describe, capacity |
| `fabric.k8s.events` | Cluster events — warnings, failures, scheduling |
| `fabric.k8s.storage` | PVCs and Longhorn volumes |
| `fabric.k8s.argocd` | ArgoCD applications — sync status, health, deploy history |
| `fabric.k8s.ingress` | Traefik IngressRoutes — routing rules and entrypoints |
| `fabric.k8s.jobs` | CronJobs and Jobs — schedules, completions, status |

All routes are advertised with `local_pref: 100`. The gateway uses BGP-style best-path selection to route queries to the most specific prefix match.

## Tools

26 tools across cluster info, namespaces, pods, deployments, services, nodes, events, PVCs, CronJobs, Jobs, IngressRoutes, ArgoCD, KEDA, and Longhorn.

| Tool | Description |
|------|-------------|
| `k8s_cluster_info` | Cluster version, node/namespace/pod counts |
| `k8s_list_namespaces` | List all namespaces |
| `k8s_list_pods` | List pods (all or per namespace) |
| `k8s_get_pod` | Pod details, containers, conditions, events |
| `k8s_get_pod_logs` | Container logs with tail/since/previous |
| `k8s_pod_problems` | Failing/crashing/not-ready pods |
| `k8s_list_deployments` | List deployments |
| `k8s_get_deployment` | Deployment details, strategy, conditions |
| `k8s_list_services` | List services |
| `k8s_list_nodes` | List nodes with roles and versions |
| `k8s_get_node` | Node details, capacity, taints, conditions |
| `k8s_list_events` | Recent cluster events, warnings, failures |
| `k8s_list_pvcs` | PersistentVolumeClaims with status and capacity |
| `k8s_list_cronjobs` | CronJobs with schedule and suspend status |
| `k8s_list_jobs` | Jobs with completion status and duration |
| `k8s_list_ingress_routes` | Traefik IngressRoutes with entry points and rules |
| `k8s_list_argocd_apps` | ArgoCD Applications with sync and health status |
| `k8s_get_argocd_app` | Full ArgoCD Application details and deploy history |
| `k8s_list_scaled_objects` | KEDA ScaledObjects with triggers and replica bounds |
| `k8s_list_longhorn_volumes` | Longhorn volumes with state and robustness |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `K8S_IN_CLUSTER` | `true` | Use in-cluster service account |
| `KUBECONFIG` | `~/.kube/config` | Kubeconfig path (when not in-cluster) |
| `MCP_HTTP_PORT` | — | Port for StreamableHTTP transport (omit for stdio) |
| `GATEWAY_URL` | — | Fabric gateway URL for BGP-style route registration |
| `POD_IP` | `0.0.0.0` | Pod IP advertised to gateway for MCP endpoint |
| `OLLAMA_ENDPOINT` | `http://ollama.fabric-sdk:11434` | Ollama inference endpoint for local LLM routing |
| `OLLAMA_MODEL` | `qwen2.5-coder:3b` | Model used for local-LLM routing lane |
| `LIBRARY_DIR` | `/tmp/fabric-library` | Cache directory for library git checkouts |

## Library

The built-in library provides reference documentation via git-based knowledge retrieval. When a query does not match live cluster state, the library fetches relevant files from upstream sources on demand.

| Source | Repository | Description |
|--------|------------|-------------|
| `k3s-docs` | [k3s-io/docs](https://github.com/k3s-io/docs) | Official k3s documentation (Docusaurus) |
| `k3s-src` | [k3s-io/k3s](https://github.com/k3s-io/k3s) | k3s source code — CLI flags, server/agent implementation |

The library uses a topic index to match query keywords to specific files, fetches them via shallow clone or GitHub raw API, and returns context with a confidence score. Live cluster queries ("what IS") always take priority over library queries ("how to" / "why").

## License

MIT
