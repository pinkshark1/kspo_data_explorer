import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildGraphModel,
  buildHighlight,
  emptyHighlight,
  linkKey,
  nodeMatchesQuery,
  nodeRadius,
  summarizePath,
} from "../lib/graphModel.js";

const GOLDEN_ANGLE = 2.399963; // 노드를 나선형으로 흩뿌릴 때 쓰는 각도(라디안)
const CELL_SIZE = 72; // 반발력 계산용 격자 크기(px)
const LINK_LENGTH = { sf: 155, sd: 92, fd: 62 }; // 링크 종류별 목표 길이
const MIN_SCALE = 0.22;
const MAX_SCALE = 4.8;

// 힘 기반(force-directed) 배치를 한 단계 진행한다.
function stepPhysics({ nodes, links, nodeById, energy, width, height, draggedNode }) {
  const grid = new Map();
  nodes.forEach((node) => {
    const cell = `${Math.floor(node.x / CELL_SIZE)},${Math.floor(node.y / CELL_SIZE)}`;
    if (!grid.has(cell)) grid.set(cell, []);
    grid.get(cell).push(node);
  });

  // 가까운 노드끼리 서로 밀어낸다.
  nodes.forEach((node) => {
    const cellX = Math.floor(node.x / CELL_SIZE);
    const cellY = Math.floor(node.y / CELL_SIZE);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        grid.get(`${cellX + dx},${cellY + dy}`)?.forEach((other) => {
          if (other === node) return;
          const diffX = node.x - other.x;
          const diffY = node.y - other.y;
          const distSq = diffX * diffX + diffY * diffY || 1;
          if (distSq < 17000) {
            const force = ((node.type === "data" ? 520 : 1800) / distSq) * energy;
            node.vx += diffX * force;
            node.vy += diffY * force;
          }
        });
      }
    }
  });

  // 링크는 목표 길이로 당기는 스프링
  links.forEach((link) => {
    const source = nodeById.get(link.source);
    const target = nodeById.get(link.target);
    if (!source || !target) return;
    const diffX = target.x - source.x;
    const diffY = target.y - source.y;
    const distance = Math.sqrt(diffX * diffX + diffY * diffY) || 1;
    const pull = ((distance - (LINK_LENGTH[link.type] ?? 62)) / distance) * 0.021 * energy;
    source.vx += diffX * pull;
    source.vy += diffY * pull;
    target.vx -= diffX * pull;
    target.vy -= diffY * pull;
  });

  // 화면 중심으로 약하게 모으고, 속도를 감쇠시키며 위치를 갱신
  nodes.forEach((node) => {
    node.vx += (width / 2 - node.x) * 9e-4 * energy;
    node.vy += (height / 2 - node.y) * 9e-4 * energy;
    if (node !== draggedNode) {
      node.vx *= 0.86;
      node.vy *= 0.86;
      node.x += node.vx;
      node.y += node.vy;
    }
  });
}

const nodeColor = (node) => (node.type === "sys" ? "#2f6fed" : node.type === "field" ? "#f09a2b" : node.status === "개방" ? "#1eaa6f" : "#9ba8a5");

function drawFrame(ctx, { nodes, links, nodeById, size, view, highlight, expandedFields, phase }) {
  const { width, height, dpr } = size;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(view.x, view.y);
  ctx.scale(view.k, view.k);

  // 배경 점 격자 (보이는 영역만)
  const left = -view.x / view.k;
  const top = -view.y / view.k;
  const right = left + width / view.k;
  const bottom = top + height / view.k;
  ctx.fillStyle = "rgba(108, 129, 126, .16)";
  for (let x = Math.floor(left / 28) * 28; x < right; x += 28) {
    for (let y = Math.floor(top / 28) * 28; y < bottom; y += 28) {
      ctx.beginPath();
      ctx.arc(x, y, 0.75 / view.k, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const hasHighlight = highlight.matches.size > 0;

  // 링크
  links.forEach((link) => {
    const source = nodeById.get(link.source);
    const target = nodeById.get(link.target);
    if (!source || !target) return;
    const visibility = Math.min(source.appear, target.appear);
    if (visibility <= 0.01) return;
    const lit = highlight.links.has(linkKey(link.source, link.target));
    ctx.globalAlpha = (hasHighlight ? (lit ? 0.92 : 0.055) : link.type === "sf" ? 0.3 : 0.2) * visibility;
    ctx.beginPath();
    ctx.moveTo(source.x, source.y);
    ctx.lineTo(target.x, target.y);
    if (lit) {
      ctx.strokeStyle = "#f3a712";
      ctx.lineWidth = link.type === "sf" ? 2.5 : 1.7;
      ctx.setLineDash([6, 6]);
      ctx.lineDashOffset = -phase;
    } else {
      ctx.strokeStyle = link.type === "sf" ? "#8ca3a0" : "#b7c8c5";
      ctx.lineWidth = link.type === "sf" ? Math.min(4, 1 + link.weight * 0.22) : 0.75;
      ctx.setLineDash([]);
    }
    ctx.stroke();
  });
  ctx.setLineDash([]);

  // 강조된 링크 위를 흐르는 점
  if (hasHighlight) {
    links.forEach((link) => {
      if (!highlight.links.has(linkKey(link.source, link.target))) return;
      const source = nodeById.get(link.source);
      const target = nodeById.get(link.target);
      if (!source || !target) return;
      const visibility = Math.min(source.appear, target.appear);
      if (visibility <= 0.01) return;
      for (let i = 0; i < 2; i += 1) {
        const t = (phase / 60 + i * 0.5) % 1;
        ctx.beginPath();
        ctx.arc(source.x + (target.x - source.x) * t, source.y + (target.y - source.y) * t, 2.5 * visibility, 0, Math.PI * 2);
        ctx.fillStyle = "#f8bd32";
        ctx.globalAlpha = visibility;
        ctx.fill();
      }
    });
  }

  // 노드와 라벨
  nodes.forEach((node) => {
    if (node.appear <= 0.01) return;
    const eased = 1 - (1 - node.appear) ** 3;
    const radius = nodeRadius(node) * (0.68 + eased * 0.32);
    const isMatch = highlight.matches.has(node.id);
    const isLinked = highlight.nodes.has(node.id);
    const dimmed = hasHighlight && !isMatch && !isLinked;

    ctx.globalAlpha = (dimmed ? 0.14 : 1) * eased;
    if (isMatch) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius + 7, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(250, 191, 39, .32)";
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = nodeColor(node);
    ctx.fill();
    ctx.lineWidth = isMatch ? 2.5 : node.type === "field" && node.field && expandedFields.has(node.field) ? 2 : 1.5;
    ctx.strokeStyle = isMatch ? "#e6a300" : "rgba(255,255,255,.92)";
    ctx.stroke();

    if (node.type !== "data" || view.k > 1.35 || isMatch) {
      let label = node.label;
      if (node.type === "data" && label.length > 17) label = `${label.slice(0, 16)}…`;
      ctx.globalAlpha = (dimmed ? 0.18 : 0.96) * eased;
      ctx.font = `${node.type === "sys" ? "650" : "550"} ${node.type === "data" ? 9 : 11}px Pretendard, "Noto Sans KR", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = "rgba(250,252,252,.96)";
      ctx.strokeText(label, node.x, node.y - radius - 4);
      ctx.fillStyle = "#172825";
      ctx.fillText(label, node.x, node.y - radius - 4);
    }
  });

  ctx.globalAlpha = 1;
  ctx.restore();
}

export default function RelationshipGraph({ title, datasets, onOpenDataset }) {
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const allNodesRef = useRef([]); // 모든 노드(접힌 데이터 노드 포함)
  const nodeByIdRef = useRef(new Map());
  const visibleNodesRef = useRef([]); // 시뮬레이션·그리기 대상 노드
  const visibleLinksRef = useRef([]);
  const highlightRef = useRef(emptyHighlight());
  const energyRef = useRef(0.95); // 0에 가까워지면 배치가 멈춘다
  const viewRef = useRef({ x: 0, y: 0, k: 1 });
  const sizeRef = useRef({ width: 900, height: 650, dpr: 1 });
  const dragRef = useRef({ node: null, panning: false, moved: false, downX: 0, downY: 0, lastX: 0, lastY: 0 });
  const onOpenDatasetRef = useRef(onOpenDataset);
  onOpenDatasetRef.current = onOpenDataset;
  const zoomByRef = useRef(() => {});

  const [expandedFields, setExpandedFields] = useState(new Set());
  const [query, setQuery] = useState("");
  const [tooltip, setTooltip] = useState(null);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [stats, setStats] = useState({ nodes: 0, links: 0 });

  const model = useMemo(() => buildGraphModel(datasets), [datasets]);

  const suggestions = useMemo(() => {
    const needle = query.trim();
    return needle
      ? model.nodes
          .filter((node) => nodeMatchesQuery(node, needle))
          .sort((a, b) => a.type.localeCompare(b.type) || b.count - a.count)
          .slice(0, 12)
      : [];
  }, [model.nodes, query]);

  const pathSummary = useMemo(() => summarizePath(model, query), [model, query]);

  const applyHighlight = (matchedNodes) => {
    highlightRef.current = buildHighlight(model, matchedNodes);
    if (matchedNodes.length) energyRef.current = Math.max(energyRef.current, 0.28);
  };

  // 펼친 분야가 바뀌면 보이는 노드·링크를 다시 계산하고, 새로 나타나는 데이터 노드는 분야 노드 주변에 배치한다.
  useEffect(() => {
    const previouslyVisible = new Set(visibleNodesRef.current.map((node) => node.id));
    const previousById = new Map(allNodesRef.current.map((node) => [node.id, node]));
    const { width, height } = sizeRef.current;

    allNodesRef.current = model.nodes.map((node, index) => {
      const previous = previousById.get(node.id);
      if (previous) {
        return { ...previous, ...node, appear: previous.appear ?? (node.type === "data" ? 0 : 1), revealAt: previous.revealAt ?? 0 };
      }
      const angle = index * GOLDEN_ANGLE;
      const spread = Math.min(width, height) * (0.1 + (index % 21) / 32);
      return {
        ...node,
        x: width / 2 + Math.cos(angle) * spread,
        y: height / 2 + Math.sin(angle) * spread,
        vx: 0,
        vy: 0,
        appear: node.type === "data" ? 0 : 1,
        revealAt: 0,
      };
    });

    const visibleIds = new Set(
      allNodesRef.current.filter((node) => node.type !== "data" || (node.field && expandedFields.has(node.field))).map((node) => node.id),
    );
    visibleNodesRef.current = allNodesRef.current.filter((node) => visibleIds.has(node.id));
    visibleLinksRef.current = model.links.filter((link) => link.type === "sf" || (visibleIds.has(link.source) && visibleIds.has(link.target)));

    const now = performance.now();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const byId = new Map(allNodesRef.current.map((node) => [node.id, node]));
    nodeByIdRef.current = byId;

    const newlyShown = visibleNodesRef.current
      .filter((node) => node.type === "data" && !previouslyVisible.has(node.id))
      .sort((a, b) => (a.field ?? "").localeCompare(b.field ?? "", "ko") || Number(a.record?.no ?? 0) - Number(b.record?.no ?? 0));

    newlyShown.forEach((node, index) => {
      const fieldNode = node.field ? byId.get(`f:${node.field}`) : null;
      const systemNode = node.record?.sys ? byId.get(`s:${node.record.sys}`) : null;
      const baseX = fieldNode && systemNode ? fieldNode.x * 0.68 + systemNode.x * 0.32 : (fieldNode?.x ?? width / 2);
      const baseY = fieldNode && systemNode ? fieldNode.y * 0.68 + systemNode.y * 0.32 : (fieldNode?.y ?? height / 2);
      const angle = index * GOLDEN_ANGLE;
      const spread = 5 + (index % 4) * 2;
      node.x = baseX + Math.cos(angle) * spread;
      node.y = baseY + Math.sin(angle) * spread;
      node.vx = 0;
      node.vy = 0;
      node.appear = reduceMotion ? 1 : 0;
      node.revealAt = reduceMotion ? now : now + index * 12;
    });
    allNodesRef.current
      .filter((node) => node.type === "data" && !visibleIds.has(node.id))
      .forEach((node) => {
        node.appear = 0;
        node.revealAt = 0;
      });

    energyRef.current = newlyShown.length ? 0.46 : 0.32;
    setStats({ nodes: visibleNodesRef.current.length, links: visibleLinksRef.current.length });
  }, [expandedFields, model]);

  // 검색어가 바뀌면 일치 노드와 연결 경로를 강조
  useEffect(() => {
    applyHighlight(query.trim() ? model.nodes.filter((node) => nodeMatchesQuery(node, query)) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // 캔버스 그리기 루프와 마우스·터치 조작
  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return undefined;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    const resize = () => {
      const rect = stage.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      sizeRef.current = { width: rect.width, height: rect.height, dpr };
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      energyRef.current = Math.max(energyRef.current, 0.35);
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(stage);

    let frameId = 0;
    let phase = 0; // 강조 링크 점선이 흐르는 애니메이션 위상
    const frame = () => {
      const now = performance.now();
      const { width, height } = sizeRef.current;
      const nodes = visibleNodesRef.current;
      const nodeById = nodeByIdRef.current;

      if (energyRef.current > 0.004) {
        energyRef.current *= 0.988;
        stepPhysics({
          nodes,
          links: visibleLinksRef.current,
          nodeById,
          energy: energyRef.current,
          width,
          height,
          draggedNode: dragRef.current.node,
        });
      }
      nodes.forEach((node) => {
        if (node.appear < 1 && now >= node.revealAt) node.appear = Math.min(1, node.appear + 0.042);
      });

      drawFrame(ctx, {
        nodes,
        links: visibleLinksRef.current,
        nodeById,
        size: sizeRef.current,
        view: viewRef.current,
        highlight: highlightRef.current,
        expandedFields,
        phase,
      });
      phase += highlightRef.current.matches.size > 0 ? 1.15 : 0;
      frameId = requestAnimationFrame(frame);
    };
    frameId = requestAnimationFrame(frame);

    const pointerPosition = (event) => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const toWorld = (x, y) => ({ x: (x - viewRef.current.x) / viewRef.current.k, y: (y - viewRef.current.y) / viewRef.current.k });
    const nodeAt = (x, y) => {
      const world = toWorld(x, y);
      let found = null;
      let best = Infinity;
      visibleNodesRef.current.forEach((node) => {
        if (node.appear < 0.62) return;
        const dx = world.x - node.x;
        const dy = world.y - node.y;
        const distSq = dx * dx + dy * dy;
        const hit = nodeRadius(node) + 5 / viewRef.current.k;
        if (distSq < hit * hit && distSq < best) {
          found = node;
          best = distSq;
        }
      });
      return found;
    };

    const zoomAt = (x, y, factor) => {
      const view = viewRef.current;
      const nextK = Math.max(MIN_SCALE, Math.min(MAX_SCALE, view.k * factor));
      view.x = x - (x - view.x) * (nextK / view.k);
      view.y = y - (y - view.y) * (nextK / view.k);
      view.k = nextK;
      setZoomPercent(Math.round(nextK * 100));
    };

    // 터치 두 손가락 확대·축소(pinch)를 위해 활성 포인터를 기억한다.
    const pointers = new Map();
    let pinchDistance = 0;
    const pinchState = () => {
      const [a, b] = [...pointers.values()];
      return { distance: Math.hypot(a.x - b.x, a.y - b.y), centerX: (a.x + b.x) / 2, centerY: (a.y + b.y) / 2 };
    };

    // 손가락 두 개를 넘는 입력은 무시한다. (세 번째 손가락이 새 드래그를 시작하지 않게)
    const onPointerDown = (event) => {
      if (pointers.size >= 2) return;
      const position = pointerPosition(event);
      pointers.set(event.pointerId, position);
      canvas.setPointerCapture(event.pointerId);
      if (pointers.size === 2) {
        pinchDistance = pinchState().distance;
        dragRef.current = { node: null, panning: false, moved: true, downX: 0, downY: 0, lastX: 0, lastY: 0 };
        return;
      }
      const node = nodeAt(position.x, position.y);
      dragRef.current = {
        node,
        panning: !node,
        moved: false,
        downX: position.x,
        downY: position.y,
        lastX: position.x,
        lastY: position.y,
      };
      canvas.classList.add("is-grabbing");
    };

    const onPointerMove = (event) => {
      const position = pointerPosition(event);
      if (pointers.has(event.pointerId)) pointers.set(event.pointerId, position);
      if (pointers.size === 2) {
        const { distance, centerX, centerY } = pinchState();
        if (pinchDistance > 0) zoomAt(centerX, centerY, distance / pinchDistance);
        pinchDistance = distance;
        return;
      }
      const drag = dragRef.current;
      if (Math.abs(position.x - drag.downX) + Math.abs(position.y - drag.downY) > 4) drag.moved = true;
      if (drag.node) {
        const world = toWorld(position.x, position.y);
        drag.node.x = world.x;
        drag.node.y = world.y;
        drag.node.vx = 0;
        drag.node.vy = 0;
        energyRef.current = Math.max(energyRef.current, 0.28);
        setTooltip(null);
      } else if (drag.panning) {
        viewRef.current.x += position.x - drag.lastX;
        viewRef.current.y += position.y - drag.lastY;
      } else {
        const hovered = nodeAt(position.x, position.y);
        setTooltip(hovered ? { node: hovered, x: position.x, y: position.y } : null);
        canvas.classList.toggle("is-node", !!hovered);
      }
      drag.lastX = position.x;
      drag.lastY = position.y;
    };

    const onPointerUp = (event) => {
      const wasPinching = pointers.size === 2;
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinchDistance = 0;
      const drag = dragRef.current;
      if (drag.node && !drag.moved) {
        const node = drag.node;
        setQuery(node.label);
        if (node.type === "field") {
          setExpandedFields((current) => {
            const next = new Set(current);
            if (next.has(node.label)) next.delete(node.label);
            else next.add(node.label);
            return next;
          });
        } else if (node.type === "data" && node.record) {
          onOpenDatasetRef.current(node.record);
        }
      }
      if (wasPinching && pointers.size === 1) {
        // 핀치가 끝난 뒤에도 손가락이 하나 남아 있으면 그대로 화면 이동(pan)으로 이어간다.
        const [rest] = [...pointers.values()];
        dragRef.current = { node: null, panning: true, moved: true, downX: rest.x, downY: rest.y, lastX: rest.x, lastY: rest.y };
      } else {
        dragRef.current.node = null;
        dragRef.current.panning = false;
        if (pointers.size === 0) canvas.classList.remove("is-grabbing");
      }
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };

    // 포인터가 사라졌는데 pointerup 이 오지 않은 경우(앱 전환, 탭 이동 등)에 남은 기록을 비운다.
    const clearPointers = () => {
      pointers.clear();
      pinchDistance = 0;
      dragRef.current.node = null;
      dragRef.current.panning = false;
      canvas.classList.remove("is-grabbing");
    };
    const onLostPointerCapture = (event) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinchDistance = 0;
    };
    const onVisibilityChange = () => {
      if (document.hidden) clearPointers();
    };

    const onWheel = (event) => {
      event.preventDefault();
      const position = pointerPosition(event);
      zoomAt(position.x, position.y, event.deltaY < 0 ? 1.12 : 0.89);
    };
    const onPointerLeave = () => setTooltip(null);

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("lostpointercapture", onLostPointerCapture);
    window.addEventListener("blur", clearPointers);
    document.addEventListener("visibilitychange", onVisibilityChange);

    // 확대·축소 버튼(마우스 휠이 없는 터치 환경용)이 같은 함수를 쓰도록 노출
    zoomByRef.current = (factor) => zoomAt(sizeRef.current.width / 2, sizeRef.current.height / 2, factor);

    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(frameId);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("lostpointercapture", onLostPointerCapture);
      window.removeEventListener("blur", clearPointers);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      zoomByRef.current = () => {};
    };
  }, [expandedFields]);

  const focusNode = (node) => {
    if (node.type === "data" && node.field) setExpandedFields((current) => new Set([...current, node.field]));
    setQuery(node.label);
    applyHighlight([node]);
    window.setTimeout(() => {
      const target = allNodesRef.current.find((candidate) => candidate.id === node.id);
      if (!target) return;
      const { width, height } = sizeRef.current;
      viewRef.current = { x: width / 2 - target.x * 1.6, y: height / 2 - target.y * 1.6, k: 1.6 };
      setZoomPercent(160);
    }, 40);
  };

  const clearSearch = () => {
    setQuery("");
    highlightRef.current = emptyHighlight();
  };

  const rearrange = () => {
    const { width, height } = sizeRef.current;
    visibleNodesRef.current.forEach((node, index) => {
      const angle = index * GOLDEN_ANGLE + Math.random() * 0.4;
      const spread = Math.min(width, height) * (0.08 + Math.random() * 0.38);
      node.x = width / 2 + Math.cos(angle) * spread;
      node.y = height / 2 + Math.sin(angle) * spread;
      node.vx = 0;
      node.vy = 0;
    });
    viewRef.current = { x: 0, y: 0, k: 1 };
    setZoomPercent(100);
    energyRef.current = 0.96;
  };

  const zoomBy = (factor) => zoomByRef.current(factor);

  return (
    <section className="relationship-panel obsidian-graph">
      <div className="relationship-head">
        <div>
          <span className="kicker">데이터 연결 구조</span>
          <h2>연계 관계도</h2>
          <p>정보시스템 · 데이터 분야 · 개별 데이터의 연결을 자유롭게 이동하며 탐색합니다.</p>
        </div>
        <div className="graph-counts">
          <span>
            <b>{model.systems.length}</b> 시스템
          </span>
          <span>
            <b>{model.fields.length}</b> 분야
          </span>
          <span>
            <b>{datasets.length}</b> 데이터
          </span>
        </div>
      </div>
      <div className="graph-stage obsidian-stage" ref={stageRef}>
        <canvas ref={canvasRef} aria-label={`${title} 관계도 (시스템·분야·데이터 연결)`} />
        <div className="graph-toolbar floating-toolbar">
          <div className="graph-search">
            <span aria-hidden="true">⌕</span>
            <input
              aria-label="관계도 노드 검색"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="노드 검색 (시스템·분야·데이터)"
            />
            {query && (
              <button aria-label="검색어 지우기" onClick={clearSearch}>
                ×
              </button>
            )}
            {query && suggestions.length > 0 && (
              <div className="graph-suggestions">
                <div className="suggestion-summary">일치하는 노드 {suggestions.length}개</div>
                {suggestions.map((node) => (
                  <button key={node.id} onClick={() => focusNode(node)}>
                    <i className={node.type} />
                    <span>{node.label}</span>
                    <small>{node.type === "sys" || node.type === "field" ? `${node.count}건` : node.field}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => setExpandedFields(new Set(model.fields))}>전체 데이터 펼치기</button>
          <button onClick={() => setExpandedFields(new Set())}>데이터 접기</button>
          <button onClick={rearrange}>배치 다시 정렬</button>
          {query && <button onClick={clearSearch}>강조 해제</button>}
          <div className="zoom-controls" role="group" aria-label="관계도 확대·축소">
            <button aria-label="확대" onClick={() => zoomBy(1.25)}>
              ＋
            </button>
            <button aria-label="축소" onClick={() => zoomBy(0.8)}>
              －
            </button>
          </div>
        </div>
        <div className="graph-runtime-stat">
          노드 {stats.nodes} · 링크 {stats.links} · 확대 {zoomPercent}%
        </div>
        <div className="graph-legend">
          <span>
            <i className="sys" />
            정보시스템 <small>원 크기 = 데이터 수</small>
          </span>
          <span>
            <i className="field" />
            데이터 분야 <small>클릭하면 데이터 펼침</small>
          </span>
          <span>
            <i className="data" />
            개별 데이터
          </span>
        </div>
        {query && (
          <div className="path-card graph-path-summary">
            <b>연관 경로</b>
            <span>
              시스템 {pathSummary.sys} → 분야 {pathSummary.field} → 데이터 {pathSummary.data}
            </span>
            <small>강조된 노드와 선을 따라 연결 관계를 확인하세요.</small>
          </div>
        )}
        {tooltip && (
          <div className="graph-tooltip" style={{ left: tooltip.x + 14, top: tooltip.y + 14 }}>
            <b>{tooltip.node.label}</b>
            <span>{tooltip.node.type === "sys" ? "정보시스템" : tooltip.node.type === "field" ? "데이터 분야" : tooltip.node.status}</span>
          </div>
        )}
        <div className="graph-help">드래그로 이동 · 휠 또는 두 손가락으로 확대/축소 · 노드를 잡아 배치</div>
      </div>
    </section>
  );
}
