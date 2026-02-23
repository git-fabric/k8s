# @git-fabric/k8s

Kubernetes operations fabric app — cluster, pods, deployments, services, and logs as a composable MCP layer.

Part of the [git-fabric](https://github.com/git-fabric) ecosystem.

## Tools

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

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `K8S_IN_CLUSTER` | `true` | Use in-cluster service account |
| `KUBECONFIG` | `~/.kube/config` | Kubeconfig path (when not in-cluster) |

## License

MIT
