/**
 * Library — git-based knowledge retrieval for fabric-k8s
 *
 * The librarian model: we know where the books are, we go fetch them
 * when asked, and we return them when done. No photocopies.
 *
 * Sources:
 *   - k3s-io/docs  — official k3s documentation (Docusaurus)
 *   - k3s-io/k3s   — source code (CLI flags, README)
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const LIBRARY_DIR = process.env.LIBRARY_DIR || '/tmp/fabric-library';

// ── Source Registry ─────────────────────────────────────────────────────────
// Each source defines a git repo and a topic index mapping keywords to files.

interface LibrarySource {
  id: string;
  repo: string;
  branch: string;
  description: string;
  topics: TopicEntry[];
  /** Use GitHub raw API instead of git clone (for large repos) */
  useRawApi?: boolean;
}

interface TopicEntry {
  keywords: string[];
  files: string[];
  description: string;
}

const SOURCES: LibrarySource[] = [
  {
    id: 'k3s-docs',
    repo: 'https://github.com/k3s-io/docs.git',
    branch: 'main',
    description: 'Official k3s documentation',
    topics: [
      // Derived from sidebars.js + doc structure
      { keywords: ['install', 'setup', 'getting started', 'quick start'],
        files: ['docs/quick-start.md', 'docs/installation/installation.md', 'docs/installation/requirements.md', 'docs/installation/configuration.md'],
        description: 'Installation and setup' },
      { keywords: ['requirement', 'prerequisite', 'hardware', 'cpu', 'memory', 'os', 'operating system'],
        files: ['docs/installation/requirements.md'],
        description: 'System requirements' },
      { keywords: ['config', 'configuration', 'config file', 'yaml'],
        files: ['docs/installation/configuration.md', 'docs/advanced.md'],
        description: 'Configuration' },
      { keywords: ['registry', 'private registry', 'mirror', 'containerd'],
        files: ['docs/installation/private-registry.md', 'docs/installation/registry-mirror.md'],
        description: 'Container registries' },
      { keywords: ['airgap', 'air-gap', 'offline'],
        files: ['docs/installation/airgap.md'],
        description: 'Air-gap installation' },
      { keywords: ['server', 'agent', 'role', 'control plane', 'worker'],
        files: ['docs/installation/server-roles.md', 'docs/architecture.md'],
        description: 'Server and agent roles' },
      { keywords: ['component', 'packaged', 'embedded', 'traefik', 'coredns', 'servicelb', 'local-path'],
        files: ['docs/installation/packaged-components.md'],
        description: 'Packaged components' },
      { keywords: ['uninstall', 'remove', 'cleanup'],
        files: ['docs/installation/uninstall.md', 'docs/upgrades/killall.md'],
        description: 'Uninstall and cleanup' },
      { keywords: ['architecture', 'design', 'how it works', 'overview'],
        files: ['docs/architecture.md', 'docs/introduction.md'],
        description: 'Architecture overview' },
      { keywords: ['kubeconfig', 'cluster access', 'kubectl'],
        files: ['docs/cluster-access.md'],
        description: 'Cluster access' },
      { keywords: ['etcd', 'datastore', 'database', 'embedded'],
        files: ['docs/datastore/datastore.md', 'docs/datastore/ha-embedded.md'],
        description: 'Datastore configuration' },
      { keywords: ['backup', 'restore', 'snapshot', 'etcd snapshot'],
        files: ['docs/datastore/backup-restore.md', 'docs/cli/etcd-snapshot.md'],
        description: 'Backup and restore' },
      { keywords: ['ha', 'high availability', 'multi-server', 'multi-master', 'load balancer'],
        files: ['docs/datastore/ha-embedded.md', 'docs/datastore/ha.md', 'docs/datastore/cluster-loadbalancer.md'],
        description: 'High availability' },
      { keywords: ['upgrade', 'update', 'version'],
        files: ['docs/upgrades/upgrades.md', 'docs/upgrades/manual.md', 'docs/upgrades/automated.md'],
        description: 'Upgrades' },
      { keywords: ['rollback', 'roll back', 'downgrade'],
        files: ['docs/upgrades/roll-back.md'],
        description: 'Rollback' },
      { keywords: ['network', 'cni', 'flannel', 'calico', 'cilium', 'canal'],
        files: ['docs/networking/networking.md', 'docs/networking/basic-network-options.md'],
        description: 'Networking basics' },
      { keywords: ['service', 'loadbalancer', 'nodeport', 'ingress', 'servicelb', 'metallb'],
        files: ['docs/networking/networking-services.md'],
        description: 'Networking services' },
      { keywords: ['multicloud', 'multi-cloud', 'distributed', 'vpn', 'wireguard'],
        files: ['docs/networking/distributed-multicloud.md'],
        description: 'Distributed / multicloud' },
      { keywords: ['multus', 'ipam', 'multi-network', 'dual-stack'],
        files: ['docs/networking/multus-ipams.md'],
        description: 'Multus and IPAMs' },
      { keywords: ['helm', 'chart', 'helmchart'],
        files: ['docs/add-ons/helm.md'],
        description: 'Helm integration' },
      { keywords: ['storage', 'local-path', 'pvc', 'persistent volume', 'longhorn'],
        files: ['docs/add-ons/storage.md'],
        description: 'Storage' },
      { keywords: ['image', 'import', 'preload', 'ctr'],
        files: ['docs/add-ons/import-images.md'],
        description: 'Image management' },
      { keywords: ['security', 'hardening', 'cis', 'benchmark'],
        files: ['docs/security/security.md', 'docs/security/hardening-guide.md'],
        description: 'Security and hardening' },
      { keywords: ['secret', 'encrypt', 'encryption'],
        files: ['docs/security/secrets-encryption.md', 'docs/cli/secrets-encrypt.md'],
        description: 'Secrets encryption' },
      { keywords: ['cli', 'command', 'flag', 'server flag', 'agent flag'],
        files: ['docs/cli/cli.md', 'docs/cli/server.md', 'docs/cli/agent.md'],
        description: 'CLI reference' },
      { keywords: ['certificate', 'cert', 'tls', 'rotate', 'ca'],
        files: ['docs/cli/certificate.md'],
        description: 'Certificate management' },
      { keywords: ['token', 'join', 'node-token'],
        files: ['docs/cli/token.md'],
        description: 'Token management' },
      { keywords: ['environment', 'env', 'variable'],
        files: ['docs/reference/env-variables.md'],
        description: 'Environment variables' },
      { keywords: ['metric', 'monitoring', 'prometheus'],
        files: ['docs/reference/metrics.md'],
        description: 'Metrics' },
      { keywords: ['resource', 'profiling', 'cpu usage', 'memory usage', 'footprint'],
        files: ['docs/reference/resource-profiling.md'],
        description: 'Resource profiling' },
      { keywords: ['known issue', 'bug', 'problem', 'workaround'],
        files: ['docs/known-issues.md', 'docs/faq.md'],
        description: 'Known issues and FAQ' },
      { keywords: ['faq', 'frequently asked', 'common question'],
        files: ['docs/faq.md'],
        description: 'FAQ' },
      { keywords: ['release', 'changelog', 'what\'s new'],
        files: ['docs/release-notes/v1.33.X.md', 'docs/release-notes/v1.34.X.md', 'docs/release-notes/v1.35.X.md'],
        description: 'Release notes' },
      { keywords: ['advanced', 'rootless', 'selinux', 'cgroup', 'node label', 'taint'],
        files: ['docs/advanced.md'],
        description: 'Advanced options' },
      { keywords: ['killall', 'kill', 'stop'],
        files: ['docs/upgrades/killall.md'],
        description: 'Killall script' },
    ],
  },
  {
    id: 'k3s-src',
    repo: 'https://github.com/k3s-io/k3s.git',
    branch: 'master',
    description: 'k3s source code — CLI flags, server/agent implementation',
    useRawApi: true,
    topics: [
      { keywords: ['server flag', 'server config', 'server option', 'k3s server'],
        files: ['pkg/cli/cmds/server.go'],
        description: 'Server CLI flags (authoritative source)' },
      { keywords: ['agent flag', 'agent config', 'agent option', 'k3s agent'],
        files: ['pkg/cli/cmds/agent.go'],
        description: 'Agent CLI flags (authoritative source)' },
      { keywords: ['etcd snapshot flag', 'snapshot command'],
        files: ['pkg/cli/cmds/etcd_snapshot.go'],
        description: 'Etcd snapshot CLI' },
      { keywords: ['token command', 'token flag'],
        files: ['pkg/cli/cmds/token.go'],
        description: 'Token CLI' },
      { keywords: ['secret encrypt command'],
        files: ['pkg/cli/cmds/secrets_encrypt.go'],
        description: 'Secrets encrypt CLI' },
      { keywords: ['cert command', 'certificate command'],
        files: ['pkg/cli/cmds/certs.go'],
        description: 'Certificate CLI' },
    ],
  },
];

// ── Library Class ───────────────────────────────────────────────────────────

export class Library {
  private cacheDir: string;

  constructor() {
    this.cacheDir = LIBRARY_DIR;
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * Find relevant files for a query by matching against the topic index.
   * Returns the source, topic description, and file paths.
   */
  findTopics(query: string): { source: LibrarySource; topic: TopicEntry; score: number }[] {
    const q = query.toLowerCase();
    const matches: { source: LibrarySource; topic: TopicEntry; score: number }[] = [];

    for (const source of SOURCES) {
      for (const topic of source.topics) {
        let score = 0;
        for (const kw of topic.keywords) {
          if (q.includes(kw)) {
            // Longer keyword matches are more specific → higher score
            score += kw.length;
          }
        }
        if (score > 0) {
          matches.push({ source, topic, score });
        }
      }
    }

    // Sort by score descending, deduplicate files
    return matches.sort((a, b) => b.score - a.score);
  }

  /**
   * Ensure a source repo is checked out (shallow clone, cached).
   * Returns the local path to the repo.
   */
  checkout(source: LibrarySource): string {
    if (source.useRawApi) {
      // No checkout needed — files fetched via API
      return '';
    }

    const localPath = join(this.cacheDir, source.id);

    if (existsSync(join(localPath, '.git'))) {
      // Already checked out — pull latest (fast, shallow)
      try {
        execSync(`git -C ${localPath} pull --depth 1 --rebase 2>/dev/null || true`, {
          timeout: 15000,
          stdio: 'pipe',
        });
      } catch {
        // Pull failed — stale cache is better than no cache
      }
      return localPath;
    }

    // Fresh shallow clone
    execSync(
      `git clone --depth 1 --branch ${source.branch} ${source.repo} ${localPath}`,
      { timeout: 60000, stdio: 'pipe' }
    );

    return localPath;
  }

  /**
   * Read files from a source — either from git checkout or GitHub raw API.
   * Returns concatenated content with file headers.
   */
  readFiles(source: LibrarySource, files: string[]): string {
    if (source.useRawApi) {
      return this.readFilesFromGitHub(source, files);
    }

    const localPath = this.checkout(source);
    const sections: string[] = [];

    for (const file of files) {
      const fullPath = join(localPath, file);
      if (existsSync(fullPath)) {
        try {
          const content = readFileSync(fullPath, 'utf-8');
          const trimmed = content.length > 8000
            ? content.slice(0, 8000) + '\n\n...[truncated — full source at ' + file + ']'
            : content;
          sections.push(`--- ${file} ---\n${trimmed}`);
        } catch {
          // Skip unreadable files
        }
      }
    }

    return sections.join('\n\n');
  }

  /**
   * Fetch files directly from GitHub raw content API.
   * No clone needed — perfect for large repos where we only need specific files.
   */
  private readFilesFromGitHub(source: LibrarySource, files: string[]): string {
    // Extract owner/repo from git URL
    const match = source.repo.match(/github\.com\/([^/]+\/[^/.]+)/);
    if (!match) return '';

    const ownerRepo = match[1];
    const sections: string[] = [];

    for (const file of files) {
      try {
        const url = `https://raw.githubusercontent.com/${ownerRepo}/${source.branch}/${file}`;
        // Synchronous fetch via curl — keeps the API simple
        const content = execSync(`curl -sf --max-time 10 "${url}"`, {
          timeout: 12000,
          stdio: ['pipe', 'pipe', 'pipe'],
          encoding: 'utf-8',
        });
        if (content) {
          const trimmed = content.length > 8000
            ? content.slice(0, 8000) + '\n\n...[truncated — full source at ' + file + ']'
            : content;
          sections.push(`--- ${file} ---\n${trimmed}`);
        }
      } catch {
        // File not found or fetch failed — skip it
      }
    }

    return sections.join('\n\n');
  }

  /**
   * Query the library: find relevant topics, fetch files, return context.
   */
  async query(queryText: string): Promise<{ context: string; confidence: number; sources: string[] } | null> {
    const matches = this.findTopics(queryText);
    if (matches.length === 0) return null;

    // Take top 3 topic matches, deduplicate files
    const topMatches = matches.slice(0, 3);
    const seenFiles = new Set<string>();
    const filesToRead: { source: LibrarySource; file: string }[] = [];

    for (const m of topMatches) {
      for (const f of m.topic.files) {
        const key = `${m.source.id}:${f}`;
        if (!seenFiles.has(key)) {
          seenFiles.add(key);
          filesToRead.push({ source: m.source, file: f });
        }
      }
    }

    // Cap at 6 files to keep context manageable
    const capped = filesToRead.slice(0, 6);

    // Group by source for efficient checkout
    const bySource = new Map<string, { source: LibrarySource; files: string[] }>();
    for (const { source, file } of capped) {
      const existing = bySource.get(source.id);
      if (existing) {
        existing.files.push(file);
      } else {
        bySource.set(source.id, { source, files: [file] });
      }
    }

    // Read all files — catch per-source errors so one failure doesn't kill the query
    const sections: string[] = [];
    const sources: string[] = [];
    for (const { source, files } of bySource.values()) {
      try {
        const content = this.readFiles(source, files);
        if (content) {
          sections.push(content);
          sources.push(...files.map(f => `${source.id}/${f}`));
        }
      } catch {
        // Source unavailable — continue with others
      }
    }

    if (sections.length === 0) return null;

    const context = sections.join('\n\n');
    // Confidence: based on topic match quality
    const bestScore = topMatches[0].score;
    const confidence = Math.min(0.92, 0.6 + bestScore * 0.04);

    return { context, confidence, sources };
  }

  /**
   * List all registered sources and their topic counts.
   */
  listSources(): { id: string; repo: string; topics: number; description: string }[] {
    return SOURCES.map(s => ({
      id: s.id,
      repo: s.repo,
      topics: s.topics.length,
      description: s.description,
    }));
  }
}
