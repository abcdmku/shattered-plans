import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  PROJECT_LABELS,
  RESOURCE_DISPLAY_META,
  colorFromInt,
  formatLabel,
  isBitSet
} from '../../shared/game';
import { playOriginalSound } from '../../shared/audio';
import type {
  GameDetail,
  GameSummary,
  OrdersSnapshot,
  RoomDetail,
  SystemSnapshot
} from '../../shared/types';
import { ChatPanel } from '../../shared/ui/ChatPanel';
import { Panel } from '../../shared/ui/Panel';
import { GameBoard, type BoardHighlight } from './GameBoard';

interface GameScreenProps {
  summary: GameSummary;
  detail: GameDetail;
  roomDetail?: RoomDetail | null;
  canRematch: boolean;
  connectionStatus: string;
  notice?: string;
  onLeave: () => void;
  onRematch: () => void;
  onSendChat: (message: string) => void;
  onSetOrders: (orders: OrdersSnapshot) => void;
  onEndTurn: () => void;
  onCancelEndTurn: () => void;
  onResign: () => void;
  onRequestAlliance: (targetPlayerIndex: number) => void;
  onAcceptAlliance: (targetPlayerIndex: number) => void;
}

type PlacementMode =
  | 'NONE'
  | 'BUILD_FLEET'
  | 'MOVE_FLEET_DEST'
  | 'DEFENSIVE_NET'
  | 'TERRAFORM'
  | 'STELLAR_BOMB'
  | 'GATE_SRC'
  | 'GATE_DEST';

type ModifierState = 'default' | 'shift' | 'alt' | 'control';
type MoveAdjustAction = 'increment' | 'decrement' | 'clear';

const RESEARCH_DISPLAY_GOAL = 20;

const PROJECT_PANEL_META = [
  {
    type: 'METAL' as const,
    label: PROJECT_LABELS.METAL,
    hint: 'Select a friendly system without a defense net.',
    researchIndex: 0,
    accent: 'var(--project-metal)'
  },
  {
    type: 'BIOMASS' as const,
    label: PROJECT_LABELS.BIOMASS,
    hint: 'Select a friendly normal world to terraform.',
    researchIndex: 1,
    accent: 'var(--project-biomass)'
  },
  {
    type: 'ENERGY' as const,
    label: PROJECT_LABELS.ENERGY,
    hint: 'Select a hostile or neutral system beside your border.',
    researchIndex: 2,
    accent: 'var(--project-energy)'
  },
  {
    type: 'EXOTICS' as const,
    label: PROJECT_LABELS.EXOTICS,
    hint: 'Select a friendly anchor, then a remote non-neighbor endpoint.',
    researchIndex: 3,
    accent: 'var(--project-exotics)'
  }
] as const;

const ENDGAME_STATS_META = [
  { label: 'Max Fleet Size', index: 0 },
  { label: 'Fleets Destroyed', index: 1 },
  { label: 'Fleets Lost', index: 2 },
  { label: 'Avg Move Size', index: 3 },
  { label: 'Max Production', index: 4 },
  { label: 'Fleets Built', index: 5 },
  { label: 'Projects Used', index: 6 },
  { label: 'Research Wasted', index: 7 },
  { label: 'Successful Attacks', index: 8 },
  { label: 'Failed Attacks', index: 9 },
  { label: 'Successful Defences', index: 10 },
  { label: 'Failed Defences', index: 11 },
  { label: 'Efficiency', index: 12 },
  { label: 'Fluidity', index: 13 },
  { label: 'Aggressiveness', index: 14 },
  { label: 'Solidity', index: 15 }
] as const;

function cloneOrders(orders: OrdersSnapshot): OrdersSnapshot {
  return {
    buildOrders: orders.buildOrders.map(order => ({ ...order })),
    moveOrders: orders.moveOrders.map(order => ({ ...order })),
    projectOrders: orders.projectOrders.map(order => ({ ...order }))
  };
}

function findSystem(systems: SystemSnapshot[], index: number | null): SystemSnapshot | null {
  if (index === null) return null;
  return systems.find(system => system.index === index) ?? null;
}

function updateBuildOrder(orders: OrdersSnapshot, systemIndex: number, quantity: number): OrdersSnapshot {
  const next = cloneOrders(orders);
  next.buildOrders = next.buildOrders.filter(order => order.systemIndex !== systemIndex);
  if (quantity > 0) next.buildOrders.push({ systemIndex, quantity });
  return next;
}

function updateMoveOrder(orders: OrdersSnapshot, sourceIndex: number, targetIndex: number, quantity: number): OrdersSnapshot {
  const next = cloneOrders(orders);
  next.moveOrders = next.moveOrders.filter(order => !(order.sourceIndex === sourceIndex && order.targetIndex === targetIndex));
  if (quantity > 0) next.moveOrders.push({ sourceIndex, targetIndex, quantity });
  return next;
}

function updateProjectOrder(
  orders: OrdersSnapshot,
  project: { type: string; sourceIndex: number | null; targetIndex: number | null }
): OrdersSnapshot {
  const next = cloneOrders(orders);
  next.projectOrders = next.projectOrders.filter(order => order.type !== project.type);
  next.projectOrders.push(project);
  return next;
}

function removeProjectOrder(orders: OrdersSnapshot, type: string): OrdersSnapshot {
  const next = cloneOrders(orders);
  next.projectOrders = next.projectOrders.filter(order => order.type !== type);
  return next;
}

function orderCount(orders: OrdersSnapshot): number {
  return orders.buildOrders.length + orders.moveOrders.length + orders.projectOrders.length;
}

function moveOrderKey(sourceIndex: number, targetIndex: number): string {
  return `${sourceIndex}:${targetIndex}`;
}

function buildStepSize(modifier: ModifierState, available: number): number {
  if (available <= 0) return 0;
  if (modifier === 'control') return available;
  if (modifier === 'alt') return Math.min(5, available);
  return 1;
}

function movePlacementSize(
  modifier: ModifierState,
  remainingGarrison: number,
  minimumGarrison: number,
  garrisonsCanBeRemoved: boolean
): number {
  const spareFleets = remainingGarrison - minimumGarrison;
  let quantity = spareFleets <= 0 ? 1 : Math.ceil(spareFleets / 2);

  if (modifier === 'control') {
    quantity = spareFleets <= 0 ? remainingGarrison : spareFleets;
  } else if (modifier === 'alt') {
    quantity = 5;
  } else if (modifier === 'shift') {
    quantity = 1;
  }

  const immovableFleets = garrisonsCanBeRemoved ? 0 : minimumGarrison;
  return Math.max(0, Math.min(quantity, remainingGarrison - immovableFleets));
}

function moveAdjustSize(
  action: MoveAdjustAction,
  modifier: ModifierState,
  orderQuantity: number,
  remainingGarrison: number,
  minimumGarrison: number,
  garrisonsCanBeRemoved: boolean
): number {
  if (action === 'clear') return -orderQuantity;

  if (action === 'decrement') {
    if (modifier === 'control') return -orderQuantity;
    if (modifier === 'alt') return -Math.min(5, orderQuantity);
    return -1;
  }

  const immovableFleets = garrisonsCanBeRemoved ? 0 : minimumGarrison;
  const maxAddable = Math.max(0, remainingGarrison - immovableFleets);
  if (modifier === 'control') return maxAddable;
  if (modifier === 'alt') return Math.min(5, maxAddable);
  return Math.min(1, maxAddable);
}

function modifierState(keys: { shift: boolean; alt: boolean; control: boolean }): ModifierState {
  if (keys.control) return 'control';
  if (keys.alt) return 'alt';
  if (keys.shift) return 'shift';
  return 'default';
}

function modifierCopy(modifier: ModifierState): string {
  switch (modifier) {
    case 'control':
      return 'Ctrl: all';
    case 'alt':
      return 'Alt: 5';
    case 'shift':
      return 'Shift: 1';
    default:
      return 'Default: standard';
  }
}

function projectCommitSound(type: 'METAL' | 'BIOMASS' | 'ENERGY' | 'EXOTICS') {
  switch (type) {
    case 'METAL':
      return 'factoryNoise' as const;
    case 'BIOMASS':
      return 'shipSelection' as const;
    case 'ENERGY':
      return 'shipAttackOrder' as const;
    case 'EXOTICS':
      return 'shipMoveOrder' as const;
  }
}

function moveOrderSound(
  targetOwnerIndex: number,
  localPlayerIndex: number | null,
  localPlayer: { allies: boolean[] } | null
) {
  if (targetOwnerIndex === localPlayerIndex) {
    return 'shipMoveOrder' as const;
  }
  if (targetOwnerIndex < 0) {
    return 'shipAttackOrder' as const;
  }
  if (!localPlayer) {
    return 'shipAttackOrder' as const;
  }
  return localPlayer.allies[targetOwnerIndex] ? 'shipMoveOrder' as const : 'shipAttackOrder' as const;
}

export function GameScreen({
  summary,
  detail,
  roomDetail,
  canRematch,
  connectionStatus,
  notice,
  onLeave,
  onRematch,
  onSendChat,
  onSetOrders,
  onEndTurn,
  onCancelEndTurn,
  onRequestAlliance,
  onAcceptAlliance
}: GameScreenProps) {
  const pendingSignature = useMemo(() => JSON.stringify(detail.pendingOrders), [detail.pendingOrders]);
  const [draftOrders, setDraftOrders] = useState<OrdersSnapshot>(() => cloneOrders(detail.pendingOrders));
  const [selectedSystemIndex, setSelectedSystemIndex] = useState<number | null>(null);
  const [placementMode, setPlacementMode] = useState<PlacementMode>('NONE');
  const [selectedForceId, setSelectedForceId] = useState<string | null>(null);
  const [armedMoveSource, setArmedMoveSource] = useState<number | null>(null);
  const [armedProjectType, setArmedProjectType] = useState<string | null>(null);
  const [projectSourceIndex, setProjectSourceIndex] = useState<number | null>(null);
  const [selectedMoveOrderKey, setSelectedMoveOrderKey] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [modifierKeys, setModifierKeys] = useState({ shift: false, alt: false, control: false });
  const endedRef = useRef(detail.ended);

  useEffect(() => {
    setDraftOrders(cloneOrders(detail.pendingOrders));
  }, [pendingSignature]);

  useEffect(() => {
    setPlacementMode('NONE');
    setSelectedForceId(null);
    setArmedMoveSource(null);
    setArmedProjectType(null);
    setProjectSourceIndex(null);
    setSelectedMoveOrderKey(null);
  }, [detail.id, detail.turnNumber]);

  useEffect(() => {
    setSelectedSystemIndex(null);
  }, [detail.id]);

  useEffect(() => {
    if (selectedSystemIndex === null) return;
    if (detail.systems.some(system => system.index === selectedSystemIndex)) return;
    setSelectedSystemIndex(null);
  }, [detail.systems, selectedSystemIndex]);

  useEffect(() => {
    if (!endedRef.current && detail.ended) {
      playOriginalSound('explosion');
    }
    endedRef.current = detail.ended;
  }, [detail.ended]);

  useEffect(() => {
    const handleKeyState = (event: KeyboardEvent) => {
      setModifierKeys({
        shift: event.shiftKey,
        alt: event.altKey,
        control: event.ctrlKey || event.metaKey
      });
    };

    const clearKeys = () => setModifierKeys({ shift: false, alt: false, control: false });

    window.addEventListener('keydown', handleKeyState);
    window.addEventListener('keyup', handleKeyState);
    window.addEventListener('blur', clearKeys);

    return () => {
      window.removeEventListener('keydown', handleKeyState);
      window.removeEventListener('keyup', handleKeyState);
      window.removeEventListener('blur', clearKeys);
    };
  }, []);

  const currentModifier = modifierState(modifierKeys);
  const garrisonsCanBeRemoved = true;

  const systemByIndex = useMemo(() => new Map(detail.systems.map(system => [system.index, system])), [detail.systems]);
  const forceById = useMemo(() => new Map(detail.forces.map(force => [force.id, force])), [detail.forces]);

  const forceIdBySystemIndex = useMemo(() => {
    const mapping = new Map<number, string>();
    detail.forces.forEach(force => {
      force.systems.forEach(systemIndex => {
        mapping.set(systemIndex, force.id);
      });
    });
    return mapping;
  }, [detail.forces]);

  const remainingGarrisonBySystem = useMemo(() => {
    const remaining = new Map<number, number>();
    detail.systems.forEach(system => remaining.set(system.index, system.garrison));

    draftOrders.buildOrders.forEach(order => {
      remaining.set(order.systemIndex, (remaining.get(order.systemIndex) ?? 0) + order.quantity);
    });

    draftOrders.moveOrders.forEach(order => {
      remaining.set(order.sourceIndex, (remaining.get(order.sourceIndex) ?? 0) - order.quantity);
    });

    return remaining;
  }, [detail.systems, draftOrders.buildOrders, draftOrders.moveOrders]);

  const builtByForceId = useMemo(() => {
    const built = new Map<string, number>();
    draftOrders.buildOrders.forEach(order => {
      const forceId = forceIdBySystemIndex.get(order.systemIndex);
      if (!forceId) return;
      built.set(forceId, (built.get(forceId) ?? 0) + order.quantity);
    });
    return built;
  }, [draftOrders.buildOrders, forceIdBySystemIndex]);

  const availableBuildByForceId = useMemo(() => {
    const available = new Map<string, number>();
    detail.forces.forEach(force => {
      available.set(force.id, Math.max(0, force.fleetsAvailableToBuild - (builtByForceId.get(force.id) ?? 0)));
    });
    return available;
  }, [detail.forces, builtByForceId]);

  const localPlayer = detail.localPlayerIndex === null
    ? null
    : detail.players.find(player => player.index === detail.localPlayerIndex) ?? null;
  const victorIndexSet = useMemo(() => new Set(detail.victory.victors), [detail.victory.victors]);
  const victoriousPlayers = useMemo(
    () => detail.players.filter(player => victorIndexSet.has(player.index)),
    [detail.players, victorIndexSet]
  );
  const localForces = useMemo(
    () => (detail.localPlayerIndex === null ? [] : detail.forces.filter(force => force.playerIndex === detail.localPlayerIndex)),
    [detail.forces, detail.localPlayerIndex]
  );
  const playerResourceTotals = useMemo(() => {
    const totals = new Map<number, number[]>();
    detail.players.forEach(player => totals.set(player.index, [0, 0, 0, 0]));

    detail.systems.forEach(system => {
      if (system.ownerIndex < 0) return;

      const bucket = totals.get(system.ownerIndex) ?? [0, 0, 0, 0];
      for (let index = 0; index < 4; index += 1) {
        bucket[index] = (bucket[index] ?? 0) + (system.resources[index] ?? 0);
      }
      totals.set(system.ownerIndex, bucket);
    });

    return totals;
  }, [detail.players, detail.systems]);

  const selectedSystem = findSystem(detail.systems, selectedSystemIndex);
  const selectedOwnedByLocal = !!selectedSystem && detail.localPlayerIndex === selectedSystem.ownerIndex;
  const selectedSystemRemaining = selectedSystem
    ? (remainingGarrisonBySystem.get(selectedSystem.index) ?? selectedSystem.garrison)
    : 0;
  const selectedSystemForce = selectedOwnedByLocal && selectedSystem
    ? forceById.get(forceIdBySystemIndex.get(selectedSystem.index) ?? '')
    : null;
  const activeBuildForce = placementMode === 'BUILD_FLEET' && selectedForceId
    ? forceById.get(selectedForceId) ?? null
    : null;
  const selectedReadyForce = selectedSystemForce && (availableBuildByForceId.get(selectedSystemForce.id) ?? 0) > 0
    ? selectedSystemForce
    : null;
  const selectedForce = activeBuildForce
    ?? selectedReadyForce
    ?? localForces.find(force => (availableBuildByForceId.get(force.id) ?? 0) > 0)
    ?? null;
  const selectedMoveOrder = selectedMoveOrderKey
    ? draftOrders.moveOrders.find(order => moveOrderKey(order.sourceIndex, order.targetIndex) === selectedMoveOrderKey) ?? null
    : null;

  useEffect(() => {
    if (!selectedMoveOrderKey) return;
    if (selectedMoveOrder) return;
    setSelectedMoveOrderKey(null);
  }, [selectedMoveOrder, selectedMoveOrderKey]);

  useEffect(() => {
    if (!selectedForceId || forceById.has(selectedForceId)) return;
    setSelectedForceId(null);
  }, [forceById, selectedForceId]);

  const canCommand = !detail.ended && !detail.spectator && !!localPlayer && !localPlayer.defeated && !localPlayer.resigned;
  const everyoneEliminated = detail.players.every(player => player.defeated || player.resigned);
  const selectedForceAvailable = selectedForce
    ? availableBuildByForceId.get(selectedForce.id) ?? 0
    : 0;
  const selectedForceCapital = selectedForce
    ? findSystem(detail.systems, selectedForce.capitalIndex)
    : null;
  const turnProgress = detail.turnDurationTicks > 0
    ? Math.max(0, Math.min(100, (detail.turnTicksLeft / detail.turnDurationTicks) * 100))
    : 0;
  const queuedOrderCount = orderCount(draftOrders);
  const isOnline = connectionStatus === 'Online';
  const turnSeconds = Math.max(0, Math.ceil(detail.turnTicksLeft / 50));
  const localFleetReserve = useMemo(
    () => localForces.reduce((total, force) => total + (availableBuildByForceId.get(force.id) ?? 0), 0),
    [availableBuildByForceId, localForces]
  );
  const localOutcome = useMemo(() => {
    if (!detail.ended || detail.localPlayerIndex === null) return null;
    if (detail.victory.victors.length !== 1) {
      return victorIndexSet.has(detail.localPlayerIndex) ? 'draw' : 'loser';
    }
    return victorIndexSet.has(detail.localPlayerIndex) ? 'winner' : 'loser';
  }, [detail.ended, detail.localPlayerIndex, detail.victory.victors.length, victorIndexSet]);
  const orderedEndgamePlayers = useMemo(() => (
    [...detail.players].sort((left, right) => {
      const victorDelta = Number(victorIndexSet.has(right.index)) - Number(victorIndexSet.has(left.index));
      if (victorDelta !== 0) return victorDelta;

      const localDelta = Number(right.index === detail.localPlayerIndex) - Number(left.index === detail.localPlayerIndex);
      if (localDelta !== 0) return localDelta;

      return left.index - right.index;
    })
  ), [detail.localPlayerIndex, detail.players, victorIndexSet]);
  const winnerNames = victoriousPlayers.map(player => player.name).join(', ');
  const endgameHeadline = !detail.ended
    ? ''
    : localOutcome === 'winner'
      ? 'Victory'
      : localOutcome === 'loser'
        ? 'Defeat'
        : localOutcome === 'draw'
          ? 'Draw'
          : detail.victory.victors.length === 1
            ? `${victoriousPlayers[0]?.name ?? 'Commander'} Wins`
            : 'Draw';
  const endgameSummary = !detail.ended
    ? ''
    : detail.victory.victors.length === 1
      ? `${victoriousPlayers[0]?.name ?? 'Commander'} secured the sector.`
      : victoriousPlayers.length > 1
        ? `Shared victory: ${winnerNames}.`
        : 'No single empire held the field at the end of the round.';
  const endgameDetail = everyoneEliminated
    ? 'All empires were eliminated, defeated, or resigned by the final round.'
    : 'Final campaign standings and end-of-game statistics are listed below.';
  const armedMoveSystem = armedMoveSource === null ? null : systemByIndex.get(armedMoveSource) ?? null;
  const resolvedCollapseBanner = useMemo(() => {
    if (!detail.classicRuleset) {
      return null;
    }

    const collapseEvents = detail.resolvedEvents.filter(
      event => event.kind === 'COLLAPSE' && event.sourceIndex !== null
    );
    if (collapseEvents.length === 0) {
      return null;
    }

    if (collapseEvents.length === 1) {
      const collapse = collapseEvents[0]!;
      const systemName = systemByIndex.get(collapse.sourceIndex!)?.name ?? 'A captured system';
      if (collapse.garrisonAtCollapse > 0 && collapse.minimumGarrisonAtCollapse > 0) {
        return `Last turn: ${systemName} collapsed after combat. It had ${collapse.garrisonAtCollapse} fleet${collapse.garrisonAtCollapse === 1 ? '' : 's'} but needed ${collapse.minimumGarrisonAtCollapse} to hold.`;
      }

      return `Last turn: ${systemName} collapsed after combat because its end-of-turn garrison was too low to hold under classic rules.`;
    }

    return `Last turn: ${collapseEvents.length} systems collapsed after combat because their end-of-turn garrisons were below the hold requirement.`;
  }, [detail.classicRuleset, detail.resolvedEvents, systemByIndex]);

  const moveTargetIndexes = useMemo(() => {
    if (!localPlayer || placementMode !== 'MOVE_FLEET_DEST' || armedMoveSource === null) return [];

    const source = systemByIndex.get(armedMoveSource);
    const sourceForceId = forceIdBySystemIndex.get(armedMoveSource);
    if (!source || !sourceForceId) return [];

    return detail.systems
      .filter(system => {
        if (system.index === source.index) return false;
        if (forceIdBySystemIndex.get(system.index) === sourceForceId) return true;
        if (!source.neighbors.includes(system.index)) return false;
        return system.ownerIndex < 0 || !localPlayer.allies[system.ownerIndex];
      })
      .map(system => system.index);
  }, [armedMoveSource, detail.systems, forceIdBySystemIndex, localPlayer, placementMode, systemByIndex]);

  const buildTargetIndexes = useMemo(() => {
    if (placementMode !== 'BUILD_FLEET' || !activeBuildForce) return [];
    return activeBuildForce.systems;
  }, [activeBuildForce, placementMode]);

  const projectTargetIndexes = useMemo(() => {
    if (!localPlayer || !armedProjectType) return [];

    if (placementMode === 'DEFENSIVE_NET') {
      return detail.systems
        .filter(system => system.ownerIndex === localPlayer.index && !system.hasDefensiveNet)
        .map(system => system.index);
    }

    if (placementMode === 'TERRAFORM') {
      return detail.systems
        .filter(system => system.ownerIndex === localPlayer.index && system.score === 0)
        .map(system => system.index);
    }

    if (placementMode === 'STELLAR_BOMB') {
      return detail.systems
        .filter(system => system.ownerIndex !== localPlayer.index)
        .filter(system => system.ownerIndex < 0 || !localPlayer.allies[system.ownerIndex])
        .filter(system => system.neighbors.some(neighborIndex => systemByIndex.get(neighborIndex)?.ownerIndex === localPlayer.index))
        .map(system => system.index);
    }

    if (placementMode === 'GATE_SRC') {
      return detail.systems
        .filter(system => system.ownerIndex === localPlayer.index)
        .map(system => system.index);
    }

    if (placementMode === 'GATE_DEST' && projectSourceIndex !== null) {
      const anchor = systemByIndex.get(projectSourceIndex);
      if (!anchor) return [];
      return detail.systems
        .filter(system => system.index !== anchor.index)
        .filter(system => !anchor.neighbors.includes(system.index))
        .map(system => system.index);
    }

    return [];
  }, [armedProjectType, detail.systems, localPlayer, placementMode, projectSourceIndex, systemByIndex]);

  const projectAvailability = useMemo(() => {
    const availability = new Map<string, boolean>();
    PROJECT_PANEL_META.forEach(meta => {
      const research = localPlayer?.researchPoints[meta.researchIndex] ?? 0;
      let hasTarget = false;

      if (meta.type === 'METAL') {
        hasTarget = detail.systems.some(system => system.ownerIndex === detail.localPlayerIndex && !system.hasDefensiveNet);
      } else if (meta.type === 'BIOMASS') {
        hasTarget = detail.systems.some(system => system.ownerIndex === detail.localPlayerIndex && system.score === 0);
      } else if (meta.type === 'ENERGY') {
        hasTarget = detail.systems.some(system =>
          system.ownerIndex !== detail.localPlayerIndex
          && (system.ownerIndex < 0 || !(localPlayer?.allies[system.ownerIndex] ?? false))
          && system.neighbors.some(neighborIndex => systemByIndex.get(neighborIndex)?.ownerIndex === detail.localPlayerIndex));
      } else {
        hasTarget = detail.systems.some(system =>
          system.ownerIndex === detail.localPlayerIndex
          && detail.systems.some(other => other.index !== system.index && !system.neighbors.includes(other.index)));
      }

      availability.set(meta.type, research >= RESEARCH_DISPLAY_GOAL && hasTarget);
    });
    return availability;
  }, [detail.localPlayerIndex, detail.systems, localPlayer, systemByIndex]);

  const systemHighlights = useMemo(() => {
    const highlights = new Map<number, BoardHighlight>();

    if (placementMode === 'MOVE_FLEET_DEST') {
      if (armedMoveSource !== null) highlights.set(armedMoveSource, 'source');
      moveTargetIndexes.forEach(index => highlights.set(index, 'candidate'));
    } else if (placementMode === 'BUILD_FLEET') {
      buildTargetIndexes.forEach(index => highlights.set(index, 'build'));
    } else if (placementMode === 'GATE_SRC') {
      projectTargetIndexes.forEach(index => highlights.set(index, 'candidate'));
    } else if (placementMode === 'GATE_DEST') {
      if (projectSourceIndex !== null) highlights.set(projectSourceIndex, 'project-source');
      projectTargetIndexes.forEach(index => highlights.set(index, 'project-target'));
    } else if (placementMode !== 'NONE') {
      projectTargetIndexes.forEach(index => highlights.set(index, 'project-target'));
    }

    return highlights;
  }, [armedMoveSource, buildTargetIndexes, moveTargetIndexes, placementMode, projectSourceIndex, projectTargetIndexes]);

  const commitOrders = (next: OrdersSnapshot) => {
    setDraftOrders(next);
    onSetOrders(next);
  };

  const clearPlacementState = () => {
    setPlacementMode('NONE');
    setSelectedForceId(null);
    setArmedMoveSource(null);
    setArmedProjectType(null);
    setProjectSourceIndex(null);
    setSelectedMoveOrderKey(null);
  };

  const activateBuildPlacement = () => {
    if (!canCommand) return;

    const preferredForce = selectedSystemForce ?? localForces.find(force => (availableBuildByForceId.get(force.id) ?? 0) > 0) ?? null;
    if (!preferredForce || (availableBuildByForceId.get(preferredForce.id) ?? 0) <= 0) return;

    if (placementMode === 'BUILD_FLEET' && selectedForceId === preferredForce.id) {
      playOriginalSound('nextClose');
      clearPlacementState();
      return;
    }

    playOriginalSound('nextOpen');
    setSelectedMoveOrderKey(null);
    setPlacementMode('BUILD_FLEET');
    setSelectedForceId(preferredForce.id);
    setArmedMoveSource(null);
    setArmedProjectType(null);
    setProjectSourceIndex(null);
  };

  const armProject = (type: 'METAL' | 'BIOMASS' | 'ENERGY' | 'EXOTICS') => {
    if (!canCommand || !projectAvailability.get(type)) return;

    const nextMode: PlacementMode = type === 'METAL'
      ? 'DEFENSIVE_NET'
      : type === 'BIOMASS'
        ? 'TERRAFORM'
        : type === 'ENERGY'
          ? 'STELLAR_BOMB'
          : 'GATE_SRC';

    if (placementMode === nextMode && armedProjectType === type) {
      playOriginalSound('nextClose');
      clearPlacementState();
      return;
    }

    playOriginalSound('nextOpen');
    setSelectedMoveOrderKey(null);
    setPlacementMode(nextMode);
    setSelectedForceId(null);
    setArmedMoveSource(null);
    setArmedProjectType(type);
    setProjectSourceIndex(null);
  };

  const selectMoveOrder = (sourceIndex: number, targetIndex: number) => {
    playOriginalSound('shipSelection');
    setSelectedMoveOrderKey(moveOrderKey(sourceIndex, targetIndex));
    setPlacementMode('MOVE_FLEET_DEST');
    setSelectedForceId(null);
    setArmedMoveSource(sourceIndex);
    setArmedProjectType(null);
    setProjectSourceIndex(null);
    setSelectedSystemIndex(targetIndex);
  };

  const adjustSelectedMoveOrder = (action: MoveAdjustAction) => {
    if (!selectedMoveOrder) return;

    const source = systemByIndex.get(selectedMoveOrder.sourceIndex);
    if (!source) return;

    const remaining = remainingGarrisonBySystem.get(source.index) ?? source.garrison;
    const delta = moveAdjustSize(
      action,
      currentModifier,
      selectedMoveOrder.quantity,
      remaining,
      source.minimumGarrison,
      garrisonsCanBeRemoved
    );

    const nextQuantity = Math.max(0, selectedMoveOrder.quantity + delta);
    const next = updateMoveOrder(draftOrders, selectedMoveOrder.sourceIndex, selectedMoveOrder.targetIndex, nextQuantity);
    commitOrders(next);
    if (delta !== 0) {
      playOriginalSound(nextQuantity <= 0 ? 'nextClose' : 'shipMoveOrder');
    }

    if (nextQuantity <= 0) {
      setSelectedMoveOrderKey(null);
    }
  };

  const cancelBoardAction = (systemIndex: number | null) => {
    if (placementMode !== 'NONE') {
      playOriginalSound('nextClose');
      clearPlacementState();
      return;
    }

    setSelectedMoveOrderKey(null);

    if (systemIndex === null) {
      setSelectedSystemIndex(null);
      return;
    }

    const project = draftOrders.projectOrders.find(order =>
      order.targetIndex === systemIndex || order.sourceIndex === systemIndex);

    if (!project) return;
    playOriginalSound('nextClose');
    commitOrders(removeProjectOrder(draftOrders, project.type));
  };

  const handleSystemSelect = (systemIndex: number | null) => {
    if (systemIndex === null) {
      setSelectedSystemIndex(null);
      setSelectedMoveOrderKey(null);
      if (placementMode === 'MOVE_FLEET_DEST') {
        setPlacementMode('NONE');
        setArmedMoveSource(null);
      }
      return;
    }

    const system = systemByIndex.get(systemIndex);
    if (!system) return;

    if (!canCommand) {
      setSelectedSystemIndex(systemIndex);
      setSelectedMoveOrderKey(null);
      return;
    }

    if (placementMode === 'MOVE_FLEET_DEST') {
      const source = armedMoveSource === null ? null : systemByIndex.get(armedMoveSource);
      if (source && moveTargetIndexes.includes(systemIndex)) {
        const existing = draftOrders.moveOrders.find(order => order.sourceIndex === source.index && order.targetIndex === systemIndex);
        const movable = remainingGarrisonBySystem.get(source.index) ?? source.garrison;
        const quantity = movePlacementSize(currentModifier, movable, source.minimumGarrison, garrisonsCanBeRemoved);
        if (quantity > 0) {
          commitOrders(updateMoveOrder(draftOrders, source.index, systemIndex, (existing?.quantity ?? 0) + quantity));
          playOriginalSound(moveOrderSound(system.ownerIndex, detail.localPlayerIndex, localPlayer));
          setSelectedMoveOrderKey(moveOrderKey(source.index, systemIndex));
        }
        return;
      }

      const remaining = remainingGarrisonBySystem.get(systemIndex) ?? system.garrison;
      if (system.ownerIndex === detail.localPlayerIndex && remaining > 0) {
        playOriginalSound('shipSelection');
        setArmedMoveSource(systemIndex);
        setSelectedMoveOrderKey(null);
      }
      return;
    }

    if (placementMode === 'NONE') {
      if (system.ownerIndex !== detail.localPlayerIndex) {
        return;
      }

      playOriginalSound('shipSelection');
      setSelectedSystemIndex(systemIndex);
      setSelectedMoveOrderKey(null);
      const remaining = remainingGarrisonBySystem.get(systemIndex) ?? system.garrison;
      if (remaining > 0) {
        setPlacementMode('MOVE_FLEET_DEST');
        setArmedMoveSource(systemIndex);
      }
      return;
    }

    if (placementMode === 'BUILD_FLEET') {
      setSelectedSystemIndex(systemIndex);
      if (!activeBuildForce || !buildTargetIndexes.includes(systemIndex)) return;

      const available = availableBuildByForceId.get(activeBuildForce.id) ?? 0;
      const quantity = buildStepSize(currentModifier, available);
      if (quantity <= 0) return;

      const existing = draftOrders.buildOrders.find(order => order.systemIndex === systemIndex);
      commitOrders(updateBuildOrder(draftOrders, systemIndex, (existing?.quantity ?? 0) + quantity));
      playOriginalSound('factoryNoise');

      const remainingReserve = available - quantity;
      if (remainingReserve > 0) return;

      const nextForce = localForces.find(force =>
        force.id !== activeBuildForce.id && (availableBuildByForceId.get(force.id) ?? 0) > 0);

      if (nextForce) {
        setSelectedForceId(nextForce.id);
      } else {
        clearPlacementState();
      }
      return;
    }

    setSelectedSystemIndex(systemIndex);

    if (placementMode === 'DEFENSIVE_NET' && projectTargetIndexes.includes(systemIndex)) {
      playOriginalSound(projectCommitSound('METAL'));
      commitOrders(updateProjectOrder(draftOrders, { type: 'METAL', sourceIndex: null, targetIndex: systemIndex }));
      clearPlacementState();
      return;
    }

    if (placementMode === 'TERRAFORM' && projectTargetIndexes.includes(systemIndex)) {
      playOriginalSound(projectCommitSound('BIOMASS'));
      commitOrders(updateProjectOrder(draftOrders, { type: 'BIOMASS', sourceIndex: null, targetIndex: systemIndex }));
      clearPlacementState();
      return;
    }

    if (placementMode === 'STELLAR_BOMB' && projectTargetIndexes.includes(systemIndex)) {
      playOriginalSound(projectCommitSound('ENERGY'));
      commitOrders(updateProjectOrder(draftOrders, { type: 'ENERGY', sourceIndex: null, targetIndex: systemIndex }));
      clearPlacementState();
      return;
    }

    if (placementMode === 'GATE_SRC') {
      if (system.ownerIndex === detail.localPlayerIndex) {
        playOriginalSound('nextOpen');
        setPlacementMode('GATE_DEST');
        setProjectSourceIndex(systemIndex);
      }
      return;
    }

    if (placementMode === 'GATE_DEST') {
      if (projectSourceIndex !== null && projectTargetIndexes.includes(systemIndex)) {
        playOriginalSound(projectCommitSound('EXOTICS'));
        commitOrders(updateProjectOrder(draftOrders, { type: 'EXOTICS', sourceIndex: systemIndex, targetIndex: projectSourceIndex }));
        clearPlacementState();
      }
      return;
    }

    setSelectedMoveOrderKey(null);
  };

  const defaultBoardPrompt = detail.spectator
    ? 'Spectator feed active. Track the battlefield and watch orders resolve.'
    : selectedMoveOrder
      ? `Route selected. ${modifierCopy(currentModifier)} on-map editor adjusts the route and stays active while you edit.`
      : placementMode === 'MOVE_FLEET_DEST'
        ? `Routing from ${armedMoveSystem?.name ?? 'the selected system'}. Click a destination to add fleets, or click another owned system to switch the source.`
        : placementMode === 'BUILD_FLEET'
          ? `Place fleets in territory ${selectedForceCapital?.name ?? 'territory'} (${selectedForceAvailable} remaining). Placement stays active until that reserve is spent or you cancel.`
          : placementMode === 'DEFENSIVE_NET'
            ? 'Select a friendly system to construct a defense net, or right click to cancel this project.'
            : placementMode === 'TERRAFORM'
              ? 'Select a friendly normal world to commence terraforming, or right click to cancel this project.'
              : placementMode === 'STELLAR_BOMB'
                ? 'Select a hostile or neutral system beside your border, or right click to cancel this project.'
                : placementMode === 'GATE_SRC'
                  ? 'Select a friendly system to anchor one end of the Tannhauser wormhole.'
                : placementMode === 'GATE_DEST'
                  ? 'Select a remote non-neighbor system to anchor the other end of the Tannhauser wormhole.'
                  : selectedOwnedByLocal
                      ? selectedSystemRemaining > 0
                        ? `Selected ${selectedSystem?.name ?? 'system'}. Click it to start routing fleets, click another owned system to route from there, or click an existing fleet arrow to edit that route.`
                        : `Selected ${selectedSystem?.name ?? 'system'}. No fleets can move from here right now. Click another owned system to start routing fleets, or click an existing fleet arrow to edit that route.`
                      : selectedSystem
                        ? `Selected ${selectedSystem.name}. Click one of your systems to start routing fleets, or click an existing fleet arrow to edit that route.`
                        : 'Click one of your systems to start routing fleets, or click an existing fleet arrow to edit that route.';
  const boardPrompt = placementMode === 'NONE' && selectedSystem === null && resolvedCollapseBanner
    ? resolvedCollapseBanner
    : defaultBoardPrompt;

  const buildActionLabel = placementMode === 'BUILD_FLEET' ? 'Cancel' : 'Place Fleets';
  const toggleChat = () => {
    playOriginalSound(chatOpen ? 'nextClose' : 'nextOpen');
    setChatOpen(open => !open);
  };

  if (!detail.systems.length) {
    return null;
  }

  return (
    <div className="game-shell">
      <div className="game-board-stage">
        <GameBoard
          systems={detail.systems}
          players={detail.players}
          tannhauserLinks={detail.tannhauserLinks}
          orders={draftOrders}
          resolvedEvents={detail.resolvedEvents}
          localPlayerIndex={detail.localPlayerIndex}
          selectedSystemIndex={selectedSystemIndex}
          armedMoveSource={armedMoveSource}
          armedProjectType={armedProjectType}
          systemHighlights={systemHighlights}
          selectedMoveOrderKey={selectedMoveOrderKey}
          turnNumber={detail.turnNumber}
          onSelectSystem={handleSystemSelect}
          onSelectMoveOrder={selectMoveOrder}
          onAdjustSelectedMoveOrder={adjustSelectedMoveOrder}
          onCancelPlacement={cancelBoardAction}
        />

        <div className="game-board-banner">
          <span className={`signal-dot ${isOnline ? 'is-online' : 'is-offline'}`} />
          <span>{notice ?? boardPrompt}</span>
        </div>
      </div>

      <div className="game-brand">
        <div className="game-brand-title">SHATTERED PLANS</div>
      </div>

      <div className="game-overlays">
        <aside className="game-rail game-left-rail">
          <Panel title="COMMANDERS" compact className="game-panel">
            <div className="game-rail-note">Signal {connectionStatus}</div>
            <div className="commander-stack">
              {detail.players.map(player => {
                const incoming = localPlayer ? isBitSet(localPlayer.incomingPactOffersBitmap, player.index) : false;
                const outgoing = localPlayer ? isBitSet(localPlayer.outgoingPactOffersBitmap, player.index) : false;
                const allied = localPlayer ? localPlayer.allies[player.index] : false;

                let control = (
                  <span className="commander-pill is-muted">
                    {player.defeated ? 'Defeated' : player.resigned ? 'Resigned' : 'Scanning'}
                  </span>
                );

                if (player.index === detail.localPlayerIndex) {
                  control = <span className="commander-pill is-local">Local</span>;
                } else if (canCommand && localPlayer) {
                  if (allied) {
                    control = <span className="commander-pill is-allied">Allied</span>;
                  } else if (incoming) {
                    control = (
                      <button
                        className="commander-pill is-accept"
                        onClick={() => {
                          playOriginalSound('nextOpen');
                          onAcceptAlliance(player.index);
                        }}
                      >
                        Accept
                      </button>
                    );
                  } else {
                    control = (
                      <button
                        className={`commander-pill ${outgoing ? 'is-muted' : ''}`}
                        disabled={outgoing || player.defeated || player.resigned}
                        onClick={() => {
                          playOriginalSound('nextOpen');
                          onRequestAlliance(player.index);
                        }}
                      >
                        {outgoing ? 'Pending' : 'Diplomacy'}
                      </button>
                    );
                  }
                }

                return (
                  <article
                    key={player.index}
                    className={`commander-card ${player.index === detail.localPlayerIndex ? 'is-local' : ''}`}
                    style={{ '--commander-accent': colorFromInt(player.accentColor) } as CSSProperties}
                  >
                    <div className="commander-card-strip" />
                    <div className="commander-card-main">
                      <div className="commander-card-head">
                        <div className="commander-card-identity">
                          <div className="commander-card-name">{player.name}</div>
                          {(player.defeated || player.resigned) && (
                            <div className="commander-card-status">
                              {player.defeated ? 'Defeated' : 'Resigned'}
                            </div>
                          )}
                        </div>
                        {control}
                      </div>

                      <div className="commander-research">
                        <span className="commander-research-prefix">R</span>
                        {RESOURCE_DISPLAY_META.map((resource, index) => (
                          <span key={resource.label} className="commander-research-group">
                            {index > 0 && <span className="commander-research-separator">/</span>}
                            <span
                              className="commander-research-value"
                              style={{ color: resource.color }}
                            >
                              {playerResourceTotals.get(player.index)?.[resource.index] ?? 0}
                            </span>
                          </span>
                        ))}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </Panel>
        </aside>

        <aside className="game-rail game-right-rail">
          <Panel compact className="game-panel orders-panel">
            <div className="orders-panel-head">
              <div className="orders-panel-heading">
                <h2 className="orders-panel-title">TACTICAL ORDERS</h2>
                <span className="orders-panel-count">{queuedOrderCount} queued</span>
              </div>
              <button
                className="hud-chip"
                onClick={() => {
                  playOriginalSound('nextClose');
                  onLeave();
                }}
              >
                Leave Game
              </button>
            </div>

            <button
              className={`fleet-status-card ${placementMode === 'BUILD_FLEET' ? 'is-active' : ''}`}
              disabled={!canCommand || !selectedForce || selectedForceAvailable <= 0}
              onClick={activateBuildPlacement}
              type="button"
            >
              <div className="section-eyebrow">Fleets</div>
              <div className="fleet-status-main">
                <span className="fleet-status-value">{localPlayer ? localFleetReserve : '--'}</span>
                <span className="fleet-status-unit">ready</span>
              </div>
              <div className="fleet-status-copy">
                {selectedForce
                  ? `${selectedForceCapital?.name ?? 'Territory'} reserve ${selectedForceAvailable}. ${placementMode === 'BUILD_FLEET' ? 'Click again to cancel placement.' : 'Click to place fleets in the active territory.'}`
                  : canCommand
                    ? 'Select one of your systems to focus a territory, then place fleets from here.'
                    : 'Fleet placement unavailable.'}
              </div>
              <div className="fleet-status-action">{buildActionLabel}</div>
            </button>

            <div className="project-list">
              {PROJECT_PANEL_META.map(meta => {
                const research = localPlayer?.researchPoints[meta.researchIndex] ?? 0;
                const active = draftOrders.projectOrders.some(order => order.type === meta.type);
                const armed = armedProjectType === meta.type;
                const ready = projectAvailability.get(meta.type) ?? false;
                const status = armed
                  ? 'Armed'
                  : active
                    ? 'Queued'
                    : ready
                      ? 'Ready'
                      : `${Math.max(0, RESEARCH_DISPLAY_GOAL - research)} short`;

                return (
                  <button
                    key={meta.type}
                    className={`project-row ${active ? 'is-active' : ''} ${armed ? 'is-armed' : ''}`}
                    disabled={!canCommand || !ready}
                    style={{ '--project-accent': meta.accent } as CSSProperties}
                    onClick={() => armProject(meta.type)}
                    type="button"
                  >
                    <div className="project-row-head">
                      <span>{meta.label}</span>
                      <strong>{research}/{RESEARCH_DISPLAY_GOAL}</strong>
                    </div>
                    <div className="project-row-copy">
                      <span>{status}</span>
                      <span>{armed ? 'Choose target' : active ? 'Re-arm' : ready ? 'Arm' : 'Locked'}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="orders-lock-card">
              <div className="orders-lock-copy">
                <div className="section-eyebrow">Turn</div>
                <div className="orders-lock-title">
                  {detail.endedTurn ? 'Orders locked in.' : `${queuedOrderCount} orders ready for commit.`}
                </div>
              </div>
              {canCommand && (
                detail.endedTurn
                  ? (
                    <button
                      className="turn-lock-button is-locked"
                      onClick={() => {
                        playOriginalSound('nextClose');
                        onCancelEndTurn();
                      }}
                    >
                      Unlock
                    </button>
                  )
                  : (
                    <button
                      className="turn-lock-button"
                      onClick={() => {
                        playOriginalSound('nextOpen');
                        onEndTurn();
                      }}
                    >
                      Lock In
                    </button>
                  )
              )}
            </div>
          </Panel>
        </aside>
      </div>

      {detail.ended && (
        <div className="game-end-overlay">
          <div className="game-end-backdrop" />
          <section className="game-end-panel">
            <div className="game-end-header">
              <div className="section-eyebrow">Campaign Complete</div>
              <h2 className="game-end-title">{endgameHeadline}</h2>
              <p className="game-end-summary">{endgameSummary}</p>
              <p className="game-end-copy">{endgameDetail}</p>
              {victoriousPlayers.length > 0 && (
                <div className="game-end-winners">
                  {victoriousPlayers.map(player => (
                    <span
                      key={player.index}
                      className="game-end-winner-pill"
                      style={{ '--winner-accent': colorFromInt(player.accentColor) } as CSSProperties}
                    >
                      {player.name}
                    </span>
                  ))}
                </div>
              )}
              {!canRematch && roomDetail && (
                <div className="game-end-note">
                  {roomDetail.ownerName} can launch the rematch from this screen.
                </div>
              )}
            </div>

            <div className="game-end-actions">
              {canRematch && (
                <button
                  className="turn-lock-button"
                  onClick={() => {
                    playOriginalSound('nextOpen');
                    onRematch();
                  }}
                  type="button"
                >
                  Rematch
                </button>
              )}
              <button
                className="hud-chip"
                onClick={() => {
                  playOriginalSound('nextClose');
                  onLeave();
                }}
                type="button"
              >
                Lobby
              </button>
            </div>

            <div className="game-end-stats-grid">
              {orderedEndgamePlayers.map(player => {
                const isVictor = victorIndexSet.has(player.index);
                const statusLabel = isVictor
                  ? detail.victory.victors.length === 1 ? 'Winner' : 'Draw'
                  : player.resigned
                    ? 'Resigned'
                    : player.defeated
                      ? 'Defeated'
                      : 'Loser';

                return (
                  <article
                    key={player.index}
                    className={`game-end-player-card ${isVictor ? 'is-victor' : ''}`}
                    style={{ '--endgame-accent': colorFromInt(player.accentColor) } as CSSProperties}
                  >
                    <div className="game-end-player-head">
                      <div className="game-end-player-identity">
                        <div className="game-end-player-name">{player.name}</div>
                        <div className="game-end-player-state">
                          {player.resigned ? 'Resigned from the war' : player.defeated ? 'Empire defeated' : 'Campaign completed'}
                        </div>
                      </div>
                      <span className={`game-end-player-chip ${isVictor ? 'is-victor' : ''}`}>
                        {statusLabel}
                      </span>
                    </div>

                    <div className="game-end-player-stats">
                      {ENDGAME_STATS_META.map(stat => (
                        <div key={`${player.index}-${stat.label}`} className="game-end-player-stat">
                          <span>{stat.label}</span>
                          <strong>{player.stats[stat.index] ?? '--'}</strong>
                        </div>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      )}

      <div className="chat-fab-stack">
        {chatOpen && (
          <div className="chat-drawer">
            <Panel title="COMMS" compact className="game-panel">
              <ChatPanel messages={detail.messages} disabled={false} placeholder="Transmit order..." onSend={onSendChat} />
            </Panel>
          </div>
        )}
        <button
          className={`chat-fab ${chatOpen ? 'is-open' : ''}`}
          onClick={toggleChat}
          type="button"
          aria-label={chatOpen ? 'Close chat' : 'Open chat'}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M5 6h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 3v-3H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M8 12h8M8 9h5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="game-bottom-dock">
        <div className="turn-dock">
          <div className="turn-progress-track">
            <div className="turn-progress-fill" style={{ width: `${turnProgress}%` }} />
          </div>
          <div className="turn-meta">
            <span className="turn-meta-primary">Turn {summary.turn}</span>
            <span>{formatLabel(summary.phase)}</span>
            <span>{turnSeconds}s</span>
            {detail.spectator && <span>Spectating</span>}
            {!detail.spectator && summary.waitingOn > 0 && <span>Waiting on {summary.waitingOn}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
