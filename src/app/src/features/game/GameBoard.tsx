import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { GamePlayer, OrdersSnapshot, ResolvedEventSnapshot, SystemSnapshot, TannhauserSnapshot } from '../../shared/types';
import { RESOURCE_DISPLAY_META, playerAccent, playerBaseColor, shortProjectLabel } from '../../shared/game';
import { playOriginalSound, type OriginalSoundKey } from '../../shared/audio';

export type BoardHighlight = 'candidate' | 'source' | 'build' | 'project-source' | 'project-target';

const RESOLVED_BUILD_PHASE_MS = 720;
const RESOLVED_BUILD_STAGGER_MS = 78;
const RESOLVED_MOVE_PHASE_MS = 1280;
const RESOLVED_PHASE_GAP_MS = 180;
const RESOLVED_COMBAT_INITIAL_HOLD_MS = 140;
const RESOLVED_COMBAT_ROUND_ANIM_MS = 520;
const RESOLVED_COMBAT_ROUND_HOLD_MS = 320;
const RESOLVED_COMBAT_ROUND_COUNT = 3;
const RESOLVED_POST_COMBAT_HOLD_MS = 360;
const RESOLVED_RETREAT_PHASE_MS = 1080;
const RESOLVED_RETREAT_STAGGER_MS = 96;
const RESOLVED_FALLBACK_PHASE_MS = 1500;

interface AudioCue {
  cueId: string;
  soundKey: OriginalSoundKey;
  atMs: number;
  volume?: number;
}

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
  onSelectSystem: (systemIndex: number | null) => void;
  onSelectMoveOrder: (sourceIndex: number, targetIndex: number) => void;
  onAdjustSelectedMoveOrder: (action: 'increment' | 'decrement' | 'clear') => void;
  onCancelPlacement: (systemIndex: number | null) => void;
}

interface BoardPoint {
  x: number;
  y: number;
}

interface MovementPath {
  source: BoardPoint;
  control: BoardPoint;
  target: BoardPoint;
}

interface ResolvedCombatantBar {
  playerIndex: number | null;
  sourceIndex: number | null;
  fleetsAtStart: number;
  fleetsDestroyed: number;
  fleetsRetreated: number;
}

interface ResolvedTimeline {
  buildStartMs: number;
  buildEndMs: number;
  moveStartMs: number;
  moveEndMs: number;
  combatStartMs: number;
  combatEndMs: number;
  postCombatEndMs: number;
  retreatStartMs: number;
  retreatEndMs: number;
  totalMs: number;
}

function isInstantNeutralCapture(event: Pick<ResolvedEventSnapshot, 'kind' | 'ownerAtCombatStart' | 'kills' | 'victorIndex'>): boolean {
  return event.kind === 'COMBAT'
    && event.ownerAtCombatStart == null
    && event.kills === 0
    && event.victorIndex !== null;
}

function hexPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = -Math.PI / 2 + (Math.PI / 3) * i;
    pts.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
  }
  return pts.join(' ');
}

function hexVertices(cx: number, cy: number, r: number): BoardPoint[] {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = -Math.PI / 2 + (Math.PI / 3) * index;
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle)
    };
  });
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
  if (start <= 0) return [0, 0, 0, 0];
  if (start <= end) return [start, end, end, end];

  const losses = start - end;
  const roundOne = Math.max(end, start - Math.max(1, Math.round(losses * 0.34)));
  const roundTwo = Math.max(end, start - Math.max(1, Math.round(losses * 0.68)));
  return [start, roundOne, roundTwo, end];
}

function movementCurveControl(source: BoardPoint, target: BoardPoint, hexR: number): BoardPoint {
  const distance = Math.hypot(target.x - source.x, target.y - source.y);
  const distanceRatio = clamp(distance / (hexR * 5), 0, 1);
  const lift = Math.max(
    hexR * (0.34 + distanceRatio * 0.24),
    distance * (0.08 + distanceRatio * 0.08)
  );
  return {
    x: (source.x + target.x) / 2,
    y: Math.min(source.y, target.y) - lift
  };
}

function movementCurvePath(source: BoardPoint, target: BoardPoint, hexR: number): string {
  const control = movementCurveControl(source, target, hexR);
  return `M ${source.x} ${source.y} Q ${control.x} ${control.y} ${target.x} ${target.y}`;
}

function buildResolvedAudioCues(events: ResolvedEventSnapshot[], timeline: ResolvedTimeline): AudioCue[] {
  const cues: AudioCue[] = [];
  let combatIndex = 0;

  events.forEach(event => {
    if (event.kind !== 'COMBAT') return;
    if (isInstantNeutralCapture(event)) return;

    const combatAtMs = timeline.combatStartMs + combatIndex * RESOLVED_COMBAT_ROUND_HOLD_MS;
    if (event.kills > 0 || event.victorIndex !== null) {
      cues.push({
        cueId: `explosion:${combatIndex}`,
        soundKey: 'explosion',
        atMs: combatAtMs + 140 + Math.min(220, event.kills * 22),
        volume: clamp(0.55 + Math.min(0.25, event.kills * 0.04), 0.45, 0.9)
      });
    }

    combatIndex += 1;
  });

  return cues.sort((left, right) => left.atMs - right.atMs);
}

function pointDistance(source: BoardPoint, target: BoardPoint): number {
  return Math.hypot(target.x - source.x, target.y - source.y);
}

function normalizeVector(dx: number, dy: number): BoardPoint {
  const length = Math.hypot(dx, dy);
  if (length <= 0) {
    return { x: 0, y: 0 };
  }

  return {
    x: dx / length,
    y: dy / length
  };
}

function cross(left: BoardPoint, right: BoardPoint): number {
  return left.x * right.y - left.y * right.x;
}

function hexEdgeDistance(direction: BoardPoint, hexR: number): number {
  if (direction.x === 0 && direction.y === 0) {
    return 0;
  }

  const vertices = hexVertices(0, 0, hexR);
  let nearest = hexR;

  for (let index = 0; index < vertices.length; index += 1) {
    const edgeStart = vertices[index]!;
    const edgeEnd = vertices[(index + 1) % vertices.length]!;
    const edge = {
      x: edgeEnd.x - edgeStart.x,
      y: edgeEnd.y - edgeStart.y
    };
    const denominator = cross(direction, edge);
    if (Math.abs(denominator) < 1e-6) {
      continue;
    }

    const distance = cross(edgeStart, edge) / denominator;
    const segmentOffset = cross(edgeStart, direction) / denominator;
    if (distance >= 0 && segmentOffset >= 0 && segmentOffset <= 1) {
      nearest = Math.min(nearest, distance);
    }
  }

  return nearest;
}

function movementEndpoints(source: BoardPoint, target: BoardPoint, hexR: number): { source: BoardPoint; target: BoardPoint } {
  const direction = normalizeVector(target.x - source.x, target.y - source.y);
  const sourceInset = hexEdgeDistance(direction, hexR) * 0.8;
  const targetInset = hexEdgeDistance({ x: -direction.x, y: -direction.y }, hexR) * 0.8;

  return {
    source: {
      x: source.x + direction.x * sourceInset,
      y: source.y + direction.y * sourceInset
    },
    target: {
      x: target.x - direction.x * targetInset,
      y: target.y - direction.y * targetInset
    }
  };
}

function straightLinkSegment(
  source: BoardPoint,
  target: BoardPoint,
  hexR: number,
  insetScale = 0.94
): { source: BoardPoint; target: BoardPoint; visibleLength: number } {
  const direction = normalizeVector(target.x - source.x, target.y - source.y);
  const totalDistance = pointDistance(source, target);
  const sourceInset = hexEdgeDistance(direction, hexR) * insetScale;
  const targetInset = hexEdgeDistance({ x: -direction.x, y: -direction.y }, hexR) * insetScale;

  return {
    source: {
      x: source.x + direction.x * sourceInset,
      y: source.y + direction.y * sourceInset
    },
    target: {
      x: target.x - direction.x * targetInset,
      y: target.y - direction.y * targetInset
    },
    visibleLength: Math.max(0, totalDistance - sourceInset - targetInset)
  };
}

function minimumVisibleLinkLength(hexR: number): number {
  return Math.max(6, hexR * 0.08);
}

function visibleConnectionSegment(
  source: BoardPoint,
  target: BoardPoint,
  hexR: number
): { source: BoardPoint; target: BoardPoint; visibleLength: number } | null {
  const segment = straightLinkSegment(source, target, hexR, 0.82);
  return segment.visibleLength > minimumVisibleLinkLength(hexR) ? segment : null;
}

function movementPath(source: BoardPoint, target: BoardPoint, hexR: number): MovementPath {
  const endpoints = movementEndpoints(source, target, hexR);
  const control = movementCurveControl(endpoints.source, endpoints.target, hexR);
  return {
    source: endpoints.source,
    control,
    target: endpoints.target
  };
}

function quadraticPoint(source: BoardPoint, control: BoardPoint, target: BoardPoint, t: number): BoardPoint {
  const inv = 1 - t;
  return {
    x: inv * inv * source.x + 2 * inv * t * control.x + t * t * target.x,
    y: inv * inv * source.y + 2 * inv * t * control.y + t * t * target.y
  };
}

function combatantBars(combatants: ResolvedEventSnapshot['combatants']): ResolvedCombatantBar[] {
  const aggregated = new Map<string, ResolvedCombatantBar>();

  combatants
    .filter(combatant => combatant.fleetsAtStart > 0)
    .forEach(combatant => {
      const key = combatant.playerIndex === null ? 'neutral' : `player:${combatant.playerIndex}`;
      const existing = aggregated.get(key);
      if (existing) {
        existing.fleetsAtStart += combatant.fleetsAtStart;
        existing.fleetsDestroyed += combatant.fleetsDestroyed;
        existing.fleetsRetreated += combatant.fleetsRetreated;
        if (existing.sourceIndex === null && combatant.sourceIndex !== null) {
          existing.sourceIndex = combatant.sourceIndex;
        }
        return;
      }

      aggregated.set(key, {
        playerIndex: combatant.playerIndex,
        sourceIndex: combatant.sourceIndex,
        fleetsAtStart: combatant.fleetsAtStart,
        fleetsDestroyed: combatant.fleetsDestroyed,
        fleetsRetreated: combatant.fleetsRetreated
      });
    });

  return [...aggregated.values()]
    .sort((left, right) => right.fleetsAtStart - left.fleetsAtStart);
}

function buildResolvedTimeline(events: ResolvedEventSnapshot[]): ResolvedTimeline {
  const hasBuildEffects = events.some(event => event.kind === 'BUILD' || event.kind === 'PROJECT');
  const hasMoves = events.some(event => event.kind === 'MOVE');
  const hasCombat = events.some(event => event.kind === 'COMBAT' && !isInstantNeutralCapture(event));
  const hasRetreats = events.some(event => event.kind === 'RETREAT' || event.kind === 'COLLAPSE');

  const buildStartMs = 0;
  const buildEndMs = hasBuildEffects ? RESOLVED_BUILD_PHASE_MS : 0;
  const moveStartMs = hasMoves ? 120 : 0;
  const moveEndMs = hasMoves
    ? Math.max(buildEndMs, moveStartMs + RESOLVED_MOVE_PHASE_MS)
    : buildEndMs;
  const combatStartMs = hasCombat
    ? (Math.max(buildEndMs, moveEndMs) + RESOLVED_PHASE_GAP_MS)
    : 0;
  const combatEndMs = hasCombat
    ? combatStartMs
      + RESOLVED_COMBAT_INITIAL_HOLD_MS
      + RESOLVED_COMBAT_ROUND_COUNT * (RESOLVED_COMBAT_ROUND_ANIM_MS + RESOLVED_COMBAT_ROUND_HOLD_MS)
    : 0;
  const postCombatEndMs = hasCombat ? combatEndMs + RESOLVED_POST_COMBAT_HOLD_MS : combatEndMs;
  const retreatStartMs = hasRetreats
    ? (Math.max(postCombatEndMs, moveEndMs) + RESOLVED_PHASE_GAP_MS)
    : 0;
  const retreatEndMs = hasRetreats ? retreatStartMs + RESOLVED_RETREAT_PHASE_MS : 0;

  return {
    buildStartMs,
    buildEndMs,
    moveStartMs,
    moveEndMs,
    combatStartMs,
    combatEndMs,
    postCombatEndMs,
    retreatStartMs,
    retreatEndMs,
    totalMs: Math.max(RESOLVED_FALLBACK_PHASE_MS, buildEndMs, moveEndMs, postCombatEndMs, retreatEndMs)
  };
}

function phaseProgress(elapsedMs: number, startMs: number, endMs: number): number {
  if (endMs <= startMs) return elapsedMs >= startMs ? 1 : 0;
  return clamp((elapsedMs - startMs) / (endMs - startMs), 0, 1);
}

function windowOpacity(elapsedMs: number, startMs: number, endMs: number, fadeMs: number): number {
  if (elapsedMs < startMs || elapsedMs > endMs) return 0;
  if (fadeMs <= 0) return 1;

  const fadeIn = clamp((elapsedMs - startMs) / fadeMs, 0, 1);
  const fadeOut = clamp((endMs - elapsedMs) / fadeMs, 0, 1);
  return Math.min(fadeIn, fadeOut);
}

function lerpNumber(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function easeInOutCubic(t: number): number {
  const clamped = clamp(t, 0, 1);
  return clamped < 0.5
    ? 4 * clamped * clamped * clamped
    : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
}

function combatFrame(elapsedMs: number): { label: string; fromIndex: number; toIndex: number; t: number } {
  if (elapsedMs <= RESOLVED_COMBAT_INITIAL_HOLD_MS) {
    return { label: 'R1', fromIndex: 0, toIndex: 0, t: 0 };
  }

  let remainingMs = elapsedMs - RESOLVED_COMBAT_INITIAL_HOLD_MS;
  for (let roundIndex = 0; roundIndex < RESOLVED_COMBAT_ROUND_COUNT; roundIndex += 1) {
    if (remainingMs <= RESOLVED_COMBAT_ROUND_ANIM_MS) {
      return {
        label: `R${roundIndex + 1}`,
        fromIndex: roundIndex,
        toIndex: roundIndex + 1,
        t: remainingMs / RESOLVED_COMBAT_ROUND_ANIM_MS
      };
    }

    remainingMs -= RESOLVED_COMBAT_ROUND_ANIM_MS;
    if (remainingMs <= RESOLVED_COMBAT_ROUND_HOLD_MS) {
      return {
        label: `R${roundIndex + 1}`,
        fromIndex: roundIndex + 1,
        toIndex: roundIndex + 1,
        t: 0
      };
    }

    remainingMs -= RESOLVED_COMBAT_ROUND_HOLD_MS;
  }

  return { label: 'R3', fromIndex: 3, toIndex: 3, t: 0 };
}

function combatResidentFleetsAtStart(event: Pick<ResolvedEventSnapshot, 'combatants'>): number {
  return event.combatants.find(combatant => combatant.sourceIndex === null)?.fleetsAtStart ?? 0;
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
      event.ownerAtCombatStart ?? 'n',
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
  const [resolvedElapsedMs, setResolvedElapsedMs] = useState(0);
  const panStart = useRef({ x: 0, y: 0, vx: 0, vy: 0 });
  const holdTimeoutRef = useRef<number | null>(null);
  const holdIntervalRef = useRef<number | null>(null);
  const resolvedAnimationFrameRef = useRef<number | null>(null);
  const resolvedAnimationStartRef = useRef<number | null>(null);
  const lastResolvedAnimationKeyRef = useRef('');
  const panMovedRef = useRef(false);
  const playedAudioCuesRef = useRef<Set<string>>(new Set());

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
  const resolvedTimeline = useMemo(() => buildResolvedTimeline(resolvedEvents), [resolvedEvents]);
  const resolvedAudioCues = useMemo(
    () => buildResolvedAudioCues(resolvedEvents, resolvedTimeline),
    [resolvedEvents, resolvedTimeline]
  );
  const resolvedMoveEvents = useMemo(() => (
    resolvedEvents.flatMap((event, index) => {
      if (event.kind !== 'MOVE') {
        return [];
      }

      const source = event.sourceIndex === null ? null : systemsByIndex.get(event.sourceIndex) ?? null;
      const target = event.targetIndex === null ? null : systemsByIndex.get(event.targetIndex) ?? null;
      if (!source || !target) {
        return [];
      }

      const player = event.playerIndex === null ? null : playersByIndex.get(event.playerIndex) ?? null;
      return [{
        key: `resolved-move-${index}`,
        sequenceIndex: index,
        quantity: event.quantity,
        color: playerAccent(player),
        source,
        target,
        path: movementPath(source, target, hexR)
      }];
    })
  ), [hexR, playersByIndex, resolvedEvents, systemsByIndex]);
  const resolvedRetreatEvents = useMemo(() => (
    resolvedEvents.flatMap((event, index) => {
      if (event.kind !== 'RETREAT') {
        return [];
      }

      const source = event.sourceIndex === null ? null : systemsByIndex.get(event.sourceIndex) ?? null;
      const target = event.targetIndex === null ? null : systemsByIndex.get(event.targetIndex) ?? null;
      if (!source || !target) {
        return [];
      }

      return [{
        key: `resolved-retreat-${index}`,
        sequenceIndex: index,
        quantity: event.quantity,
        color: 'rgba(241, 246, 255, 0.86)',
        source,
        target,
        path: movementPath(source, target, hexR)
      }];
    })
  ), [hexR, resolvedEvents, systemsByIndex]);
  const resolvedCombatEvents = useMemo(() => (
    resolvedEvents.flatMap((event, index) => {
      if (event.kind !== 'COMBAT' || event.systemIndex === null) {
        return [];
      }

      const system = systemsByIndex.get(event.systemIndex) ?? null;
      if (!system) {
        return [];
      }

      const victor = event.victorIndex === null ? null : playersByIndex.get(event.victorIndex) ?? null;
      const combatants = combatantBars(event.combatants)
        .map(combatant => {
          const combatantPlayer = combatant.playerIndex === null ? null : playersByIndex.get(combatant.playerIndex) ?? null;
          const endFleets = Math.max(0, combatant.fleetsAtStart - combatant.fleetsDestroyed - combatant.fleetsRetreated);
          return {
            playerIndex: combatant.playerIndex,
            sourceIndex: combatant.sourceIndex,
            color: combatantPlayer ? playerAccent(combatantPlayer) : '#e8eef8',
            fleetsAtStart: combatant.fleetsAtStart,
            endFleets,
            snapshots: combatRoundSnapshots(combatant.fleetsAtStart, endFleets)
          };
        });

      const instantCapture = isInstantNeutralCapture(event);
      const autoWin = !instantCapture && event.kills === 0 && combatants.length <= 1 && event.victorIndex !== null;
      if (instantCapture) {
        return [];
      }

      if (!combatants.length && !autoWin) {
        return [];
      }

      return [{
        key: `resolved-combat-${index}`,
        sequenceIndex: index,
        system,
        fleetsAtEnd: event.fleetsAtEnd,
        kills: event.kills,
        autoWin,
        victorColor: victor ? playerAccent(victor) : '#ff9b84',
        combatants
      }];
    })
  ), [playersByIndex, resolvedEvents, systemsByIndex]);

  const stopResolvedPlayback = useCallback(() => {
    if (resolvedAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(resolvedAnimationFrameRef.current);
      resolvedAnimationFrameRef.current = null;
    }
    resolvedAnimationStartRef.current = null;
  }, []);

  useLayoutEffect(() => {
    if (!resolvedEvents.length) {
      stopResolvedPlayback();
      setShowResolvedEvents(false);
      setResolvedElapsedMs(0);
      playedAudioCuesRef.current = new Set();
      return;
    }

    const animationKey = `${turnNumber}:${resolvedSignature}`;
    if (lastResolvedAnimationKeyRef.current === animationKey) {
      return;
    }

    lastResolvedAnimationKeyRef.current = animationKey;
    stopResolvedPlayback();
    setShowResolvedEvents(true);
    setResolvedElapsedMs(0);
    playedAudioCuesRef.current = new Set();

    const tick = (now: number) => {
      if (resolvedAnimationStartRef.current === null) {
        resolvedAnimationStartRef.current = now;
      }

      const elapsedMs = now - resolvedAnimationStartRef.current;
      if (elapsedMs >= resolvedTimeline.totalMs) {
        setResolvedElapsedMs(resolvedTimeline.totalMs);
        setShowResolvedEvents(false);
        stopResolvedPlayback();
        return;
      }

      setResolvedElapsedMs(elapsedMs);
      resolvedAnimationFrameRef.current = window.requestAnimationFrame(tick);
    };

    resolvedAnimationFrameRef.current = window.requestAnimationFrame(tick);
    return stopResolvedPlayback;
  }, [resolvedEvents.length, resolvedSignature, resolvedTimeline.totalMs, stopResolvedPlayback, turnNumber]);

  useEffect(() => {
    if (!resolvedEvents.length || !showResolvedEvents) return;

    for (const cue of resolvedAudioCues) {
      const cueKey = `${turnNumber}:${resolvedSignature}:${cue.cueId}:${cue.atMs}`;
      if (playedAudioCuesRef.current.has(cueKey)) continue;
      if (resolvedElapsedMs < cue.atMs) continue;

      playedAudioCuesRef.current.add(cueKey);
      playOriginalSound(cue.soundKey, cue.volume);
    }
  }, [resolvedAudioCues, resolvedElapsedMs, resolvedEvents.length, resolvedSignature, showResolvedEvents, turnNumber]);

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

  useEffect(() => () => {
    clearHeldAction();
    stopResolvedPlayback();
  }, [clearHeldAction, stopResolvedPlayback]);

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
    e.preventDefault();
    panMovedRef.current = false;
    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, vx: viewState.x, vy: viewState.y };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }, [viewState.x, viewState.y]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanning) return;
    if (!panMovedRef.current) {
      const moved = Math.hypot(e.clientX - panStart.current.x, e.clientY - panStart.current.y);
      if (moved > 4) {
        panMovedRef.current = true;
      }
    }
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

  const consumePanClick = useCallback(() => {
    if (!panMovedRef.current) {
      return false;
    }

    panMovedRef.current = false;
    return true;
  }, []);

  const linkPairs = useMemo(
    () => systems.flatMap(system => system.neighbors.filter(neighbor => system.index < neighbor).map(neighbor => [system.index, neighbor] as const)),
    [systems]
  );
  const visibleLinkPairs = useMemo(() => {
    return linkPairs.flatMap(([fromIndex, toIndex]) => {
      const from = systemsByIndex.get(fromIndex);
      const to = systemsByIndex.get(toIndex);
      if (!from || !to) return [];

      const segment = visibleConnectionSegment(from, to, hexR);
      if (!segment) {
        return [];
      }

      return [{ fromIndex, toIndex, ...segment }];
    });
  }, [hexR, linkPairs, systemsByIndex]);
  const tannhauserSegments = useMemo(() => (
    tannhauserLinks.flatMap(link => {
      const from = systemsByIndex.get(link.fromIndex);
      const to = systemsByIndex.get(link.toIndex);
      if (!from || !to) {
        return [];
      }

      const segment = visibleConnectionSegment(from, to, hexR);
      if (!segment) {
        return [];
      }

      return [{
        key: `th-${link.fromIndex}-${link.toIndex}`,
        ...segment
      }];
    })
  ), [hexR, systemsByIndex, tannhauserLinks]);
  const displayedOwnerIndexBySystem = useMemo(() => {
    const displayed = new Map<number, number>();
    systems.forEach(system => displayed.set(system.index, system.ownerIndex));

    if (!showResolvedEvents || !resolvedEvents.length) {
      return displayed;
    }

    for (let index = resolvedEvents.length - 1; index >= 0; index -= 1) {
      const event = resolvedEvents[index]!;
      if (event.kind === 'COMBAT' && event.systemIndex !== null) {
        displayed.set(event.systemIndex, event.ownerAtCombatStart ?? -1);
        continue;
      }

      if (event.kind === 'COLLAPSE' && event.sourceIndex !== null) {
        displayed.set(event.sourceIndex, event.playerIndex ?? -1);
      }
    }

    const instantCaptureChangeAtMs = resolvedTimeline.combatStartMs > 0
      ? resolvedTimeline.combatStartMs
      : Math.max(resolvedTimeline.buildEndMs, resolvedTimeline.moveEndMs);

    resolvedEvents.forEach((event, index) => {
      if (event.kind === 'COMBAT' && event.systemIndex !== null) {
        const changeAtMs = isInstantNeutralCapture(event)
          ? instantCaptureChangeAtMs
          : resolvedTimeline.combatEndMs;
        if (resolvedElapsedMs >= changeAtMs) {
          displayed.set(event.systemIndex, event.victorIndex ?? -1);
        }
        return;
      }

      if (event.kind === 'COLLAPSE' && event.sourceIndex !== null) {
        const collapseAtMs = resolvedTimeline.retreatStartMs + index * RESOLVED_RETREAT_STAGGER_MS;
        if (resolvedElapsedMs >= collapseAtMs) {
          displayed.set(event.sourceIndex, -1);
        }
      }
    });

    return displayed;
  }, [
    resolvedElapsedMs,
    resolvedEvents,
    resolvedTimeline.buildEndMs,
    resolvedTimeline.combatEndMs,
    resolvedTimeline.combatStartMs,
    resolvedTimeline.moveEndMs,
    resolvedTimeline.retreatStartMs,
    showResolvedEvents,
    systems
  ]);

  const resolvedDisplayedGarrisonBySystem = useMemo(() => {
    const displayed = new Map<number, number>();
    systems.forEach(system => displayed.set(system.index, system.garrison));

    if (!showResolvedEvents || !resolvedEvents.length) {
      return displayed;
    }

    resolvedEvents.forEach(event => {
      if (event.kind === 'RETREAT' && event.targetIndex !== null) {
        displayed.set(
          event.targetIndex,
          Math.max(0, (displayed.get(event.targetIndex) ?? 0) - event.quantity)
        );
      }
    });

    resolvedEvents.forEach(event => {
      if (event.kind !== 'COMBAT') {
        return;
      }

      event.combatants.forEach(combatant => {
        if (combatant.sourceIndex === null || combatant.fleetsRetreated <= 0) {
          return;
        }

        const source = systemsByIndex.get(combatant.sourceIndex);
        if (!source || source.ownerIndex !== combatant.playerIndex) {
          return;
        }

        displayed.set(
          combatant.sourceIndex,
          Math.max(0, (displayed.get(combatant.sourceIndex) ?? source.garrison) - combatant.fleetsRetreated)
        );
      });
    });

    resolvedEvents.forEach(event => {
      if (event.kind === 'COMBAT' && event.systemIndex !== null) {
        displayed.set(event.systemIndex, combatResidentFleetsAtStart(event));
        return;
      }

      if (event.kind === 'COLLAPSE' && event.sourceIndex !== null) {
        displayed.set(event.sourceIndex, event.quantity);
      }
    });

    const instantCaptureChangeAtMs = resolvedTimeline.combatStartMs > 0
      ? resolvedTimeline.combatStartMs
      : Math.max(resolvedTimeline.buildEndMs, resolvedTimeline.moveEndMs);

    resolvedEvents.forEach((event, index) => {
      if (event.kind === 'COMBAT' && event.systemIndex !== null) {
        const changeAtMs = isInstantNeutralCapture(event)
          ? instantCaptureChangeAtMs
          : resolvedTimeline.combatEndMs;

        if (resolvedElapsedMs >= changeAtMs) {
          displayed.set(event.systemIndex, event.fleetsAtEnd);

          event.combatants.forEach(combatant => {
            if (combatant.sourceIndex === null || combatant.fleetsRetreated <= 0) {
              return;
            }

            const source = systemsByIndex.get(combatant.sourceIndex);
            if (!source || source.ownerIndex !== combatant.playerIndex) {
              return;
            }

            displayed.set(
              combatant.sourceIndex,
              (displayed.get(combatant.sourceIndex) ?? source.garrison) + combatant.fleetsRetreated
            );
          });
        }

        return;
      }

      if (event.kind === 'COLLAPSE' && event.sourceIndex !== null) {
        const collapseAtMs = resolvedTimeline.retreatStartMs + index * RESOLVED_RETREAT_STAGGER_MS;
        if (resolvedElapsedMs >= collapseAtMs) {
          displayed.set(event.sourceIndex, 0);
        }
      }
    });

    return displayed;
  }, [
    resolvedElapsedMs,
    resolvedEvents,
    resolvedTimeline.buildEndMs,
    resolvedTimeline.combatEndMs,
    resolvedTimeline.combatStartMs,
    resolvedTimeline.moveEndMs,
    resolvedTimeline.retreatStartMs,
    showResolvedEvents,
    systems,
    systemsByIndex
  ]);

  const plannedDisplayedGarrisonBySystem = useMemo(() => {
    const displayed = new Map<number, number>();
    systems.forEach(system => displayed.set(system.index, system.garrison));

    orders.buildOrders.forEach(order => {
      displayed.set(order.systemIndex, (displayed.get(order.systemIndex) ?? 0) + order.quantity);
    });

    orders.moveOrders.forEach(order => {
      displayed.set(order.sourceIndex, Math.max(0, (displayed.get(order.sourceIndex) ?? 0) - order.quantity));
    });

    return displayed;
  }, [orders.buildOrders, orders.moveOrders, systems]);
  const displayedGarrisonBySystem = showResolvedEvents
    ? resolvedDisplayedGarrisonBySystem
    : plannedDisplayedGarrisonBySystem;
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
      style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
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
            <stop offset="0%" stopColor="#03040c" />
            <stop offset="52%" stopColor="#050811" />
            <stop offset="100%" stopColor="#020308" />
          </linearGradient>
          <radialGradient id="board-haze-a" cx="20%" cy="18%" r="70%">
            <stop offset="0%" stopColor="rgba(44, 57, 95, 0.24)" />
            <stop offset="58%" stopColor="rgba(19, 27, 53, 0.11)" />
            <stop offset="100%" stopColor="rgba(5, 8, 17, 0)" />
          </radialGradient>
          <radialGradient id="board-haze-b" cx="75%" cy="24%" r="72%">
            <stop offset="0%" stopColor="rgba(60, 34, 88, 0.14)" />
            <stop offset="60%" stopColor="rgba(20, 24, 44, 0.07)" />
            <stop offset="100%" stopColor="rgba(5, 8, 17, 0)" />
          </radialGradient>
          <radialGradient id="board-haze-c" cx="52%" cy="74%" r="72%">
            <stop offset="0%" stopColor="rgba(11, 70, 92, 0.1)" />
            <stop offset="58%" stopColor="rgba(13, 22, 40, 0.05)" />
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

        <rect
          x={originX - contentW * 2}
          y={originY - contentH * 2}
          width={contentW * 5}
          height={contentH * 5}
          fill="rgba(0, 0, 0, 0.001)"
          onClick={() => {
            if (consumePanClick()) {
              return;
            }
            onSelectSystem(null);
          }}
        />

        <g pointerEvents="none">
          {visibleLinkPairs.map(link => {
            const dashArray = `${Math.max(3, hexR * 0.072)} ${Math.max(3, hexR * 0.082)}`;
            return (
              <g key={`lk-${link.fromIndex}-${link.toIndex}`}>
                <line
                  x1={link.source.x}
                  y1={link.source.y}
                  x2={link.target.x}
                  y2={link.target.y}
                  stroke="rgba(170, 188, 222, 0.28)"
                  strokeWidth={Math.max(2.2, hexR * 0.052)}
                  strokeLinecap="round"
                  strokeDasharray={dashArray}
                  opacity="0.92"
                  filter="url(#board-soft-glow)"
                />
                <line
                  x1={link.source.x}
                  y1={link.source.y}
                  x2={link.target.x}
                  y2={link.target.y}
                  stroke="rgba(242, 246, 255, 0.82)"
                  strokeWidth={Math.max(1.05, hexR * 0.024)}
                  strokeLinecap="round"
                  strokeDasharray={dashArray}
                  filter="url(#board-soft-glow)"
                />
              </g>
            );
          })}
        </g>

        {systems.map(system => {
          const displayedOwnerIndex = displayedOwnerIndexBySystem.get(system.index) ?? system.ownerIndex;
          const owner = displayedOwnerIndex >= 0 ? playersByIndex.get(displayedOwnerIndex) ?? null : null;
          const ownerBaseHex = owner ? playerBaseColor(owner) : null;
          const ownerAccentHex = owner ? playerAccent(owner) : null;
          const baseColor = ownerBaseHex ? darken(ownerBaseHex, 0.78) : '#1f2632';
          const accentColor = ownerAccentHex ? darken(ownerAccentHex, 0.84) : '#465267';
          const displayedGarrison = displayedGarrisonBySystem.get(system.index) ?? system.garrison;
          const projLabels = projectLabelsByTarget.get(system.index) ?? [];
          const cx = system.x;
          const cy = system.y;
          const outerR = hexR;
          const innerR = hexR * 0.88;
          const isNeutral = !owner;

          const bodyColor = isNeutral ? '#0d141d' : darken(ownerBaseHex!, 0.46);
          const innerColor = isNeutral ? '#1b222b' : baseColor;
          const borderColor = isNeutral ? '#323a46' : accentColor;
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
              onClick={event => {
                event.stopPropagation();
                if (consumePanClick()) {
                  return;
                }
                onSelectSystem(system.index);
              }}
            >
              <polygon
                points={hexPoints(cx, cy, outerR)}
                fill={bodyColor}
              />
              <polygon
                points={hexPoints(cx, cy - hexR * 0.01, innerR)}
                fill={innerColor}
                opacity={owner ? '0.58' : '0.82'}
              />
              <polygon
                points={hexPoints(cx, cy, outerR)}
                fill="none"
                stroke={borderColor}
                strokeWidth={Math.max(0.9, hexR * 0.014)}
                strokeOpacity={owner ? '0.74' : '0.72'}
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
                {displayedGarrison}
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
            const armedMove = armedMoveSource === system.index;
            const highlight = systemHighlights.get(system.index);
            const selected = selectedSystemIndex === system.index && highlight !== 'source' && !armedMove;

            let stroke: string | null = null;
            let strokeWidth = Math.max(1.1, hexR * 0.018);
            let strokeDasharray: string | undefined;
            let filter: string | undefined;
            let radius = outerR + hexR * 0.024;

            if (highlight === 'project-source') {
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
            } else if (selected) {
              stroke = 'rgba(226, 245, 255, 0.9)';
              strokeWidth = Math.max(1.8, hexR * 0.028);
              filter = 'url(#board-selection-glow)';
              radius = outerR + hexR * 0.03;
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
          {tannhauserSegments.map(link => {
            return (
              <line
                key={link.key}
                x1={link.source.x}
                y1={link.source.y}
                x2={link.target.x}
                y2={link.target.y}
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
              const baseColor = event.projectType ? projectAccentHex(event.projectType) : playerAccent(player);

              if ((event.kind === 'MOVE' || event.kind === 'RETREAT') && source && target) {
                return null;
              }

              if (event.kind === 'COLLAPSE' && system) {
                const startMs = resolvedTimeline.retreatStartMs + index * RESOLVED_RETREAT_STAGGER_MS;
                const endMs = startMs + 880;
                const primaryProgress = phaseProgress(resolvedElapsedMs, startMs, endMs);
                const secondaryStartMs = startMs + 180;
                const secondaryEndMs = secondaryStartMs + 880;
                const secondaryProgress = phaseProgress(resolvedElapsedMs, secondaryStartMs, secondaryEndMs);
                const opacity = Math.max(
                  windowOpacity(resolvedElapsedMs, startMs, endMs, 140),
                  windowOpacity(resolvedElapsedMs, secondaryStartMs, secondaryEndMs, 140)
                );
                if (opacity <= 0) {
                  return null;
                }

                const label = event.minimumGarrisonAtCollapse > event.garrisonAtCollapse
                  ? `${event.garrisonAtCollapse}<${event.minimumGarrisonAtCollapse}`
                  : event.quantity > 0
                    ? `-${event.quantity}`
                    : 'X';
                return (
                  <g key={`resolved-collapse-${index}`} opacity={opacity}>
                    <circle
                      cx={system.x}
                      cy={system.y}
                      r={lerpNumber(hexR * 0.3, hexR * 1.14, primaryProgress)}
                      fill="none"
                      stroke="rgba(255, 128, 124, 0.82)"
                      strokeWidth={Math.max(1.2, hexR * 0.028)}
                    />
                    <circle
                      cx={system.x}
                      cy={system.y}
                      r={lerpNumber(hexR * 0.3, hexR * 1.14, secondaryProgress)}
                      fill="none"
                      stroke="rgba(255, 128, 124, 0.72)"
                      strokeWidth={Math.max(1.1, hexR * 0.022)}
                    />
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
                const startMs = resolvedTimeline.buildStartMs + index * RESOLVED_BUILD_STAGGER_MS;
                const endMs = startMs + 820;
                const progress = phaseProgress(resolvedElapsedMs, startMs, endMs);
                const opacity = windowOpacity(resolvedElapsedMs, startMs, endMs, 140);
                if (opacity <= 0) {
                  return null;
                }

                return (
                  <g key={`resolved-build-${index}`} opacity={opacity}>
                    <circle
                      cx={system.x}
                      cy={system.y}
                      r={lerpNumber(hexR * 0.18, hexR * 0.92, easeInOutCubic(progress))}
                      fill="none"
                      stroke={baseColor}
                      strokeWidth={Math.max(1.2, hexR * 0.026)}
                      filter="url(#board-soft-glow)"
                    />
                    <text
                      x={system.x}
                      y={lerpNumber(system.y + hexR * 0.32, system.y - hexR * 0.04, easeInOutCubic(progress))}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={Math.max(10, hexR * 0.22)}
                      fill={baseColor}
                      fontWeight="700"
                      fontFamily="Oxanium, Chakra Petch, sans-serif"
                      filter="url(#board-soft-glow)"
                    >
                      {`+${event.quantity}`}
                    </text>
                  </g>
                );
              }

              if (event.kind === 'PROJECT') {
                const projectColor = projectAccentHex(event.projectType);
                const startMs = resolvedTimeline.buildStartMs + index * RESOLVED_BUILD_STAGGER_MS;
                const endMs = startMs + 980;
                const progress = phaseProgress(resolvedElapsedMs, startMs, endMs);
                const opacity = windowOpacity(resolvedElapsedMs, startMs, endMs, 160);
                if (opacity <= 0) {
                  return null;
                }

                if (event.projectType === 'EXOTICS' && source && target) {
                  const path = movementPath(source, target, hexR);
                  const curvePath = movementCurvePath(path.source, path.target, hexR);
                  const midpoint = quadraticPoint(path.source, path.control, path.target, 0.5);
                  return (
                    <g key={`resolved-project-${index}`} opacity={opacity}>
                      <path
                        d={curvePath}
                        pathLength={1}
                        fill="none"
                        stroke={projectColor}
                        strokeWidth={Math.max(1.4, hexR * 0.04)}
                        strokeLinecap="round"
                        strokeDasharray="1"
                        strokeDashoffset={1 - Math.max(0.06, progress)}
                        filter="url(#board-magenta-glow)"
                      />
                      {[source, target].map((endpoint, endpointIndex) => (
                        (() => {
                          const endpointStart = startMs + endpointIndex * 120;
                          const endpointEnd = endpointStart + 760;
                          const endpointProgress = phaseProgress(resolvedElapsedMs, endpointStart, endpointEnd);
                          const endpointOpacity = windowOpacity(resolvedElapsedMs, endpointStart, endpointEnd, 120);
                          if (endpointOpacity <= 0) {
                            return null;
                          }
                          return (
                            <circle
                              key={`resolved-project-endpoint-${endpoint.index}`}
                              cx={endpoint.x}
                              cy={endpoint.y}
                              r={lerpNumber(hexR * 0.18, hexR * 0.52, endpointProgress)}
                              fill="none"
                              stroke={projectColor}
                              strokeWidth={Math.max(1.1, hexR * 0.024)}
                              opacity={endpointOpacity}
                            />
                          );
                        })()
                      ))}
                      <text
                        x={midpoint.x}
                        y={midpoint.y - hexR * 0.08}
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
                  <g key={`resolved-project-${index}`} opacity={opacity}>
                    <circle
                      cx={targetSystem.x}
                      cy={targetSystem.y}
                      r={lerpNumber(hexR * 0.24, hexR * 0.96, easeInOutCubic(progress))}
                      fill="none"
                      stroke={projectColor}
                      strokeWidth={Math.max(1.4, hexR * 0.03)}
                      filter="url(#board-soft-glow)"
                    />
                    {event.projectType === 'ENERGY' && (
                      <circle
                        cx={targetSystem.x}
                        cy={targetSystem.y}
                        r={lerpNumber(hexR * 0.12, hexR * 0.46, progress)}
                        fill="rgba(255, 112, 80, 0.2)"
                        opacity={opacity * 0.82}
                      />
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
                return null;
              }

              return null;
            })}
            {resolvedMoveEvents.map(move => {
              const progress = phaseProgress(resolvedElapsedMs, resolvedTimeline.moveStartMs, resolvedTimeline.moveEndMs);
              const opacity = windowOpacity(resolvedElapsedMs, resolvedTimeline.moveStartMs, resolvedTimeline.moveEndMs + 180, 150);
              if (opacity <= 0) {
                return null;
              }

              const tokenProgress = easeInOutCubic(progress);
              const tokenPoint = quadraticPoint(move.path.source, move.path.control, move.path.target, tokenProgress);
              const curvePath = movementCurvePath(move.path.source, move.path.target, hexR);
              const arrivalProgress = phaseProgress(resolvedElapsedMs, resolvedTimeline.moveEndMs - 120, resolvedTimeline.moveEndMs + 180);
              const arrivalOpacity = windowOpacity(resolvedElapsedMs, resolvedTimeline.moveEndMs - 120, resolvedTimeline.moveEndMs + 180, 90);
              const lineOpacity = opacity * (progress < 0.9 ? 0.96 : Math.max(0, 1 - ((progress - 0.9) / 0.1)) * 0.96);
              const tokenRadius = Math.max(10, hexR * 0.18);

              return (
                <g key={move.key} opacity={0.98}>
                  <path
                    d={curvePath}
                    pathLength={1}
                    fill="none"
                    stroke={move.color}
                    strokeWidth={Math.max(1.4, hexR * 0.04)}
                    strokeLinecap="round"
                    strokeDasharray="1"
                    strokeDashoffset={1 - Math.max(0.04, progress)}
                    opacity={lineOpacity}
                    filter="url(#board-soft-glow)"
                  />
                  <g opacity={opacity}>
                    <circle
                      cx={tokenPoint.x}
                      cy={tokenPoint.y}
                      r={tokenRadius}
                      fill="rgba(7, 10, 18, 0.96)"
                      stroke={move.color}
                      strokeWidth={Math.max(1.1, hexR * 0.016)}
                      filter="url(#board-soft-glow)"
                    />
                    <text
                      x={tokenPoint.x}
                      y={tokenPoint.y + tokenRadius * 0.06}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={resolvedBadgeFontSize}
                      fill="#f7fbff"
                      fontWeight="700"
                      fontFamily="Oxanium, Chakra Petch, sans-serif"
                    >
                      {move.quantity}
                    </text>
                  </g>
                  {arrivalOpacity > 0 && (
                    <circle
                      cx={move.target.x}
                      cy={move.target.y}
                      r={lerpNumber(hexR * 0.12, hexR * 0.42, arrivalProgress)}
                      fill="none"
                      stroke={move.color}
                      strokeWidth={Math.max(1.1, hexR * 0.02)}
                      opacity={arrivalOpacity}
                    />
                  )}
                </g>
              );
            })}
            {resolvedCombatEvents.map(combat => {
              const panelOpacity = windowOpacity(resolvedElapsedMs, resolvedTimeline.combatStartMs, resolvedTimeline.postCombatEndMs, 180);
              if (panelOpacity <= 0) {
                return null;
              }

              if (combat.autoWin) {
                const panelWidth = Math.max(86, hexR * 1.68);
                const panelHeight = Math.max(58, hexR * 1.04);
                const panelX = combat.system.x - panelWidth / 2;
                const panelY = combat.system.y - panelHeight - hexR * 0.82;

                return (
                  <g key={combat.key} opacity={panelOpacity}>
                    <line
                      x1={combat.system.x}
                      y1={combat.system.y - hexR * 0.64}
                      x2={combat.system.x}
                      y2={panelY + panelHeight}
                      stroke="rgba(255, 255, 255, 0.12)"
                      strokeWidth={Math.max(1, hexR * 0.014)}
                    />
                    <rect
                      x={panelX}
                      y={panelY}
                      width={panelWidth}
                      height={panelHeight}
                      rx={Math.max(8, hexR * 0.14)}
                      fill="rgba(4, 8, 16, 0.96)"
                      stroke={combat.victorColor}
                      strokeWidth={Math.max(1.1, hexR * 0.018)}
                      opacity="0.84"
                    />
                    <text
                      x={combat.system.x}
                      y={panelY + Math.max(17, hexR * 0.27)}
                      textAnchor="middle"
                      fontSize={Math.max(7, hexR * 0.12)}
                      fill="rgba(236, 243, 252, 0.86)"
                      fontWeight="700"
                      fontFamily="Chakra Petch, sans-serif"
                    >
                      AUTO WIN
                    </text>
                    <text
                      x={combat.system.x}
                      y={panelY + panelHeight - Math.max(16, hexR * 0.24)}
                      textAnchor="middle"
                      fontSize={Math.max(13, hexR * 0.28)}
                      fill="#f7fbff"
                      fontWeight="700"
                      fontFamily="Oxanium, Chakra Petch, sans-serif"
                    >
                      {combat.fleetsAtEnd}
                    </text>
                  </g>
                );
              }

              const combatElapsed = clamp(resolvedElapsedMs - resolvedTimeline.combatStartMs, 0, resolvedTimeline.combatEndMs - resolvedTimeline.combatStartMs);
              const frame = combatFrame(combatElapsed);
              const roundBlend = easeInOutCubic(frame.t);
              const highestStart = Math.max(1, ...combat.combatants.map(combatant => combatant.fleetsAtStart));
              const slotWidth = Math.max(28, hexR * 0.44);
              const horizontalPad = Math.max(12, hexR * 0.22);
              const panelWidth = horizontalPad * 2 + slotWidth * combat.combatants.length;
              const panelHeight = Math.max(96, hexR * 1.9);
              const panelX = combat.system.x - panelWidth / 2;
              const panelY = combat.system.y - panelHeight - hexR * 0.86;
              const chartTop = panelY + Math.max(24, hexR * 0.4);
              const barBaseY = panelY + panelHeight - Math.max(18, hexR * 0.3);
              const barMaxHeight = Math.max(36, barBaseY - chartTop);
              const combatResolved = resolvedElapsedMs >= resolvedTimeline.combatEndMs;
              const statusLabel = combatResolved ? 'RESULT' : frame.label;

              return (
                <g key={combat.key} opacity={panelOpacity}>
                  <line
                    x1={combat.system.x}
                    y1={combat.system.y - hexR * 0.64}
                    x2={combat.system.x}
                    y2={panelY + panelHeight}
                    stroke="rgba(255, 255, 255, 0.12)"
                    strokeWidth={Math.max(1, hexR * 0.014)}
                  />
                  <rect
                    x={panelX}
                    y={panelY}
                    width={panelWidth}
                    height={panelHeight}
                    rx={Math.max(8, hexR * 0.14)}
                    fill="rgba(4, 8, 16, 0.96)"
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
                    stroke={combat.victorColor}
                    strokeWidth={Math.max(1.1, hexR * 0.018)}
                    opacity="0.76"
                  />
                  <text
                    x={panelX + Math.max(10, hexR * 0.18)}
                    y={panelY + Math.max(14, hexR * 0.22)}
                    textAnchor="start"
                    fontSize={Math.max(7, hexR * 0.12)}
                    fill={combat.kills > 0 ? '#ffc4b8' : 'rgba(236, 243, 252, 0.84)'}
                    fontWeight="700"
                    fontFamily="Chakra Petch, sans-serif"
                  >
                    {combat.kills > 0 ? `-${combat.kills}` : 'FIGHT'}
                  </text>
                  <text
                    x={panelX + panelWidth - Math.max(10, hexR * 0.18)}
                    y={panelY + Math.max(14, hexR * 0.22)}
                    textAnchor="end"
                    fontSize={Math.max(7, hexR * 0.12)}
                    fill="rgba(219, 228, 242, 0.82)"
                    fontWeight="700"
                    fontFamily="Chakra Petch, sans-serif"
                  >
                    {statusLabel}
                  </text>
                  {[0, 1, 2].map(roundIndex => (
                    <circle
                      key={`${combat.key}-round-${roundIndex}`}
                      cx={panelX + panelWidth / 2 - hexR * 0.16 + roundIndex * hexR * 0.16}
                      cy={panelY + Math.max(13, hexR * 0.22)}
                      r={Math.max(2.2, hexR * 0.05)}
                      fill={roundIndex <= Math.min(2, frame.fromIndex) ? 'rgba(240, 245, 255, 0.84)' : 'rgba(255, 255, 255, 0.18)'}
                    />
                  ))}
                  {combat.combatants.map((combatant, combatantIndex) => {
                    const slotX = panelX + horizontalPad + combatantIndex * slotWidth;
                    const trackWidth = Math.max(12, slotWidth * 0.54);
                    const trackX = slotX + (slotWidth - trackWidth) / 2;
                    const valueX = slotX + slotWidth / 2;
                    const fromValue = combatant.snapshots[frame.fromIndex] ?? 0;
                    const toValue = combatant.snapshots[frame.toIndex] ?? fromValue;
                    const interpolatedValue = Math.max(0, lerpNumber(fromValue, toValue, roundBlend));
                    const displayValue = Math.round(interpolatedValue);
                    const barHeight = interpolatedValue <= 0
                      ? 0
                      : Math.max(4, barMaxHeight * (interpolatedValue / highestStart));
                    const numberY = barBaseY - barHeight - Math.max(7, hexR * 0.11);

                    return (
                      <g key={`${combat.key}-combatant-${combatant.playerIndex ?? 'neutral'}-${combatantIndex}`}>
                        <rect
                          x={trackX}
                          y={chartTop}
                          width={trackWidth}
                          height={barMaxHeight}
                          rx={Math.max(2, trackWidth * 0.14)}
                          fill="rgba(255, 255, 255, 0.05)"
                          stroke="rgba(255, 255, 255, 0.08)"
                          strokeWidth={Math.max(0.8, hexR * 0.01)}
                        />
                        <rect
                          x={trackX}
                          y={barBaseY - barHeight}
                          width={trackWidth}
                          height={barHeight}
                          rx={Math.max(2, trackWidth * 0.14)}
                          fill={combatant.color}
                          opacity="0.96"
                        />
                        <text
                          x={valueX}
                          y={numberY}
                          textAnchor="middle"
                          fontSize={Math.max(8, hexR * 0.16)}
                          fill="#f7fbff"
                          fontWeight="700"
                          fontFamily="Oxanium, Chakra Petch, sans-serif"
                        >
                          {displayValue}
                        </text>
                        <circle
                          cx={valueX}
                          cy={barBaseY + Math.max(6, hexR * 0.11)}
                          r={Math.max(3, hexR * 0.06)}
                          fill={combatant.color}
                        />
                      </g>
                    );
                  })}
                </g>
              );
            })}
            {resolvedRetreatEvents.map(retreat => {
              const startMs = resolvedTimeline.retreatStartMs + retreat.sequenceIndex * RESOLVED_RETREAT_STAGGER_MS;
              const endMs = startMs + RESOLVED_RETREAT_PHASE_MS * 0.78;
              const progress = phaseProgress(resolvedElapsedMs, startMs, endMs);
              const opacity = windowOpacity(resolvedElapsedMs, startMs, endMs + 160, 150);
              if (opacity <= 0) {
                return null;
              }

              const tokenPoint = quadraticPoint(retreat.path.source, retreat.path.control, retreat.path.target, easeInOutCubic(progress));
              const curvePath = movementCurvePath(retreat.path.source, retreat.path.target, hexR);
              return (
                <g key={retreat.key} opacity={0.86}>
                  <path
                    d={curvePath}
                    pathLength={1}
                    fill="none"
                    stroke={retreat.color}
                    strokeWidth={Math.max(1.3, hexR * 0.034)}
                    strokeLinecap="round"
                    strokeDasharray={`${Math.max(3, hexR * 0.11)} ${Math.max(4, hexR * 0.09)}`}
                    opacity={opacity * 0.94}
                    filter="url(#board-soft-glow)"
                  />
                  <g opacity={opacity}>
                    <circle
                      cx={tokenPoint.x}
                      cy={tokenPoint.y}
                      r={Math.max(9, hexR * 0.17)}
                      fill="rgba(7, 10, 18, 0.94)"
                      stroke={retreat.color}
                      strokeWidth={Math.max(1, hexR * 0.015)}
                    />
                    <text
                      x={tokenPoint.x}
                      y={tokenPoint.y + hexR * 0.01}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={resolvedBadgeFontSize}
                      fill="#f7fbff"
                      fontWeight="700"
                      fontFamily="Oxanium, Chakra Petch, sans-serif"
                    >
                      {retreat.quantity}
                    </text>
                  </g>
                </g>
              );
            })}
          </g>
        )}

        <g>
          {orders.moveOrders.map((order, index) => {
            const src = systemsByIndex.get(order.sourceIndex);
            const tgt = systemsByIndex.get(order.targetIndex);
            if (!src || !tgt) return null;
            const path = movementPath(src, tgt, hexR);
            const curvePath = `M ${path.source.x} ${path.source.y} Q ${path.control.x} ${path.control.y} ${path.target.x} ${path.target.y}`;
            const badgePoint = quadraticPoint(path.source, path.control, path.target, 0.5);
            const mx = badgePoint.x;
            const my = badgePoint.y;
            const badgeR = Math.max(8, hexR * 0.18);
            const selectedOrder = selectedMoveOrderKey === moveOrderKey(order.sourceIndex, order.targetIndex);
            const editorOffset = Math.max(24, hexR * 0.44);
            const editorRadius = Math.max(10, hexR * 0.16);

            return (
              <g key={`mv-${order.sourceIndex}-${order.targetIndex}-${index}`}>
                <path
                  d={curvePath}
                  fill="none"
                  stroke={selectedOrder ? moveColor : 'rgba(242, 246, 255, 0.72)'}
                  strokeWidth={selectedOrder ? Math.max(2, hexR * 0.05) : Math.max(1.4, hexR * 0.035)}
                  strokeLinecap="round"
                  markerEnd="url(#board-move-arrow)"
                  opacity={selectedOrder ? 0.98 : 0.92}
                  filter={selectedOrder ? 'url(#board-soft-glow)' : undefined}
                  pointerEvents="none"
                />
                <g
                  className="cursor-pointer"
                  onClick={event => {
                    event.stopPropagation();
                    if (consumePanClick()) {
                      return;
                    }
                    onSelectMoveOrder(order.sourceIndex, order.targetIndex);
                  }}
                >
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
                </g>

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
