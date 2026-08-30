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
export function reconcileFeatureCandidates(candidates: FeatureCandidate[]): FeatureReconciliation {
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
      const structured = findStructuredAnchors(leftCandidate, rightCandidate);
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
      unionFind.union(left, right);
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
  right: FeatureCandidate
): Array<{ type: AnchorType; value: string }> {
  const entityAnchors = intersection(left.entityNames, right.entityNames)
    .map((entity) => ({ type: "entity" as const, value: entity }));
  const fileAnchors = intersection(left.files, right.files)
    .map((file) => ({ type: "file" as const, value: file }));
  const routeAnchors = intersection(
    left.routePaths.map(routeResource).filter(Boolean),
    right.routePaths.map(routeResource).filter(Boolean),
  ).map((resource) => ({ type: "route-resource" as const, value: resource }));

  return [...entityAnchors, ...fileAnchors, ...routeAnchors];
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
