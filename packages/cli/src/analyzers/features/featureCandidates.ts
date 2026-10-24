import type { FeatureInfo } from "./featureDetector.js";

export type FeatureCandidateSource =
  | "registry"
  | "capability"
  | "entity"
  | "frontend-page"
  | "client-route"
  | "ai";

export type ObservationReliability = "high" | "medium" | "low";

export interface FeatureEvidence {
  ruleId: string;
  source: FeatureCandidateSource;
  files: string[];
  routePaths?: string[];
  entityNames?: string[];
  detail: string;
  reliability: ObservationReliability;
}

export interface FeatureCandidate {
  id: string;
  label: string;
  source: FeatureCandidateSource;
  evidence: FeatureEvidence[];
  files: string[];
  routePaths: string[];
  entityNames: string[];
  conclusionConfidence: "high" | "medium" | "low";
  /**
   * The candidate stands on its own and is never fused with another one. Used for the
   * landing page, which imports pieces of every other feature and would otherwise
   * absorb them through shared files.
   */
  standalone?: boolean;
  /** Internal compatibility payload used while the public snapshot remains V1. */
  projection?: FeatureInfo;
}

export type AnchorType = "entity" | "file" | "route-resource" | "alias";

export interface MergeDecision {
  candidateIds: [string, string];
  outcome: "merged" | "rejected" | "retained";
  anchors: Array<{ type: AnchorType; value: string }>;
  similarity?: number;
  reason: string;
}

export type FeatureCluster = {
  id: string;
  canonicalCandidateId: string;
  canonicalLabel: string;
  aliases: string[];
  candidates: FeatureCandidate[];
  memberIds: string[];
  anchors: string[];
  decisionRationale: string;
};

export type FeatureReconciliation = {
  clusters: FeatureCluster[];
  rejectedCandidateIds: string[];
  mergeDecisions?: MergeDecision[];
};

const SOURCE_PRIORITY: Record<FeatureCandidateSource, number> = {
  "frontend-page": 6,
  "client-route": 5,
  entity: 4,
  capability: 3,
  registry: 2,
  ai: 0,
};

const RELIABILITY_PRIORITY: Record<ObservationReliability, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const CONFIDENCE_PRIORITY: Record<FeatureCandidate["conclusionConfidence"], number> = {
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * Reconcile complete candidate sets using hard evidence anchors only. Names
 * only influence the deterministic canonical-label tie break after candidates
 * are already in the same connected component.
 */
const HUB_FILE_THRESHOLD = 5;

export function reconcileFeatureCandidates(
  candidates: FeatureCandidate[],
  fileReferenceCounts: Record<string, number> = {}
): FeatureReconciliation {
  const deterministicCandidates = candidates
    .filter((candidate) => candidate.source !== "ai")
    .map(normalizeCandidate)
    .sort((left, right) => left.id.localeCompare(right.id));
  const rejectedCandidateIds = candidates
    .filter((candidate) => candidate.source === "ai")
    .map((candidate) => candidate.id)
    .sort();
  const unionFind = new UnionFind(deterministicCandidates.length);
  const anchorsByPair = new Map<string, string[]>();
  const structuredAnchorsByPair = new Map<string, Array<{ type: AnchorType; value: string }>>();
  const mergeDecisions: MergeDecision[] = [];
  // Entity identity per union-find root. Anchors are pairwise, but union-find
  // merging is transitive, so a single "bridge" candidate (e.g. a behavioral
  // capability whose evidence touches two resources) could otherwise fuse two
  // genuinely different entity features into one cluster.
  const entityIdentities = new Map<number, Set<string>>();
  deterministicCandidates.forEach((candidate, index) => {
    const identity = entityIdentity(candidate);
    if (identity.size > 0) entityIdentities.set(index, identity);
  });

  // Same guard for pages: a bridge candidate must not fuse two different pages.
  const pageIdentities = new Map<number, Set<string>>();
  deterministicCandidates.forEach((candidate, index) => {
    if (isPageSource(candidate.source)) pageIdentities.set(index, new Set([normalizeAnchor(candidate.label)]));
  });

  for (const rejectedId of rejectedCandidateIds) {
    mergeDecisions.push({
      candidateIds: [rejectedId, ""],
      outcome: "rejected",
      anchors: [],
      reason: "AI-sourced candidate rejected from deterministic reconciliation.",
    });
  }

  for (let left = 0; left < deterministicCandidates.length; left += 1) {
    for (let right = left + 1; right < deterministicCandidates.length; right += 1) {
      const leftCandidate = deterministicCandidates[left];
      const rightCandidate = deterministicCandidates[right];
      const structured = findStructuredAnchors(leftCandidate, rightCandidate, fileReferenceCounts);
      if (structured.length === 0) {
        mergeDecisions.push({
          candidateIds: [leftCandidate.id, rightCandidate.id],
          outcome: "retained",
          anchors: [],
          reason: "No hard anchor found; candidates remain separate.",
        });
        continue;
      }

      const anchorStrings = structured.map((a) => `${a.type}:${a.value}`);
      const leftRoot = unionFind.find(left);
      const rightRoot = unionFind.find(right);
      const leftIdentity = entityIdentities.get(leftRoot);
      const rightIdentity = entityIdentities.get(rightRoot);
      if (leftRoot !== rightRoot && entitiesConflict(leftIdentity, rightIdentity)) {
        mergeDecisions.push({
          candidateIds: [leftCandidate.id, rightCandidate.id],
          outcome: "retained",
          anchors: structured,
          reason: `Anchors found (${anchorStrings.join(", ")}), but merging would join distinct entities `
            + `(${[...leftIdentity!].join(", ")} / ${[...rightIdentity!].join(", ")}) through a shared candidate.`,
        });
        continue;
      }

      const leftPages = pageIdentities.get(leftRoot);
      const rightPages = pageIdentities.get(rightRoot);
      if (leftRoot !== rightRoot && entitiesConflict(leftPages, rightPages)) {
        mergeDecisions.push({
          candidateIds: [leftCandidate.id, rightCandidate.id],
          outcome: "retained",
          anchors: structured,
          reason: `Anchors found (${anchorStrings.join(", ")}), but merging would join distinct pages `
            + `(${[...leftPages!].join(", ")} / ${[...rightPages!].join(", ")}) through a shared candidate.`,
        });
        continue;
      }

      unionFind.union(left, right);
      const mergedRoot = unionFind.find(left);
      if (leftPages || rightPages) {
        pageIdentities.set(mergedRoot, new Set([...(leftPages ?? []), ...(rightPages ?? [])]));
        for (const staleRoot of [leftRoot, rightRoot]) {
          if (staleRoot !== mergedRoot) pageIdentities.delete(staleRoot);
        }
      }
      if (leftIdentity || rightIdentity) {
        entityIdentities.set(mergedRoot, new Set([...(leftIdentity ?? []), ...(rightIdentity ?? [])]));
        for (const staleRoot of [leftRoot, rightRoot]) {
          if (staleRoot !== mergedRoot) entityIdentities.delete(staleRoot);
        }
      }
      anchorsByPair.set(`${left}:${right}`, anchorStrings);
      structuredAnchorsByPair.set(`${left}:${right}`, structured);
      mergeDecisions.push({
        candidateIds: [leftCandidate.id, rightCandidate.id],
        outcome: "merged",
        anchors: structured,
        reason: `Merged by hard anchors: ${anchorStrings.join(", ")}.`,
      });
    }
  }

  const componentIndexes = new Map<number, number[]>();
  deterministicCandidates.forEach((_, index) => {
    const root = unionFind.find(index);
    const indexes = componentIndexes.get(root) ?? [];
    indexes.push(index);
    componentIndexes.set(root, indexes);
  });

  const clusters = [...componentIndexes.values()]
    .map((indexes) => createCluster(indexes, deterministicCandidates, anchorsByPair))
    .sort((left, right) => left.id.localeCompare(right.id));

  return { clusters, rejectedCandidateIds, mergeDecisions };
}

/** Project only deterministic clusters to the established public snapshot shape. */
export function projectFeatureCandidates(clusters: FeatureCluster[]): FeatureInfo[] {
  return clusters
    .filter((cluster) => cluster.candidates.some((candidate) => candidate.source !== "ai"))
    .map((cluster) => {
      const projection = projectCompatibilityFeature(cluster);
      if (projection) return projection;

      const files = uniqueSorted(cluster.candidates.flatMap((candidate) => candidate.files));
      const searchTerms = uniqueSorted(cluster.candidates.flatMap((candidate) => [
        ...candidate.entityNames,
        ...candidate.routePaths.map(routeResource),
      ]).filter(Boolean));
      const evidence = uniqueSorted(cluster.candidates.flatMap((candidate) =>
        candidate.evidence.flatMap((item) => item.files)
      ));

      return {
        name: cluster.canonicalLabel,
        purpose: `Deterministic ${cluster.canonicalLabel} feature cluster.`,
        files,
        entryPoints: [],
        businessFlow: [],
        searchTerms,
        confidence: clusterConfidence(cluster.candidates),
        evidence,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function projectCompatibilityFeature(cluster: FeatureCluster): FeatureInfo | undefined {
  const canonical = cluster.candidates.find(
    (candidate) => candidate.id === cluster.canonicalCandidateId
  )?.projection;
  if (!canonical) return undefined;

  const projections = cluster.candidates
    .map((candidate) => candidate.projection)
    .filter((candidate): candidate is FeatureInfo => Boolean(candidate));
  const files = uniqueSorted(projections.flatMap((feature) => feature.files));
  const evidence = uniqueSorted(projections.flatMap((feature) => feature.evidence));
  const entryPoints = uniqueSorted(projections.flatMap((feature) => feature.entryPoints));
  const searchTerms = uniqueSorted(projections.flatMap((feature) => feature.searchTerms)).slice(0, 8);

  return {
    ...canonical,
    files,
    evidence,
    entryPoints,
    ...(entryPoints[0] ? { entryPoint: entryPoints[0] } : {}),
    searchTerms,
    confidence: clusterConfidence(cluster.candidates),
  };
}

function createCluster(
  indexes: number[],
  candidates: FeatureCandidate[],
  anchorsByPair: Map<string, string[]>
): FeatureCluster {
  const members = indexes.map((index) => candidates[index]).sort((left, right) => left.id.localeCompare(right.id));
  const canonical = [...members].sort(compareCanonicalCandidates)[0];
  const anchors = uniqueSorted(indexes.flatMap((left) => indexes.flatMap((right) =>
    left < right ? anchorsByPair.get(`${left}:${right}`) ?? [] : []
  )));

  return {
    id: `cluster:${members.map((candidate) => candidate.id).join("|")}`,
    canonicalCandidateId: canonical.id,
    canonicalLabel: canonical.label,
    aliases: uniqueSorted(members.map((candidate) => candidate.label).filter((label) => label !== canonical.label)),
    candidates: members,
    memberIds: members.map((candidate) => candidate.id),
    anchors,
    decisionRationale: anchors.length === 0
      ? "Single candidate retained because no hard anchor connected it to another candidate."
      : `Merged by hard anchors: ${anchors.join(", ")}. Canonical label selected by source priority, evidence reliability, and candidate ID.`,
  };
}

function compareCanonicalCandidates(left: FeatureCandidate, right: FeatureCandidate): number {
  const source = SOURCE_PRIORITY[right.source] - SOURCE_PRIORITY[left.source];
  if (source !== 0) return source;

  const reliability = highestReliability(right.evidence) - highestReliability(left.evidence);
  if (reliability !== 0) return reliability;

  const evidence = right.evidence.length - left.evidence.length;
  if (evidence !== 0) return evidence;

  return left.id.localeCompare(right.id);
}

function findHardAnchors(left: FeatureCandidate, right: FeatureCandidate): string[] {
  return findStructuredAnchors(left, right).map((a) => `${a.type}:${a.value}`);
}

function findStructuredAnchors(
  left: FeatureCandidate,
  right: FeatureCandidate,
  fileReferenceCounts: Record<string, number> = {}
): Array<{ type: AnchorType; value: string }> {
  if (left.standalone || right.standalone) return [];

  // A page is an area of the product; a registry signal (auth, email, caching ...) is a
  // cross-cutting concern that many pages touch. Fusing them would let one signal glue
  // unrelated pages together and name the result after whichever page sorts first.
  const pageVsSignal =
    (isPageSource(left.source) && isSignalCandidate(right))
    || (isPageSource(right.source) && isSignalCandidate(left));
  if (pageVsSignal) {
    // Only a page that carries the signal's own name is the same feature ("Search").
    return normalizeAnchor(left.label) === normalizeAnchor(right.label)
      ? [{ type: "alias" as const, value: normalizeAnchor(left.label) }]
      : [];
  }

  // Two different pages are two features, however many components they share.
  const bothPages = isPageSource(left.source) && isPageSource(right.source);
  const entityAnchors = intersection(left.entityNames, right.entityNames)
    .map((entity) => ({ type: "entity" as const, value: entity }));
  const fileAnchors = bothPages ? [] : intersection(left.files, right.files)
    .filter((file) => (fileReferenceCounts[file] ?? 0) <= HUB_FILE_THRESHOLD)
    .map((file) => ({ type: "file" as const, value: file }));
  const routeAnchors = intersection(
    left.routePaths.map(routeResource).filter(Boolean),
    right.routePaths.map(routeResource).filter(Boolean),
  ).map((resource) => ({ type: "route-resource" as const, value: resource }));

  return [...entityAnchors, ...fileAnchors, ...routeAnchors];
}

/** A vocabulary signal (Authentication, Email ...), as opposed to a role feature such as Documentation. */
function isSignalCandidate(candidate: FeatureCandidate): boolean {
  return candidate.source === "registry" && !candidate.id.includes(":role-");
}

function isPageSource(source: FeatureCandidateSource): boolean {
  return source === "frontend-page" || source === "client-route";
}

/** Entity names a candidate vouches for. Only entity-sourced candidates define identity. */
function entityIdentity(candidate: FeatureCandidate): Set<string> {
  if (candidate.source !== "entity") return new Set();
  return new Set(candidate.entityNames.map(normalizeAnchor).filter(Boolean));
}

/** Two clusters conflict when both name entities and share none of them. */
function entitiesConflict(left: Set<string> | undefined, right: Set<string> | undefined): boolean {
  if (!left || !right || left.size === 0 || right.size === 0) return false;
  for (const name of left) {
    if (right.has(name)) return false;
  }
  return true;
}

function routeResource(routePath: string): string {
  const parts = routePath
    .split("/")
    .filter(Boolean)
    .filter((part) => part !== "api" && !part.startsWith("[") && !part.startsWith(":"));
  return parts[0]?.toLowerCase() ?? "";
}

function normalizeCandidate(candidate: FeatureCandidate): FeatureCandidate {
  return {
    ...candidate,
    evidence: candidate.evidence.map((item) => ({
      ...item,
      files: uniqueSorted(item.files),
      ...(item.routePaths ? { routePaths: uniqueSorted(item.routePaths) } : {}),
      ...(item.entityNames ? { entityNames: uniqueSorted(item.entityNames) } : {}),
    })).sort((left, right) => left.ruleId.localeCompare(right.ruleId)),
    files: uniqueSorted(candidate.files),
    routePaths: uniqueSorted(candidate.routePaths),
    entityNames: uniqueSorted(candidate.entityNames),
  };
}

function clusterConfidence(candidates: FeatureCandidate[]): FeatureCandidate["conclusionConfidence"] {
  const corroboratedSources = new Set(candidates.map((candidate) => candidate.source));
  const hasHighConclusion = candidates.some((candidate) => candidate.conclusionConfidence === "high");
  if (hasHighConclusion && corroboratedSources.size >= 2) return "high";

  return candidates
    .map((candidate) => candidate.conclusionConfidence)
    .sort((left, right) => CONFIDENCE_PRIORITY[right] - CONFIDENCE_PRIORITY[left])[0] ?? "low";
}

function highestReliability(evidence: FeatureEvidence[]): number {
  return Math.max(0, ...evidence.map((item) => RELIABILITY_PRIORITY[item.reliability]));
}

function intersection(left: string[], right: string[]): string[] {
  const rightSet = new Set(right.map(normalizeAnchor));
  return left.filter((value) => rightSet.has(normalizeAnchor(value)));
}

function normalizeAnchor(value: string): string {
  return value.trim().toLowerCase();
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

class UnionFind {
  private readonly parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }

  find(index: number): number {
    if (this.parent[index] !== index) {
      this.parent[index] = this.find(this.parent[index]);
    }
    return this.parent[index];
  }

  union(left: number, right: number): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) return;

    if (leftRoot < rightRoot) {
      this.parent[rightRoot] = leftRoot;
    } else {
      this.parent[leftRoot] = rightRoot;
    }
  }
}
