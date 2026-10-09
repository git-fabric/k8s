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
export declare class Library {
    private cacheDir;
    constructor();
    /**
     * Find relevant files for a query by matching against the topic index.
     * Returns the source, topic description, and file paths.
     */
    findTopics(query: string): {
        source: LibrarySource;
        topic: TopicEntry;
        score: number;
    }[];
    /**
     * Ensure a source repo is checked out (shallow clone, cached).
     * Returns the local path to the repo.
     */
    checkout(source: LibrarySource): string;
    /**
     * Read files from a source — either from git checkout or GitHub raw API.
     * Returns concatenated content with file headers.
     */
    readFiles(source: LibrarySource, files: string[]): string;
    /**
     * Fetch files directly from GitHub raw content API.
     * No clone needed — perfect for large repos where we only need specific files.
     */
    private readFilesFromGitHub;
    /**
     * Query the library: find relevant topics, fetch files, return context.
     */
    query(queryText: string): Promise<{
        context: string;
        confidence: number;
        sources: string[];
    } | null>;
    /**
     * List all registered sources and their topic counts.
     */
    listSources(): {
        id: string;
        repo: string;
        topics: number;
        description: string;
    }[];
}
export {};
//# sourceMappingURL=library.d.ts.map