import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GamePlayer, OrdersSnapshot, ResolvedEventSnapshot, SystemSnapshot, TannhauserSnapshot } from '../../shared/types';
import { RESOURCE_DISPLAY_META, playerAccent, playerBaseColor, shortProjectLabel } from '../../shared/game';

export type BoardHighlight = 'candidate' | 'source' | 'build' | 'project-source' | 'project-target';

interface GameBoardProps {
  systems: SystemSnapshot[];
  players: GamePlayer[];
  tannhauserLinks: TannhauserSnapshot[];
  orders: OrdersSnapshot;
  resolvedEvents: ResolvedEventSnapshot[];
  localPlayerIndex: number | null;
  selectedSystemIndex: number | null;
  armedMoveSource: number | null;
  armedProjectType: string | null;
  systemHighlights: Map<number, BoardHighlight>;
  selectedMoveOrderKey: string | null;
  turnNumber: number;
  onSelectSystem: (systemIndex: number) => void;
  onSelectMoveOrder: (sourceIndex: number, targetIndex: number) => void;
  onAdjustSelectedMoveOrder: (action: 'increment' | 'decrement' | 'clear') => void;
  onCancelPlacement: (systemIndex: number | null) => void;
}

function hexPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = -Math.PI / 2 + (Math.PI / 3) * i;
    pts.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
  }
  return pts.join(' ');
}

function darken(hex: string, factor: number): string {
  const c = hex.replace('#', '');
  return `rgb(${Math.round(parseInt(c.substring(0, 2), 16) * factor)},${Math.round(parseInt(c.substring(2, 4), 16) * factor)},${Math.round(parseInt(c.substring(4, 6), 16) * factor)})`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function computeHexRadius(systems: SystemSnapshot[], systemsByIndex: Map<number, SystemSnapshot>): number {
  let minDist = Infinity;
  for (const system of systems) {
    for (const neighborIdx of system.neighbors) {
      const neighbor = systemsByIndex.get(neighborIdx);
      if (!neighbor) continue;
      const dx = system.x - neighbor.x;
      const dy = system.y - neighbor.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0 && dist < minDist) minDist = dist;
    }
  }

  if (!Number.isFinite(minDist) || minDist <= 0) return 40;
  return (minDist / Math.sqrt(3)) * 0.95;
}

function seededFloat(seed: number): number {
  return Math.abs(Math.sin(seed) * 43758.5453123) % 1;
}

function moveOrderKey(sourceIndex: number, targetIndex: number): string {
  return `${sourceIndex}:${targetIndex}`;
}

function projectAccent(type: string | null): string {
  switch (type) {
    case 'METAL':
      return 'rgba(240, 195, 95, 0.66)';
    case 'BIOMASS':
      return 'rgba(97, 226, 141, 0.66)';
    case 'ENERGY':
      return 'rgba(109, 212, 255, 0.72)';
    case 'EXOTICS':
      return 'rgba(204, 116, 255, 0.74)';
    default:
      return 'rgba(173, 187, 212, 0.38)';
  }
}

function projectAccentHex(type: string | null): string {
  switch (type) {
    case 'METAL':
      return '#f3c457';
    case 'BIOMASS':
      return '#4edb7d';
    case 'ENERGY':
      return '#56c9ff';
    case 'EXOTICS':
      return '#d05cff';
    default:
      return '#adbfd4';
  }
}

function tierOrbOffsets(tier: number, radius: number): Array<{ x: number; y: number }> {
  if (tier <= 0) return [];

  const startAngle = -Math.PI / 2;
  return Array.from({ length: tier }, (_, index) => {
    const angle = startAngle + (Math.PI * 2 * index) / tier;
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius
    };
  });
}

function combatRoundSnapshots(start: number, end: number): number[] {
  if (start <= end) return [start, end, end];
  const midpoint = Math.max(end, Math.round(start - (start - end) * 0.6));
  return [start, midpoint, end];
}

function resolvedEventSignature(events: ResolvedEventSnapshot[]): string {
  return events
    .map(event => [
      event.kind,
      event.playerIndex ?? 'n',
      event.sourceIndex ?? 'n',
      event.targetIndex ?? 'n',
      event.systemIndex ?? 'n',
      event.quantity,
      event.projectType ?? 'n',
      event.victorIndex ?? 'n',
      event.fleetsAtEnd,
      event.kills,
      event.combatants
        .map(combatant => [
          combatant.playerIndex ?? 'n',
          combatant.sourceIndex ?? 'n',
          combatant.fleetsAtStart,
          combatant.fleetsDestroyed,
          combatant.fleetsRetreated
        ].join(':'))
        .join(',')
    ].join('|'))
    .join('||');
}

export function GameBoard({
  systems,
  players,
  tannhauserLinks,
  orders,
  resolvedEvents,
  localPlayerIndex,
  selectedSystemIndex,
  armedMoveSource,
  armedProjectType,
  systemHighlights,
  selectedMoveOrderKey,
  turnNumber,
  onSelectSystem,
  onSelectMoveOrder,
  onAdjustSelectedMoveOrder,
  onCancelPlacement
}: GameBoardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewState, setViewState] = useState({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [showResolvedEvents, setShowResolvedEvents] = useState(false);
  const panStart = useRef({ x: 0, y: 0, vx: 0, vy: 0 });
  const holdTimeoutRef = useRef<number | null>(null);
  const holdIntervalRef = useRef<number | null>(null);
  const lastResolvedAnimationKeyRef = useRef('');

  const systemsByIndex = useMemo(() => new Map(systems.map(system => [system.index, system])), [systems]);
  const playersByIndex = useMemo(() => new Map(players.map(player => [player.index, player])), [players]);
  const localPlayer = players.find(player => player.index === localPlayerIndex) ?? null;
  const moveColor = playerAccent(localPlayer);
  const projectColor = projectAccent(armedProjectType);

  const hexR = useMemo(() => computeHexRadius(systems, systemsByIndex), [systems, systemsByIndex]);

  const bounds = systems.reduce(
    (acc, system) => ({
      minX: Math.min(acc.minX, system.x),
      maxX: Math.max(acc.maxX, system.x),
      minY: Math.min(acc.minY, system.y),
      maxY: Math.max(acc.maxY, system.y)
    }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  );

  const pad = hexR * 2.6;
  const hasSystems = Number.isFinite(bounds.minX);
  const originX = hasSystems ? bounds.minX - pad : 0;
  const originY = hasSystems ? bounds.minY - pad : 0;
  const contentW = hasSystems ? bounds.maxX - bounds.minX + pad * 2 : 1200;
  const contentH = hasSystems ? bounds.maxY - bounds.minY + pad * 2 : 800;
  const viewBox = `${originX} ${originY} ${contentW} ${contentH}`;

  const backgroundStars = useMemo(() => {
    const count = Math.max(28, Math.min(64, Math.round(systems.length * 1.1) + 18));
    const seed = systems.reduce((acc, system, index) => acc + system.x * 0.17 + system.y * 0.11 + system.index * 0.91 + index * 1.37, 19.5);

    return Array.from({ length: count }, (_, index) => {
      const x = originX + seededFloat(seed + index * 7.13) * contentW;
      const y = originY + seededFloat(seed + index * 11.77) * contentH;
      const r = 0.55 + seededFloat(seed + index * 13.91) * 1.4;
      const opacity = 0.06 + seededFloat(seed + index * 17.29) * 0.18;
      return { x, y, r, opacity };
    });
  }, [systems, originX, originY, contentW, contentH]);

  useEffect(() => {
    setViewState({ x: 0, y: 0, scale: 1 });
  }, [systems.length]);

  const resolvedSignature = useMemo(() => resolvedEventSignature(resolvedEvents), [resolvedEvents]);

  useEffect(() => {
    if (!resolvedEvents.length) {
      setShowResolvedEvents(false);
      return;
    }

    const animationKey = `${turnNumber}:${resolvedSignature}`;
    if (lastResolvedAnimationKeyRef.current === animationKey) {
      return;
    }

    lastResolvedAnimationKeyRef.current = animationKey;
    setShowResolvedEvents(true);
    const timeout = window.setTimeout(() => setShowResolvedEvents(false), 3600);
    return () => window.clearTimeout(timeout);
  }, [resolvedEvents.length, resolvedSignature, turnNumber]);

  const clearHeldAction = useCallback(() => {
    if (holdTimeoutRef.current !== null) {
      window.clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
    }
    if (holdIntervalRef.current !== null) {
      window.clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = null;
    }
  }, []);

  useEffect(() => () => clearHeldAction(), [clearHeldAction]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setViewState(prev => {
      const newScale = Math.max(0.2, Math.min(6, prev.scale * factor));
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { ...prev, scale: newScale };
      const mx = e.clientX - rect.left - rect.width / 2;
      const my = e.clientY - rect.top - rect.height / 2;
      const ds = newScale - prev.scale;
      return { x: prev.x - mx * (ds / prev.scale), y: prev.y - my * (ds / prev.scale), scale: newScale };
    });
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    const target = e.target as Element;
    const isBg = target.tagName === 'svg' || target.tagName === 'rect' || target.classList.contains('board-bg');
    if (e.button === 0 && !isBg) return;
    e.preventDefault();
    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, vx: viewState.x, vy: viewState.y };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }, [viewState.x, viewState.y]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanning) return;
    setViewState(prev => ({
      ...prev,
      x: panStart.current.vx + (e.clientX - panStart.current.x),
      y: panStart.current.vy + (e.clientY - panStart.current.y)
    }));
  }, [isPanning]);

  const handlePointerUp = useCallback(() => {
    setIsPanning(false);
    clearHeldAction();
  }, [clearHeldAction]);

  const linkPairs = useMemo(
    () => systems.flatMap(system => system.neighbors.filter(neighbor => system.index < neighbor).map(neighbor => [system.index, neighbor] as const)),
    [systems]
  );

  const buildOrderBySystem = new Map(orders.buildOrders.map(order => [order.systemIndex, order.quantity]));
  const projectLabelsByTarget = new Map<number, string[]>();
  for (const proj of orders.projectOrders) {
    if (proj.targetIndex === null) continue;
    const labels = projectLabelsByTarget.get(proj.targetIndex) ?? [];
    labels.push(shortProjectLabel(proj.type));
    projectLabelsByTarget.set(proj.targetIndex, labels);
    if (proj.type === 'EXOTICS' && proj.sourceIndex !== null) {
      const sourceLabels = projectLabelsByTarget.get(proj.sourceIndex) ?? [];
      sourceLabels.push(shortProjectLabel(proj.type));
      projectLabelsByTarget.set(proj.sourceIndex, sourceLabels);
    }
  }

  const garrisonFontSize = Math.max(12, Math.round(hexR * 0.42));
  const badgeFontSize = Math.max(8, Math.round(hexR * 0.13));
  const armedProjectShort = armedProjectType ? shortProjectLabel(armedProjectType) : null;
  const systemNameFontSize = Math.max(6, Math.round(hexR * 0.12));
  const resourceLineWidth = Math.max(2, hexR * 0.055);
  const resourceLineGap = Math.max(6, hexR * 0.11);
  const resourceTrackHeight = Math.max(8, hexR * 0.24);
  const resourceTrackBaseY = hexR * 0.41;
  const tierOrbRadius = Math.max(9, hexR * 0.58);
  const tierOrbSize = Math.max(2.2, hexR * 0.048);
  const resolvedBadgeFontSize = Math.max(8, Math.round(hexR * 0.16));

  const beginHeldAction = useCallback((action: 'increment' | 'decrement' | 'clear') => {
    onAdjustSelectedMoveOrder(action);
    if (action === 'clear') return;

    clearHeldAction();
    holdTimeoutRef.current = window.setTimeout(() => {
      holdIntervalRef.current = window.setInterval(() => onAdjustSelectedMoveOrder(action), 120);
    }, 260);
  }, [clearHeldAction, onAdjustSelectedMoveOrder]);

  return (
    <div
      ref={containerRef}
      className="board-full"
      onContextMenu={event => {
        event.preventDefault();
        clearHeldAction();
        onCancelPlacement(null);
      }}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      style={{ cursor: isPanning ? 'grabbing' : 'default' }}
    >
      <svg
        className="board-svg"
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Game board"
        style={{
          transform: `translate(${viewState.x}px, ${viewState.y}px) scale(${viewState.scale})`,
          transformOrigin: 'center center'
        }}
      >
        <defs>
          <linearGradient id="board-base" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#050713" />
            <stop offset="50%" stopColor="#070b16" />
            <stop offset="100%" stopColor="#04050d" />
          </linearGradient>
          <radialGradient id="board-haze-a" cx="20%" cy="18%" r="70%">
            <stop offset="0%" stopColor="rgba(64, 82, 135, 0.32)" />
            <stop offset="55%" stopColor="rgba(29, 41, 74, 0.12)" />
            <stop offset="100%" stopColor="rgba(5, 8, 17, 0)" />
          </radialGradient>
          <radialGradient id="board-haze-b" cx="75%" cy="24%" r="72%">
            <stop offset="0%" stopColor="rgba(78, 36, 112, 0.18)" />
            <stop offset="60%" stopColor="rgba(22, 27, 48, 0.08)" />
            <stop offset="100%" stopColor="rgba(5, 8, 17, 0)" />
          </radialGradient>
          <radialGradient id="board-haze-c" cx="52%" cy="74%" r="72%">
            <stop offset="0%" stopColor="rgba(15, 88, 118, 0.12)" />
            <stop offset="55%" stopColor="rgba(16, 26, 48, 0.06)" />
            <stop offset="100%" stopColor="rgba(5, 8, 17, 0)" />
          </radialGradient>
          <filter id="board-soft-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="board-selection-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="4.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="board-magenta-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3.6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <marker id="board-move-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4.5" markerHeight="4.5" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10Z" fill={moveColor} />
          </marker>
        </defs>

        <g pointerEvents="none">
          <rect className="board-bg" x={originX - contentW * 2} y={originY - contentH * 2} width={contentW * 5} height={contentH * 5} fill="url(#board-base)" />
          <rect x={originX - contentW * 2} y={originY - contentH * 2} width={contentW * 5} height={contentH * 5} fill="url(#board-haze-a)" opacity="0.95" />
          <rect x={originX - contentW * 2} y={originY - contentH * 2} width={contentW * 5} height={contentH * 5} fill="url(#board-haze-b)" opacity="0.85" />
          <rect x={originX - contentW * 2} y={originY - contentH * 2} width={contentW * 5} height={contentH * 5} fill="url(#board-haze-c)" opacity="0.75" />

          {backgroundStars.map((star, index) => (
            <circle
              key={`star-${index}`}
              cx={star.x}
              cy={star.y}
              r={star.r}
              fill="#eef4ff"
              opacity={star.opacity}
            />
          ))}
        </g>

        <g pointerEvents="none">
          {linkPairs.map(([fromIndex, toIndex]) => {
            const from = systemsByIndex.get(fromIndex);
            const to = systemsByIndex.get(toIndex);
            if (!from || !to) return null;
            return (
              <line
                key={`lk-${fromIndex}-${toIndex}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="rgba(156, 175, 210, 0.18)"
                strokeWidth={Math.max(0.8, hexR * 0.02)}
                strokeLinecap="round"
                strokeDasharray={`${Math.max(2, hexR * 0.06)} ${Math.max(4, hexR * 0.09)}`}
              />
            );
          })}

        </g>

        {systems.map(system => {
          const owner = system.ownerIndex >= 0 ? playersByIndex.get(system.ownerIndex) ?? null : null;
          const ownerBaseHex = owner ? playerBaseColor(owner) : null;
          const ownerAccentHex = owner ? playerAccent(owner) : null;
          const baseColor = ownerBaseHex ? darken(ownerBaseHex, 0.88) : '#222a38';
          const accentColor = ownerAccentHex ? darken(ownerAccentHex, 0.9) : '#4b5568';
          const buildQty = buildOrderBySystem.get(system.index);
          const projLabels = projectLabelsByTarget.get(system.index) ?? [];
          const cx = system.x;
          const cy = system.y;
          const outerR = hexR;
          const innerR = hexR * 0.88;
          const isNeutral = !owner;

          const bodyColor = isNeutral ? '#252d38' : darken(ownerBaseHex!, 0.54);
          const innerColor = isNeutral ? 'rgba(255,255,255,0.024)' : baseColor;
          const borderColor = isNeutral ? 'rgba(160, 174, 196, 0.24)' : accentColor;
          const projectArmed = Boolean(armedProjectShort && projLabels.includes(armedProjectShort));
          const tierValue = clamp(system.score, 0, 3);
          const resourceCounts = RESOURCE_DISPLAY_META.map(resource => clamp(system.resources[resource.index] ?? 0, 0, 6));
          const resourceBandWidth = resourceLineGap * Math.max(0, RESOURCE_DISPLAY_META.length - 1);
          const resourceLineXs = RESOURCE_DISPLAY_META.map((_, index) => cx - resourceBandWidth / 2 + index * resourceLineGap);
          const tierOrbs = tierOrbOffsets(tierValue, tierOrbRadius);

          return (
            <g
              key={system.index}
              className="cursor-pointer"
              onContextMenu={event => {
                event.preventDefault();
                event.stopPropagation();
                clearHeldAction();
                onCancelPlacement(system.index);
              }}
              onClick={() => onSelectSystem(system.index)}
            >
              <polygon
                points={hexPoints(cx, cy, outerR)}
                fill={bodyColor}
              />
              <polygon
                points={hexPoints(cx, cy - hexR * 0.01, innerR)}
                fill={innerColor}
                opacity={owner ? '0.42' : '0.68'}
              />
              <polygon
                points={hexPoints(cx, cy, outerR)}
                fill="none"
                stroke={borderColor}
                strokeWidth={Math.max(0.9, hexR * 0.014)}
                strokeOpacity={owner ? '0.5' : '0.24'}
                strokeLinejoin="round"
              />

              {system.hasDefensiveNet && (
                <polygon
                  points={hexPoints(cx, cy, outerR - hexR * 0.08)}
                  fill="none"
                  stroke="rgba(105, 215, 242, 0.34)"
                  strokeWidth={Math.max(1, hexR * 0.017)}
                  strokeDasharray={`${Math.max(2, hexR * 0.055)} ${Math.max(3, hexR * 0.065)}`}
                  strokeLinejoin="round"
                />
              )}

              {tierValue > 0 && (
                <g opacity="0.78">
                  <g>
                    <animateTransform
                      attributeName="transform"
                      type="rotate"
                      from={`0 ${cx} ${cy}`}
                      to={`360 ${cx} ${cy}`}
                      dur={`${14 + (system.index % 5)}s`}
                      repeatCount="indefinite"
                    />
                    {tierOrbs.map((offset, orbIndex) => {
                      const orbX = cx + offset.x;
                      const orbY = cy + offset.y;
                      return (
                        <g key={`${system.index}-tier-orb-${orbIndex}`}>
                          <circle
                            cx={orbX}
                            cy={orbY}
                            r={tierOrbSize}
                            fill="rgba(212, 218, 228, 0.92)"
                          />
                        </g>
                      );
                    })}
                  </g>
                </g>
              )}

              <text
                x={cx}
                y={cy - hexR * 0.15}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={garrisonFontSize}
                fill="#f6f9ff"
                fontWeight="600"
                letterSpacing="-0.04em"
                fontFamily="Oxanium, Chakra Petch, sans-serif"
              >
                {system.garrison}
              </text>

              <text
                x={cx}
                y={cy + hexR * 0.11}
                textAnchor="middle"
                fontSize={systemNameFontSize}
                fill="rgba(216, 226, 241, 0.78)"
                fontWeight="500"
                fontFamily="Chakra Petch, sans-serif"
                letterSpacing="0.01em"
              >
                {system.name}
              </text>

              <g>
                {RESOURCE_DISPLAY_META.map((resource, resourceIndex) => {
                  const count = resourceCounts[resourceIndex] ?? 0;
                  const trackX = resourceLineXs[resourceIndex] ?? cx;
                  const lineHeight = count <= 0 ? 0 : resourceTrackHeight * (count / 6);
                  return (
                    <g key={`${system.index}-resource-${resource.label}`}>
                      <rect
                        x={trackX - resourceLineWidth / 2}
                        y={cy + resourceTrackBaseY - resourceTrackHeight}
                        width={resourceLineWidth}
                        height={resourceTrackHeight}
                        fill="rgba(217, 227, 241, 0.08)"
                        opacity="0.75"
                      />
                      {lineHeight > 0 && (
                        <rect
                          x={trackX - resourceLineWidth / 2}
                          y={cy + resourceTrackBaseY - lineHeight}
                          width={resourceLineWidth}
                          height={lineHeight}
                          fill={resource.color}
                          opacity="0.96"
                        />
                      )}
                    </g>
                  );
                })}
              </g>

              {buildQty != null && buildQty > 0 && (
                <g>
                  <rect
                    x={cx - hexR * 0.18}
                    y={cy + hexR * 0.31}
                    width={hexR * 0.36}
                    height={hexR * 0.14}
                    rx={hexR * 0.06}
                    fill="rgba(105, 215, 242, 0.1)"
                    stroke="rgba(105, 215, 242, 0.32)"
                    strokeWidth={Math.max(0.8, hexR * 0.012)}
                  />
                  <text
                    x={cx}
                    y={cy + hexR * 0.41}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={badgeFontSize}
                    fill="#c9f7ff"
                    fontWeight="600"
                    fontFamily="Oxanium, Chakra Petch, sans-serif"
                  >
                    +{buildQty}
                  </text>
                </g>
              )}

              {projLabels.length > 0 && (
                <g>
                  <rect
                    x={cx - hexR * 0.22}
                    y={cy - hexR * 0.68}
                    width={hexR * 0.44}
                    height={hexR * 0.14}
                    rx={hexR * 0.06}
                    fill={projectArmed ? 'rgba(208, 92, 255, 0.16)' : 'rgba(255, 255, 255, 0.05)'}
                    stroke={projectArmed ? 'rgba(208, 92, 255, 0.38)' : 'rgba(255, 255, 255, 0.1)'}
                    strokeWidth={Math.max(0.8, hexR * 0.01)}
                  />
                  <text
                    x={cx}
                    y={cy - hexR * 0.58}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={badgeFontSize}
                    fill={projectArmed ? '#f5d7ff' : '#dbe4f3'}
                    fontWeight="600"
                    fontFamily="Oxanium, Chakra Petch, sans-serif"
                >
                  {projLabels.join('/')}
                </text>
                </g>
              )}

            </g>
          );
        })}

        <g pointerEvents="none">
          {systems.map(system => {
            const cx = system.x;
            const cy = system.y;
            const outerR = hexR;
            const selected = selectedSystemIndex === system.index;
            const armedMove = armedMoveSource === system.index;
            const highlight = systemHighlights.get(system.index);

            let stroke: string | null = null;
            let strokeWidth = Math.max(1.1, hexR * 0.018);
            let strokeDasharray: string | undefined;
            let filter: string | undefined;
            let radius = outerR + hexR * 0.024;

            if (selected) {
              stroke = 'rgba(226, 245, 255, 0.9)';
              strokeWidth = Math.max(1.8, hexR * 0.028);
              filter = 'url(#board-selection-glow)';
              radius = outerR + hexR * 0.03;
            } else if (highlight === 'project-source') {
              stroke = 'rgba(204, 116, 255, 0.82)';
              strokeWidth = Math.max(1.5, hexR * 0.024);
              filter = 'url(#board-magenta-glow)';
              radius = outerR + hexR * 0.028;
            } else if (highlight === 'source') {
              stroke = 'rgba(104, 242, 186, 0.74)';
              strokeWidth = Math.max(1.5, hexR * 0.024);
              filter = 'url(#board-soft-glow)';
              radius = outerR + hexR * 0.028;
            } else if (highlight === 'build') {
              stroke = 'rgba(113, 233, 247, 0.64)';
              strokeWidth = Math.max(1.2, hexR * 0.021);
              strokeDasharray = `${Math.max(2, hexR * 0.055)} ${Math.max(3, hexR * 0.065)}`;
              filter = 'url(#board-soft-glow)';
              radius = outerR + hexR * 0.022;
            } else if (highlight === 'project-target') {
              stroke = projectColor;
              strokeWidth = Math.max(1.2, hexR * 0.021);
              strokeDasharray = `${Math.max(2, hexR * 0.055)} ${Math.max(3, hexR * 0.065)}`;
              filter = 'url(#board-soft-glow)';
              radius = outerR + hexR * 0.022;
            } else if (highlight === 'candidate') {
              stroke = 'rgba(203, 214, 232, 0.34)';
              strokeWidth = Math.max(1, hexR * 0.017);
              strokeDasharray = `${Math.max(2, hexR * 0.05)} ${Math.max(3, hexR * 0.065)}`;
              radius = outerR + hexR * 0.018;
            } else if (armedMove) {
              stroke = 'rgba(105, 215, 242, 0.7)';
              strokeWidth = Math.max(1.3, hexR * 0.022);
              strokeDasharray = `${Math.max(2, hexR * 0.06)} ${Math.max(3, hexR * 0.07)}`;
              filter = 'url(#board-soft-glow)';
              radius = outerR + hexR * 0.024;
            }

            return stroke ? (
              <polygon
                key={`system-overlay-${system.index}`}
                points={hexPoints(cx, cy, radius)}
                fill="none"
                stroke={stroke}
                strokeWidth={strokeWidth}
                strokeDasharray={strokeDasharray}
                strokeLinejoin="round"
                filter={filter}
              />
            ) : null;
          })}
        </g>

        <g pointerEvents="none">
          {tannhauserLinks.map(link => {
            const from = systemsByIndex.get(link.fromIndex);
            const to = systemsByIndex.get(link.toIndex);
            if (!from || !to) return null;
            return (
              <line
                key={`th-${link.fromIndex}-${link.toIndex}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="rgba(208, 92, 255, 0.72)"
                strokeWidth={Math.max(1.2, hexR * 0.04)}
                strokeLinecap="round"
                strokeDasharray={`${Math.max(3, hexR * 0.1)} ${Math.max(4, hexR * 0.08)}`}
                filter="url(#board-magenta-glow)"
              />
            );
          })}
        </g>

        {showResolvedEvents && resolvedEvents.length > 0 && (
          <g pointerEvents="none">
            {resolvedEvents.map((event, index) => {
              const source = event.sourceIndex === null ? null : systemsByIndex.get(event.sourceIndex) ?? null;
              const target = event.targetIndex === null ? null : systemsByIndex.get(event.targetIndex) ?? null;
              const system = event.systemIndex === null ? null : systemsByIndex.get(event.systemIndex) ?? null;
              const player = event.playerIndex === null ? null : playersByIndex.get(event.playerIndex) ?? null;
              const victor = event.victorIndex === null ? null : playersByIndex.get(event.victorIndex) ?? null;
              const baseColor = event.projectType ? projectAccentHex(event.projectType) : playerAccent(player);
              const delay = `${index * 0.14}s`;
              const overlayStroke = Math.max(1.4, hexR * 0.04);
              const badgeRadius = Math.max(9, hexR * 0.17);

              if ((event.kind === 'MOVE' || event.kind === 'RETREAT') && source && target) {
                const mx = (source.x + target.x) / 2;
                const my = (source.y + target.y) / 2;
                const lineColor = event.kind === 'RETREAT' ? 'rgba(241, 246, 255, 0.84)' : baseColor;
                const duration = event.kind === 'RETREAT' ? '1.8s' : '1.35s';

                return (
                  <g key={`resolved-${event.kind}-${index}`} opacity={event.kind === 'RETREAT' ? 0.82 : 0.96}>
                    <line
                      x1={source.x}
                      y1={source.y}
                      x2={target.x}
                      y2={target.y}
                      stroke={lineColor}
                      strokeWidth={overlayStroke}
                      strokeLinecap="round"
                      strokeDasharray={event.kind === 'RETREAT'
                        ? `${Math.max(3, hexR * 0.11)} ${Math.max(4, hexR * 0.09)}`
                        : `${Math.max(4, hexR * 0.13)} ${Math.max(3, hexR * 0.06)}`}
                      filter="url(#board-soft-glow)"
                    />
                    <circle r={Math.max(3, hexR * 0.08)} fill={lineColor} filter="url(#board-soft-glow)">
                      <animate attributeName="cx" values={`${source.x};${target.x}`} dur={duration} repeatCount="1" fill="freeze" begin={delay} />
                      <animate attributeName="cy" values={`${source.y};${target.y}`} dur={duration} repeatCount="1" fill="freeze" begin={delay} />
                      <animate attributeName="opacity" values="0;1;1;0" dur={duration} repeatCount="1" fill="freeze" begin={delay} />
                    </circle>
                    <circle
                      cx={mx}
                      cy={my}
                      r={badgeRadius}
                      fill="rgba(7, 10, 18, 0.96)"
                      stroke={lineColor}
                      strokeWidth={Math.max(1, hexR * 0.015)}
                    />
                    <text
                      x={mx}
                      y={my + badgeRadius * 0.08}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={resolvedBadgeFontSize}
                      fill="#f7fbff"
                      fontWeight="700"
                      fontFamily="Oxanium, Chakra Petch, sans-serif"
                    >
                      {event.quantity}
                    </text>
                  </g>
                );
              }

              if (event.kind === 'COLLAPSE' && system) {
                const label = event.quantity > 0 ? `-${event.quantity}` : 'X';
                return (
                  <g key={`resolved-collapse-${index}`}>
                    {[0, 0.24].map((offset, ringIndex) => (
                      <circle
                        key={`collapse-ring-${ringIndex}`}
                        cx={system.x}
                        cy={system.y}
                        r={hexR * 0.34}
                        fill="none"
                        stroke="rgba(255, 128, 124, 0.82)"
                        strokeWidth={Math.max(1.2, hexR * 0.028)}
                      >
                        <animate attributeName="r" values={`${hexR * 0.3};${hexR * 1.14}`} dur="1.45s" repeatCount="1" fill="freeze" begin={`${index * 0.14 + offset}s`} />
                        <animate attributeName="opacity" values="0.85;0" dur="1.45s" repeatCount="1" fill="freeze" begin={`${index * 0.14 + offset}s`} />
                      </circle>
                    ))}
                    <text
                      x={system.x}
                      y={system.y - hexR * 0.88}
                      textAnchor="middle"
                      fontSize={resolvedBadgeFontSize}
                      fill="#ffb2ad"
                      fontWeight="700"
                      fontFamily="Oxanium, Chakra Petch, sans-serif"
                    >
                      {label}
                    </text>
                  </g>
                );
              }

              if (event.kind === 'BUILD' && system) {
                return (
                  <g key={`resolved-build-${index}`}>
                    <circle
                      cx={system.x}
                      cy={system.y}
                      r={hexR * 0.24}
                      fill="none"
                      stroke={baseColor}
                      strokeWidth={Math.max(1.2, hexR * 0.026)}
                      filter="url(#board-soft-glow)"
                    >
                      <animate attributeName="r" values={`${hexR * 0.18};${hexR * 0.9}`} dur="1.25s" repeatCount="1" fill="freeze" begin={delay} />
                      <animate attributeName="opacity" values="0.85;0" dur="1.25s" repeatCount="1" fill="freeze" begin={delay} />
                    </circle>
                    <text
                      x={system.x}
                      y={system.y + hexR * 0.3}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={Math.max(10, hexR * 0.22)}
                      fill={baseColor}
                      fontWeight="700"
                      fontFamily="Oxanium, Chakra Petch, sans-serif"
                      filter="url(#board-soft-glow)"
                    >
                      {`+${event.quantity}`}
                      <animate attributeName="y" values={`${system.y + hexR * 0.32};${system.y - hexR * 0.02}`} dur="1.25s" repeatCount="1" fill="freeze" begin={delay} />
                      <animate attributeName="opacity" values="0;1;0" dur="1.25s" repeatCount="1" fill="freeze" begin={delay} />
                    </text>
                  </g>
                );
              }

              if (event.kind === 'PROJECT') {
                const projectColor = projectAccentHex(event.projectType);

                if (event.projectType === 'EXOTICS' && source && target) {
                  const mx = (source.x + target.x) / 2;
                  const my = (source.y + target.y) / 2;
                  return (
                    <g key={`resolved-project-${index}`}>
                      <line
                        x1={source.x}
                        y1={source.y}
                        x2={target.x}
                        y2={target.y}
                        stroke={projectColor}
                        strokeWidth={Math.max(1.4, hexR * 0.04)}
                        strokeLinecap="round"
                        strokeDasharray={`${Math.max(4, hexR * 0.13)} ${Math.max(4, hexR * 0.08)}`}
                        filter="url(#board-magenta-glow)"
                      />
                      {[source, target].map((endpoint, endpointIndex) => (
                        <circle
                          key={`resolved-project-endpoint-${endpoint.index}`}
                          cx={endpoint.x}
                          cy={endpoint.y}
                          r={hexR * 0.2}
                          fill="none"
                          stroke={projectColor}
                          strokeWidth={Math.max(1.1, hexR * 0.024)}
                        >
                          <animate attributeName="r" values={`${hexR * 0.18};${hexR * 0.5}`} dur="1.4s" repeatCount="1" fill="freeze" begin={`${index * 0.14 + endpointIndex * 0.18}s`} />
                          <animate attributeName="opacity" values="0.8;0" dur="1.4s" repeatCount="1" fill="freeze" begin={`${index * 0.14 + endpointIndex * 0.18}s`} />
                        </circle>
                      ))}
                      <text
                        x={mx}
                        y={my - hexR * 0.08}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fontSize={resolvedBadgeFontSize}
                        fill="#f6dcff"
                        fontWeight="700"
                        fontFamily="Oxanium, Chakra Petch, sans-serif"
                      >
                        TH
                      </text>
                    </g>
                  );
                }

                const targetSystem = target ?? system;
                if (!targetSystem) {
                  return null;
                }

                const label = event.projectType === 'ENERGY' && event.kills > 0
                  ? `-${event.kills}`
                  : shortProjectLabel(event.projectType ?? 'PROJECT');

                return (
                  <g key={`resolved-project-${index}`}>
                    <circle
                      cx={targetSystem.x}
                      cy={targetSystem.y}
                      r={hexR * 0.28}
                      fill="none"
                      stroke={projectColor}
                      strokeWidth={Math.max(1.4, hexR * 0.03)}
                      filter="url(#board-soft-glow)"
                    >
                      <animate attributeName="r" values={`${hexR * 0.26};${hexR * 0.92}`} dur="1.4s" repeatCount="1" fill="freeze" begin={delay} />
                      <animate attributeName="opacity" values="0.86;0" dur="1.4s" repeatCount="1" fill="freeze" begin={delay} />
                    </circle>
                    {event.projectType === 'ENERGY' && (
                      <circle
                        cx={targetSystem.x}
                        cy={targetSystem.y}
                        r={hexR * 0.14}
                        fill="rgba(255, 112, 80, 0.2)"
                      >
                        <animate attributeName="r" values={`${hexR * 0.12};${hexR * 0.46}`} dur="0.9s" repeatCount="1" fill="freeze" begin={delay} />
                        <animate attributeName="opacity" values="0.7;0" dur="0.9s" repeatCount="1" fill="freeze" begin={delay} />
                      </circle>
                    )}
                    <text
                      x={targetSystem.x}
                      y={targetSystem.y - hexR * 0.78}
                      textAnchor="middle"
                      fontSize={resolvedBadgeFontSize}
                      fill={projectColor}
                      fontWeight="700"
                      fontFamily="Oxanium, Chakra Petch, sans-serif"
                    >
                      {label}
                    </text>
                  </g>
                );
              }

              if (event.kind === 'COMBAT' && system) {
                const combatColor = victor ? playerAccent(victor) : '#ff9b84';
                const combatants = event.combatants
                  .filter(combatant => combatant.fleetsAtStart > 0)
                  .slice(0, 4);

                if (!combatants.length) {
                  return null;
                }

                const roundLabels = ['R1', 'R2', 'R3'];
                const roundWidth = Math.max(12, hexR * 0.22);
                const rowHeight = Math.max(11, hexR * 0.19);
                const leftPad = Math.max(12, hexR * 0.24);
                const topPad = Math.max(12, hexR * 0.24);
                const bottomPad = Math.max(8, hexR * 0.16);
                const panelWidth = leftPad + roundWidth * roundLabels.length + Math.max(12, hexR * 0.22);
                const panelHeight = topPad + rowHeight * combatants.length + bottomPad;
                const panelX = system.x - panelWidth / 2;
                const panelY = system.y - panelHeight / 2;
                const highlightXValues = roundLabels
                  .map((_, roundIndex) => panelX + leftPad + roundIndex * roundWidth - roundWidth * 0.38)
                  .join(';');

                return (
                  <g key={`resolved-combat-${index}`} filter="url(#board-soft-glow)">
                    <rect
                      x={panelX}
                      y={panelY}
                      width={panelWidth}
                      height={panelHeight}
                      rx={Math.max(8, hexR * 0.14)}
                      fill="rgba(5, 9, 18, 0.92)"
                      stroke="rgba(255, 255, 255, 0.08)"
                      strokeWidth={Math.max(1, hexR * 0.012)}
                    />
                    <rect
                      x={panelX}
                      y={panelY}
                      width={panelWidth}
                      height={panelHeight}
                      rx={Math.max(8, hexR * 0.14)}
                      fill="none"
                      stroke={combatColor}
                      strokeWidth={Math.max(1.1, hexR * 0.018)}
                      opacity="0.7"
                    />
                    <rect
                      x={panelX + leftPad - roundWidth * 0.38}
                      y={panelY + Math.max(6, hexR * 0.11)}
                      width={roundWidth * 0.76}
                      height={panelHeight - Math.max(12, hexR * 0.22)}
                      rx={Math.max(5, hexR * 0.08)}
                      fill="rgba(255, 255, 255, 0.08)"
                    >
                      <animate attributeName="x" values={highlightXValues} dur="2.8s" repeatCount="1" fill="freeze" begin={delay} />
                      <animate attributeName="opacity" values="0.18;0.28;0.28;0" dur="2.8s" repeatCount="1" fill="freeze" begin={delay} />
                    </rect>
                    {roundLabels.map((label, roundIndex) => (
                      <text
                        key={`combat-round-${index}-${label}`}
                        x={panelX + leftPad + roundIndex * roundWidth}
                        y={panelY + Math.max(9, hexR * 0.18)}
                        textAnchor="middle"
                        fontSize={Math.max(7, hexR * 0.12)}
                        fill="rgba(219, 228, 242, 0.72)"
                        fontWeight="700"
                        fontFamily="Chakra Petch, sans-serif"
                      >
                        {label}
                      </text>
                    ))}
                    {combatants.map((combatant, combatantIndex) => {
                      const combatantPlayer = combatant.playerIndex === null ? null : playersByIndex.get(combatant.playerIndex) ?? null;
                      const combatantColor = combatantPlayer ? playerAccent(combatantPlayer) : '#e8eef8';
                      const endFleets = Math.max(0, combatant.fleetsAtStart - combatant.fleetsDestroyed - combatant.fleetsRetreated);
                      const roundValues = combatRoundSnapshots(combatant.fleetsAtStart, endFleets);
                      const rowY = panelY + topPad + combatantIndex * rowHeight;
                      return (
                        <g key={`combatant-${index}-${combatantIndex}`}>
                          <circle
                            cx={panelX + Math.max(7, hexR * 0.12)}
                            cy={rowY}
                            r={Math.max(2.6, hexR * 0.06)}
                            fill={combatantColor}
                            opacity="0.95"
                          />
                          {roundValues.map((value, roundIndex) => (
                            <text
                              key={`combatant-${index}-${combatantIndex}-round-${roundIndex}`}
                              x={panelX + leftPad + roundIndex * roundWidth}
                              y={rowY + Math.max(2, hexR * 0.03)}
                              textAnchor="middle"
                              dominantBaseline="middle"
                              fontSize={Math.max(8, hexR * 0.15)}
                              fill="#f7fbff"
                              fontWeight="700"
                              fontFamily="Oxanium, Chakra Petch, sans-serif"
                            >
                              {value}
                            </text>
                          ))}
                        </g>
                      );
                    })}
                    <text
                      x={panelX + panelWidth - Math.max(7, hexR * 0.14)}
                      y={panelY + Math.max(9, hexR * 0.18)}
                      textAnchor="end"
                      fontSize={Math.max(7, hexR * 0.12)}
                      fill={event.kills > 0 ? '#ffc4b8' : combatColor}
                      fontWeight="700"
                      fontFamily="Chakra Petch, sans-serif"
                    >
                      {event.kills > 0 ? `-${event.kills}` : victor ? 'WIN' : 'FIGHT'}
                    </text>
                  </g>
                );
              }

              return null;
            })}
          </g>
        )}

        <g>
          {orders.moveOrders.map((order, index) => {
            const src = systemsByIndex.get(order.sourceIndex);
            const tgt = systemsByIndex.get(order.targetIndex);
            if (!src || !tgt) return null;
            const mx = (src.x + tgt.x) / 2;
            const my = (src.y + tgt.y) / 2;
            const badgeR = Math.max(8, hexR * 0.18);
            const selectedOrder = selectedMoveOrderKey === moveOrderKey(order.sourceIndex, order.targetIndex);
            const editorOffset = Math.max(24, hexR * 0.44);
            const editorRadius = Math.max(10, hexR * 0.16);

            return (
              <g
                key={`mv-${order.sourceIndex}-${order.targetIndex}-${index}`}
                onClick={event => {
                  event.stopPropagation();
                  onSelectMoveOrder(order.sourceIndex, order.targetIndex);
                }}
              >
                <line
                  x1={src.x}
                  y1={src.y}
                  x2={tgt.x}
                  y2={tgt.y}
                  stroke={selectedOrder ? moveColor : 'rgba(242, 246, 255, 0.72)'}
                  strokeWidth={selectedOrder ? Math.max(2, hexR * 0.05) : Math.max(1.4, hexR * 0.035)}
                  strokeLinecap="round"
                  markerEnd="url(#board-move-arrow)"
                  opacity={selectedOrder ? 0.98 : 0.92}
                  filter={selectedOrder ? 'url(#board-soft-glow)' : undefined}
                />
                <circle
                  cx={mx}
                  cy={my}
                  r={selectedOrder ? badgeR * 1.16 : badgeR}
                  fill="rgba(7, 10, 18, 0.95)"
                  stroke={selectedOrder ? '#f6fbff' : moveColor}
                  strokeWidth={Math.max(1, hexR * 0.015)}
                  opacity="0.95"
                  filter="url(#board-soft-glow)"
                />
                <text
                  x={mx}
                  y={my + badgeR * 0.06}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={Math.max(8, badgeR * 0.9)}
                  fill="#f7fbff"
                  fontWeight="600"
                  fontFamily="Oxanium, Chakra Petch, sans-serif"
                  pointerEvents="none"
                >
                  {order.quantity}
                </text>

                {selectedOrder && (
                  <g>
                    {[
                      { action: 'decrement' as const, label: '-', x: mx - editorOffset, y: my, fill: 'rgba(9, 14, 24, 0.96)', stroke: 'rgba(226, 233, 245, 0.36)' },
                      { action: 'increment' as const, label: '+', x: mx + editorOffset, y: my, fill: 'rgba(9, 14, 24, 0.96)', stroke: 'rgba(113, 233, 247, 0.48)' },
                      { action: 'clear' as const, label: 'x', x: mx, y: my + editorOffset, fill: 'rgba(19, 11, 18, 0.96)', stroke: 'rgba(239, 118, 125, 0.44)' }
                    ].map(button => (
                      <g
                        key={button.action}
                        onPointerDown={event => {
                          event.preventDefault();
                          event.stopPropagation();
                          beginHeldAction(button.action);
                        }}
                        onPointerUp={event => {
                          event.preventDefault();
                          event.stopPropagation();
                          clearHeldAction();
                        }}
                        onPointerLeave={clearHeldAction}
                        onPointerCancel={clearHeldAction}
                      >
                        <circle
                          cx={button.x}
                          cy={button.y}
                          r={editorRadius}
                          fill={button.fill}
                          stroke={button.stroke}
                          strokeWidth={Math.max(1, hexR * 0.015)}
                        />
                        <text
                          x={button.x}
                          y={button.y + editorRadius * 0.04}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fontSize={Math.max(10, editorRadius * 1.05)}
                          fill="#f6fbff"
                          fontWeight="700"
                          fontFamily="Oxanium, Chakra Petch, sans-serif"
                          pointerEvents="none"
                        >
                          {button.label}
                        </text>
                      </g>
                    ))}
                  </g>
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
