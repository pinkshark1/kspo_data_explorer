// 관계도(정보시스템 - 데이터 분야 - 개별 데이터)의 노드·링크 모델과 탐색 보조 함수.

// 두 노드 id 를 순서와 무관한 하나의 링크 키로 만든다.
export const linkKey = (a, b) => [a, b].sort().join("\0");

export const emptyHighlight = () => ({ nodes: new Set(), links: new Set(), matches: new Set() });

const byKorean = (a, b) => a.localeCompare(b, "ko");

export function buildGraphModel(datasets) {
  const systems = [...new Set(datasets.map((dataset) => dataset.sys))].sort(byKorean);
  const fields = [...new Set(datasets.map((dataset) => dataset.field))].sort(byKorean);

  const nodes = [
    ...systems.map((name) => ({
      id: `s:${name}`,
      label: name,
      type: "sys",
      count: datasets.filter((dataset) => dataset.sys === name).length,
    })),
    ...fields.map((name) => ({
      id: `f:${name}`,
      label: name,
      type: "field",
      count: datasets.filter((dataset) => dataset.field === name).length,
      field: name,
    })),
    ...datasets.map((dataset) => ({
      id: `d:${dataset.no}`,
      label: dataset.name,
      type: "data",
      count: 1,
      field: dataset.field,
      status: dataset.status,
      record: dataset,
    })),
  ];

  // 시스템-분야 링크는 같은 쌍의 데이터 수만큼 굵게(weight), 데이터 링크는 시스템·분야에서 각각 1개씩
  const systemFieldWeights = new Map();
  datasets.forEach((dataset) => {
    const key = linkKey(`s:${dataset.sys}`, `f:${dataset.field}`);
    systemFieldWeights.set(key, (systemFieldWeights.get(key) ?? 0) + 1);
  });

  const links = [];
  systemFieldWeights.forEach((weight, key) => {
    const [source, target] = key.split("\0");
    links.push({ source, target, type: "sf", weight });
  });
  datasets.forEach((dataset) => {
    links.push({ source: `f:${dataset.field}`, target: `d:${dataset.no}`, type: "fd", weight: 1 });
    links.push({ source: `s:${dataset.sys}`, target: `d:${dataset.no}`, type: "sd", weight: 1 });
  });

  const adjacency = new Map();
  links.forEach((link) => {
    if (!adjacency.has(link.source)) adjacency.set(link.source, new Set());
    if (!adjacency.has(link.target)) adjacency.set(link.target, new Set());
    adjacency.get(link.source).add(link.target);
    adjacency.get(link.target).add(link.source);
  });

  return { systems, fields, nodes, links, adjacency };
}

export const nodeMatchesQuery = (node, query) => {
  const needle = query.trim().toLocaleLowerCase("ko");
  return !!needle && node.label.toLocaleLowerCase("ko").includes(needle);
};

// 시작 노드에서 2단계(시스템→분야→데이터 또는 그 반대)까지 이어진 노드와 링크를 찾는다.
export function collectNeighborhood(model, startNodes, onLink) {
  const reached = new Set();
  startNodes.forEach((start) => {
    const queue = [[start.id, 0]];
    const seen = new Set([start.id]);
    reached.add(start.id);
    while (queue.length) {
      const [id, depth] = queue.shift();
      if (depth >= 2) continue;
      model.adjacency.get(id)?.forEach((neighbor) => {
        reached.add(neighbor);
        onLink?.(id, neighbor);
        if (!seen.has(neighbor)) {
          seen.add(neighbor);
          queue.push([neighbor, depth + 1]);
        }
      });
    }
  });
  return reached;
}

export function buildHighlight(model, matchedNodes) {
  const highlight = emptyHighlight();
  if (!matchedNodes.length) return highlight;
  matchedNodes.forEach((node) => highlight.matches.add(node.id));
  const reached = collectNeighborhood(model, matchedNodes, (from, to) => highlight.links.add(linkKey(from, to)));
  reached.forEach((id) => highlight.nodes.add(id));
  return highlight;
}

// 검색어와 연결된 경로의 노드 종류별 개수 ("시스템 a → 분야 b → 데이터 c")
export function summarizePath(model, query) {
  const needle = query.trim().toLocaleLowerCase("ko");
  const reached = needle
    ? collectNeighborhood(
        model,
        model.nodes.filter((node) => node.label.toLocaleLowerCase("ko").includes(needle)),
      )
    : new Set();
  const countOf = (type) => model.nodes.filter((node) => node.type === type && reached.has(node.id)).length;
  return { sys: countOf("sys"), field: countOf("field"), data: countOf("data") };
}

export const nodeRadius = (node) =>
  node.type === "sys" ? 9 + Math.sqrt(node.count) * 2.2 : node.type === "field" ? 7 + Math.sqrt(node.count) * 1.9 : 4.2;
