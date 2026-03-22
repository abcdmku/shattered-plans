import { useEffect, useMemo, useState } from 'react';
import {
  PROJECT_LABELS,
  RESOURCE_LABELS,
  STAT_LABELS,
  colorFromInt,
  formatLabel,
  isBitSet,
  projectLabel,
  shortProjectLabel
} from '../../shared/game';
import type {
  GameDetail,
  GamePlayer,
  GameSummary,
  OrdersSnapshot,
  ProjectOrderSnapshot,
  RoomDetail,
  SystemSnapshot
} from '../../shared/types';
import { ChatPanel } from '../../shared/ui/ChatPanel';
import { Panel } from '../../shared/ui/Panel';
import { GameBoard } from './GameBoard';

interface GameScreenProps {
  summary: GameSummary;
  detail: GameDetail;
  roomDetail?: RoomDetail | null;
  connectionStatus: string;
  notice?: string;
  onLeave: () => void;
  onSendChat: (message: string) => void;
  onSetOrders: (orders: OrdersSnapshot) => void;
  onEndTurn: () => void;
  onCancelEndTurn: () => void;
  onResign: () => void;
  onRequestAlliance: (targetPlayerIndex: number) => void;
  onAcceptAlliance: (targetPlayerIndex: number) => void;
}

function cloneOrders(orders: OrdersSnapshot): OrdersSnapshot {
  return {
    buildOrders: orders.buildOrders.map(order => ({ ...order })),
    moveOrders: orders.moveOrders.map(order => ({ ...order })),
    projectOrders: orders.projectOrders.map(order => ({ ...order }))
  };
}

function eventLabel(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/Event$/, '');
}

function findSystem(systems: SystemSnapshot[], index: number | null): SystemSnapshot | null {
  if (index === null) {
    return null;
  }
  return systems.find(system => system.index === index) ?? null;
}

function updateBuildOrder(orders: OrdersSnapshot, systemIndex: number, quantity: number): OrdersSnapshot {
  const next = cloneOrders(orders);
  next.buildOrders = next.buildOrders.filter(order => order.systemIndex !== systemIndex);
  if (quantity > 0) {
    next.buildOrders.push({ systemIndex, quantity });
  }
  return next;
}

function updateMoveOrder(orders: OrdersSnapshot, sourceIndex: number, targetIndex: number, quantity: number): OrdersSnapshot {
  const next = cloneOrders(orders);
  next.moveOrders = next.moveOrders.filter(order => !(order.sourceIndex === sourceIndex && order.targetIndex === targetIndex));
  if (quantity > 0) {
    next.moveOrders.push({ sourceIndex, targetIndex, quantity });
  }
  return next;
}

function updateProjectOrder(orders: OrdersSnapshot, project: ProjectOrderSnapshot | null): OrdersSnapshot {
  const next = cloneOrders(orders);
  if (project) {
    next.projectOrders = next.projectOrders.filter(order => order.type !== project.type);
    next.projectOrders.push(project);
  } else {
    next.projectOrders = [];
  }
  return next;
}

export function GameScreen({
  summary,
  detail,
  roomDetail,
  connectionStatus,
  notice,
  onLeave,
  onSendChat,
  onSetOrders,
  onEndTurn,
  onCancelEndTurn,
  onResign,
  onRequestAlliance,
  onAcceptAlliance
}: GameScreenProps) {
  const pendingSignature = useMemo(() => JSON.stringify(detail.pendingOrders), [detail.pendingOrders]);
  const [draftOrders, setDraftOrders] = useState<OrdersSnapshot>(() => cloneOrders(detail.pendingOrders));
  const [selectedSystemIndex, setSelectedSystemIndex] = useState<number | null>(detail.systems[0]?.index ?? null);
  const [armedMoveSource, setArmedMoveSource] = useState<number | null>(null);
  const [armedProjectType, setArmedProjectType] = useState<string | null>(null);
  const [projectSourceIndex, setProjectSourceIndex] = useState<number | null>(null);
  const [statsPlayerIndex, setStatsPlayerIndex] = useState<number>(detail.localPlayerIndex ?? detail.players[0]?.index ?? 0);

  useEffect(() => {
    setDraftOrders(cloneOrders(detail.pendingOrders));
    setArmedMoveSource(null);
    setArmedProjectType(null);
    setProjectSourceIndex(null);
  }, [detail.id, detail.turnNumber, pendingSignature]);

  useEffect(() => {
    if (selectedSystemIndex !== null && detail.systems.some(system => system.index === selectedSystemIndex)) {
      return;
    }
    setSelectedSystemIndex(detail.systems[0]?.index ?? null);
  }, [detail.systems, selectedSystemIndex]);

  const localPlayer = detail.localPlayerIndex === null
    ? null
    : detail.players.find(player => player.index === detail.localPlayerIndex) ?? null;
  const selectedSystem = findSystem(detail.systems, selectedSystemIndex);
  const selectedOwner = selectedSystem && selectedSystem.ownerIndex >= 0
    ? detail.players.find(player => player.index === selectedSystem.ownerIndex) ?? null
    : null;
  const selectedForce = selectedSystem
    ? detail.forces.find(force => force.playerIndex === selectedSystem.ownerIndex && force.systems.includes(selectedSystem.index)) ?? null
    : null;
  const selectedBuildOrder = selectedSystem ? draftOrders.buildOrders.find(order => order.systemIndex === selectedSystem.index) ?? null : null;
  const canCommand = !detail.ended && !detail.spectator && !!localPlayer && !localPlayer.defeated && !localPlayer.resigned;
  const selectedOwnedByLocal = !!selectedSystem && detail.localPlayerIndex === selectedSystem.ownerIndex;
  const statsPlayer = detail.players.find(player => player.index === statsPlayerIndex) ?? detail.players[0] ?? null;
  const turnProgress = detail.turnDurationTicks > 0
    ? Math.max(0, Math.min(100, (detail.turnTicksLeft / detail.turnDurationTicks) * 100))
    : 0;
  const victoryLeaders = detail.victory.leaders
    .map(index => detail.players.find(player => player.index === index)?.name)
    .filter(Boolean)
    .join(', ');
  const victors = detail.victory.victors
    .map(index => detail.players.find(player => player.index === index)?.name)
    .filter(Boolean)
    .join(', ');

  const commitOrders = (next: OrdersSnapshot) => {
    setDraftOrders(next);
    onSetOrders(next);
  };

  const adjustSelectedBuildOrder = (delta: number) => {
    if (!selectedSystem || !selectedOwnedByLocal) {
      return;
    }
    const nextQuantity = Math.max(0, (selectedBuildOrder?.quantity ?? 0) + delta);
    commitOrders(updateBuildOrder(draftOrders, selectedSystem.index, nextQuantity));
  };

  const handleSystemSelect = (systemIndex: number) => {
    if (armedMoveSource !== null && armedMoveSource !== systemIndex) {
      const existing = draftOrders.moveOrders.find(
        order => order.sourceIndex === armedMoveSource && order.targetIndex === systemIndex
      );
      commitOrders(updateMoveOrder(draftOrders, armedMoveSource, systemIndex, (existing?.quantity ?? 0) + 1));
      setArmedMoveSource(null);
      setSelectedSystemIndex(systemIndex);
      return;
    }

    if (armedProjectType === 'EXOTICS' && projectSourceIndex !== null && projectSourceIndex !== systemIndex) {
      commitOrders(updateProjectOrder(draftOrders, { type: 'EXOTICS', sourceIndex: projectSourceIndex, targetIndex: systemIndex }));
      setArmedProjectType(null);
      setProjectSourceIndex(null);
      setSelectedSystemIndex(systemIndex);
      return;
    }

    setSelectedSystemIndex(systemIndex);
  };

  const armMove = () => {
    if (!selectedSystem || !selectedOwnedByLocal || !canCommand) {
      return;
    }
    setArmedProjectType(null);
    setProjectSourceIndex(null);
    setArmedMoveSource(selectedSystem.index);
  };

  const applyProjectToSelected = (type: 'METAL' | 'BIOMASS' | 'ENERGY') => {
    if (!selectedSystem || !canCommand) {
      return;
    }

    const existing = draftOrders.projectOrders.find(order => order.type === type);
    const next = existing?.targetIndex === selectedSystem.index
      ? cloneOrders({
          ...draftOrders,
          projectOrders: draftOrders.projectOrders.filter(order => order.type !== type)
        })
      : updateProjectOrder(draftOrders, { type, sourceIndex: null, targetIndex: selectedSystem.index });

    commitOrders(next);
  };

  const armTannhauser = () => {
    if (!selectedSystem || !selectedOwnedByLocal || !canCommand) {
      return;
    }
    setArmedMoveSource(null);
    setArmedProjectType('EXOTICS');
    setProjectSourceIndex(selectedSystem.index);
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1700px] flex-col gap-4 px-4 py-4 lg:px-8 lg:py-6">
      <header className="panel flex flex-wrap items-end justify-between gap-4 p-6">
        <div className="space-y-2">
          <div className="label">{summary.boardLabel}</div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">{detail.turnName}</h1>
          <div className="flex flex-wrap gap-2">
            <span className="notice-chip">{connectionStatus}</span>
            <span className="notice-chip border-white/10 bg-white/[0.03] text-slate-300">
              Turn {summary.turn} · {summary.phase}
            </span>
            {detail.spectator ? <span className="notice-chip border-white/10 bg-white/[0.03] text-slate-300">Spectating</span> : null}
            {notice ? <span className="notice-chip border-amber-400/20 bg-amber-400/8 text-amber-100">{notice}</span> : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {roomDetail && canCommand ? (
            <button className="button button-muted" onClick={onResign}>
              Resign
            </button>
          ) : null}
          {canCommand ? (
            detail.endedTurn ? (
              <button className="button" onClick={onCancelEndTurn}>
                Unlock
              </button>
            ) : (
              <button className="button button-primary" onClick={onEndTurn}>
                Lock in
              </button>
            )
          ) : null}
          <button className="button button-muted" onClick={onLeave}>
            {roomDetail ? 'Leave room' : 'Exit'}
          </button>
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Panel eyebrow="Turn" title="Command state">
            <div className="space-y-4">
              <div className="h-2 overflow-hidden rounded-full bg-white/6">
                <div className="h-full rounded-full bg-[linear-gradient(90deg,#6ff5d8,#1ac7b0)]" style={{ width: `${turnProgress}%` }} />
              </div>
              <div className="grid gap-2 text-sm text-slate-300">
                <TurnMetric label="Phase" value={summary.phase} />
                <TurnMetric label="Clock" value={`${detail.turnTicksLeft / 50}s`} />
                <TurnMetric label="Waiting" value={String(detail.waitingOn)} />
                <TurnMetric label="Type" value={formatLabel(detail.gameType)} />
                <TurnMetric label="Galaxy" value={formatLabel(detail.galaxySize)} />
                <TurnMetric label="Rules" value={detail.classicRuleset ? 'Classic' : 'Streamlined'} />
              </div>
            </div>
          </Panel>

          <Panel eyebrow="Victory" title="Objectives">
            <div className="space-y-3 text-sm text-slate-300">
              <div className="panel-soft px-4 py-3">
                <div className="label">Leaders</div>
                <div className="mt-2 text-slate-100">{victoryLeaders || 'None'}</div>
              </div>
              <div className="panel-soft px-4 py-3">
                <div className="label">Victors</div>
                <div className="mt-2 text-slate-100">{victors || 'Undecided'}</div>
              </div>
              <div className="panel-soft px-4 py-3">
                <div className="label">Outcome</div>
                <div className="mt-2 text-slate-100">
                  {detail.ended ? (victors || 'Draw') : summary.playerName}
                </div>
              </div>
            </div>
          </Panel>

          <Panel eyebrow="Commanders" title="Roster">
            <div className="space-y-2">
              {detail.players.map(player => {
                const incoming = localPlayer ? isBitSet(localPlayer.incomingPactOffersBitmap, player.index) : false;
                const outgoing = localPlayer ? isBitSet(localPlayer.outgoingPactOffersBitmap, player.index) : false;
                const allied = localPlayer ? localPlayer.allies[player.index] : false;

                return (
                  <div key={player.index} className="panel-soft px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: colorFromInt(player.accentColor) }} />
                        <div>
                          <div className="text-sm font-medium text-slate-100">{player.name}</div>
                          <div className="mt-1 text-[11px] uppercase tracking-[0.22em] text-slate-500">
                            {player.defeated ? 'Defeated' : player.resigned ? 'Resigned' : `R ${player.researchPoints.join(' / ')}`}
                          </div>
                        </div>
                      </div>

                      {canCommand && localPlayer && player.index !== localPlayer.index ? (
                        allied ? (
                          <span className="text-[11px] uppercase tracking-[0.24em] text-emerald-300">Allied</span>
                        ) : incoming ? (
                          <button className="button px-3 py-2 text-xs" onClick={() => onAcceptAlliance(player.index)}>
                            Accept
                          </button>
                        ) : (
                          <button
                            className="button button-muted px-3 py-2 text-xs"
                            disabled={outgoing || player.defeated || player.resigned}
                            onClick={() => onRequestAlliance(player.index)}
                          >
                            {outgoing ? 'Offered' : 'Diplomacy'}
                          </button>
                        )
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel eyebrow="Channel" title="Game chat">
            <ChatPanel messages={detail.messages} disabled={false} placeholder="Message game" onSend={onSendChat} />
          </Panel>
        </div>

        <GameBoard
          systems={detail.systems}
          players={detail.players}
          tannhauserLinks={detail.tannhauserLinks}
          orders={draftOrders}
          localPlayerIndex={detail.localPlayerIndex}
          selectedSystemIndex={selectedSystemIndex}
          armedMoveSource={armedMoveSource}
          armedProjectType={armedProjectType}
          onSelectSystem={handleSystemSelect}
        />

        <div className="space-y-4">
          <Panel eyebrow="System" title={selectedSystem?.name ?? 'Selection'}>
            {selectedSystem ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <TurnMetric label="Owner" value={selectedOwner?.name ?? 'Neutral'} />
                  <TurnMetric label="Garrison" value={String(selectedSystem.garrison)} />
                  <TurnMetric label="Minimum" value={String(selectedSystem.minimumGarrison)} />
                  <TurnMetric label="Score" value={String(selectedSystem.score)} />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {RESOURCE_LABELS.map((label, index) => (
                    <div key={label} className="panel-soft px-3 py-3 text-sm text-slate-200">
                      <div className="label">{label}</div>
                      <div className="mt-2 text-lg font-semibold text-white">{selectedSystem.resources[index] ?? 0}</div>
                    </div>
                  ))}
                </div>

                {selectedForce ? (
                  <div className="grid grid-cols-2 gap-3">
                    <TurnMetric label="Force prod" value={String(selectedForce.fleetProduction)} />
                    <TurnMetric label="Build reserve" value={String(selectedForce.fleetsAvailableToBuild)} />
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="text-sm text-slate-400">Select a system.</div>
            )}
          </Panel>

          <Panel eyebrow="Orders" title="Actions">
            <div className="space-y-3">
              <div className="panel-soft px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-slate-100">Build fleets</div>
                    <div className="mt-1 text-xs uppercase tracking-[0.22em] text-slate-500">
                      {selectedOwnedByLocal ? 'Selected system' : 'Select one of your systems'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="button px-3 py-2 text-xs" disabled={!selectedOwnedByLocal || !canCommand} onClick={() => adjustSelectedBuildOrder(-1)}>
                      -1
                    </button>
                    <span className="min-w-10 text-center text-sm font-semibold text-slate-100">{selectedBuildOrder?.quantity ?? 0}</span>
                    <button className="button px-3 py-2 text-xs" disabled={!selectedOwnedByLocal || !canCommand} onClick={() => adjustSelectedBuildOrder(1)}>
                      +1
                    </button>
                  </div>
                </div>
              </div>

              <div className="panel-soft px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-slate-100">Move fleets</div>
                    <div className="mt-1 text-xs uppercase tracking-[0.22em] text-slate-500">
                      {armedMoveSource !== null ? 'Pick destination on the board' : 'Select your system, then arm'}
                    </div>
                  </div>
                  <button className="button px-3 py-2 text-xs" disabled={!selectedOwnedByLocal || !canCommand} onClick={armMove}>
                    {armedMoveSource !== null ? 'Armed' : 'Arm move'}
                  </button>
                </div>
              </div>

              <div className="grid gap-2">
                {(['METAL', 'BIOMASS', 'ENERGY'] as const).map(type => (
                  <button
                    key={type}
                    className="button justify-between"
                    disabled={!selectedSystem || !canCommand}
                    onClick={() => applyProjectToSelected(type)}
                  >
                    <span>{PROJECT_LABELS[type]}</span>
                    <span className="text-xs uppercase tracking-[0.22em] text-slate-400">
                      {draftOrders.projectOrders.some(order => order.type === type) ? shortProjectLabel(type) : 'Ready'}
                    </span>
                  </button>
                ))}

                <button className="button justify-between" disabled={!selectedOwnedByLocal || !canCommand} onClick={armTannhauser}>
                  <span>{PROJECT_LABELS.EXOTICS}</span>
                  <span className="text-xs uppercase tracking-[0.22em] text-slate-400">
                    {armedProjectType === 'EXOTICS' ? 'Pick target' : 'Arm'}
                  </span>
                </button>
              </div>
            </div>
          </Panel>

          <Panel eyebrow="Queued" title="Turn orders">
            <div className="space-y-3">
              {draftOrders.buildOrders.length === 0 && draftOrders.moveOrders.length === 0 && draftOrders.projectOrders.length === 0 ? (
                <div className="panel-soft px-4 py-4 text-sm text-slate-400">No orders queued.</div>
              ) : null}

              {draftOrders.buildOrders.map(order => {
                const system = findSystem(detail.systems, order.systemIndex);
                return (
                  <div key={`build-${order.systemIndex}`} className="panel-soft flex items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <div className="text-sm font-medium text-slate-100">{system?.name ?? `System ${order.systemIndex}`}</div>
                      <div className="mt-1 text-xs uppercase tracking-[0.22em] text-slate-500">Build</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button className="button px-3 py-2 text-xs" onClick={() => commitOrders(updateBuildOrder(draftOrders, order.systemIndex, order.quantity - 1))}>
                        -
                      </button>
                      <span className="min-w-8 text-center text-sm font-semibold text-white">{order.quantity}</span>
                      <button className="button px-3 py-2 text-xs" onClick={() => commitOrders(updateBuildOrder(draftOrders, order.systemIndex, order.quantity + 1))}>
                        +
                      </button>
                    </div>
                  </div>
                );
              })}

              {draftOrders.moveOrders.map((order, index) => {
                const source = findSystem(detail.systems, order.sourceIndex);
                const target = findSystem(detail.systems, order.targetIndex);

                return (
                  <div key={`move-${order.sourceIndex}-${order.targetIndex}`} className="panel-soft flex items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <div className="text-sm font-medium text-slate-100">
                        {source?.name ?? order.sourceIndex} → {target?.name ?? order.targetIndex}
                      </div>
                      <div className="mt-1 text-xs uppercase tracking-[0.22em] text-slate-500">Move</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        className="button px-3 py-2 text-xs"
                        onClick={() => {
                          const nextQuantity = order.quantity - 1;
                          if (nextQuantity <= 0) {
                            const next = cloneOrders(draftOrders);
                            next.moveOrders.splice(index, 1);
                            commitOrders(next);
                            return;
                          }
                          commitOrders(updateMoveOrder(draftOrders, order.sourceIndex, order.targetIndex, nextQuantity));
                        }}
                      >
                        -
                      </button>
                      <span className="min-w-8 text-center text-sm font-semibold text-white">{order.quantity}</span>
                      <button
                        className="button px-3 py-2 text-xs"
                        onClick={() => commitOrders(updateMoveOrder(draftOrders, order.sourceIndex, order.targetIndex, order.quantity + 1))}
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}

              {draftOrders.projectOrders.map(project => {
                const target = findSystem(detail.systems, project.targetIndex);
                const source = findSystem(detail.systems, project.sourceIndex);

                return (
                  <div key={project.type} className="panel-soft flex items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <div className="text-sm font-medium text-slate-100">{projectLabel(project)}</div>
                      <div className="mt-1 text-xs uppercase tracking-[0.22em] text-slate-500">
                        {source ? `${source.name} → ` : ''}
                        {target?.name ?? 'Pending'}
                      </div>
                    </div>
                    <button
                      className="button button-muted px-3 py-2 text-xs"
                      onClick={() => commitOrders(cloneOrders({ ...draftOrders, projectOrders: draftOrders.projectOrders.filter(order => order.type !== project.type) }))}
                    >
                      Clear
                    </button>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel eyebrow="Stats" title={statsPlayer?.name ?? 'Player'}>
            <div className="flex flex-wrap gap-2">
              {detail.players.map(player => (
                <button
                  key={player.index}
                  className={`button px-3 py-2 text-xs ${player.index === statsPlayerIndex ? 'button-primary' : 'button-muted'}`}
                  onClick={() => setStatsPlayerIndex(player.index)}
                >
                  {player.name}
                </button>
              ))}
            </div>

            {statsPlayer ? (
              <div className="mt-4 grid gap-2">
                {STAT_LABELS.map((label, index) => (
                  <div key={label} className="panel-soft flex items-center justify-between gap-3 px-4 py-3 text-sm text-slate-200">
                    <span>{label}</span>
                    <span className="font-medium text-white">{statsPlayer.stats[index] ?? '-'}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </Panel>

          <Panel eyebrow="Log" title="Resolution">
            <div className="scroll-panel max-h-64 space-y-2 p-2">
              {detail.eventLog.length === 0 ? (
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-4 text-sm text-slate-400">
                  No events yet.
                </div>
              ) : (
                detail.eventLog.map((event, index) => (
                  <div key={`${event}-${index}`} className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-slate-200">
                    {eventLabel(event)}
                  </div>
                ))
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function TurnMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel-soft flex items-center justify-between gap-3 px-4 py-3">
      <span>{label}</span>
      <span className="font-medium text-white">{value}</span>
    </div>
  );
}
