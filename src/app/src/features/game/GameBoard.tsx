import type { GamePlayer, OrdersSnapshot, SystemSnapshot, TannhauserSnapshot } from '../../shared/types';
import { colorFromInt, playerAccent, playerBaseColor, shortProjectLabel } from '../../shared/game';

interface GameBoardProps {
  systems: SystemSnapshot[];
  players: GamePlayer[];
  tannhauserLinks: TannhauserSnapshot[];
  orders: OrdersSnapshot;
  localPlayerIndex: number | null;
  selectedSystemIndex: number | null;
  armedMoveSource: number | null;
  armedProjectType: string | null;
  onSelectSystem: (systemIndex: number) => void;
}

export function GameBoard({
  systems,
  players,
  tannhauserLinks,
  orders,
  localPlayerIndex,
  selectedSystemIndex,
  armedMoveSource,
  armedProjectType,
  onSelectSystem
}: GameBoardProps) {
  const systemsByIndex = new Map(systems.map(system => [system.index, system]));
  const localPlayer = players.find(player => player.index === localPlayerIndex) ?? null;
  const moveColor = playerAccent(localPlayer);

  const bounds = systems.reduce(
    (accumulator, system) => ({
      minX: Math.min(accumulator.minX, system.x),
      maxX: Math.max(accumulator.maxX, system.x),
      minY: Math.min(accumulator.minY, system.y),
      maxY: Math.max(accumulator.maxY, system.y)
    }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  );

  const padding = 140;
  const hasSystems = Number.isFinite(bounds.minX);
  const viewBox = hasSystems
    ? `${bounds.minX - padding} ${bounds.minY - padding} ${bounds.maxX - bounds.minX + padding * 2} ${bounds.maxY - bounds.minY + padding * 2}`
    : '0 0 1200 800';

  const linkPairs = systems.flatMap(system =>
    system.neighbors
      .filter(neighborIndex => system.index < neighborIndex)
      .map(neighborIndex => [system.index, neighborIndex] as const)
  );

  const buildOrderBySystem = new Map(orders.buildOrders.map(order => [order.systemIndex, order.quantity]));
  const projectLabelsByTarget = new Map<number, string[]>();

  for (const project of orders.projectOrders) {
    if (project.targetIndex === null) {
      continue;
    }

    const labels = projectLabelsByTarget.get(project.targetIndex) ?? [];
    labels.push(shortProjectLabel(project.type));
    projectLabelsByTarget.set(project.targetIndex, labels);
  }

  return (
    <div className="board-shell">
      <svg className="h-full w-full" viewBox={viewBox} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Game board">
        <defs>
          <marker id="move-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10Z" fill={moveColor} opacity="0.9" />
          </marker>
        </defs>

        <rect x="-10000" y="-10000" width="20000" height="20000" fill="rgba(4, 8, 22, 0.94)" />

        {linkPairs.map(([fromIndex, toIndex]) => {
          const from = systemsByIndex.get(fromIndex);
          const to = systemsByIndex.get(toIndex);
          if (!from || !to) {
            return null;
          }

          return (
            <line
              key={`link-${fromIndex}-${toIndex}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="rgba(144, 163, 197, 0.18)"
              strokeWidth="3"
            />
          );
        })}

        {tannhauserLinks.map(link => {
          const from = systemsByIndex.get(link.fromIndex);
          const to = systemsByIndex.get(link.toIndex);
          if (!from || !to) {
            return null;
          }

          return (
            <line
              key={`tannhauser-${link.fromIndex}-${link.toIndex}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="rgba(111, 245, 216, 0.7)"
              strokeWidth="4"
              strokeDasharray="10 10"
              opacity="0.8"
            />
          );
        })}

        {orders.moveOrders.map((order, index) => {
          const source = systemsByIndex.get(order.sourceIndex);
          const target = systemsByIndex.get(order.targetIndex);
          if (!source || !target) {
            return null;
          }

          const labelX = (source.x + target.x) / 2;
          const labelY = (source.y + target.y) / 2;

          return (
            <g key={`move-${order.sourceIndex}-${order.targetIndex}-${index}`}>
              <line
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke={moveColor}
                strokeWidth="6"
                strokeOpacity="0.9"
                markerEnd="url(#move-arrow)"
              />
              <circle cx={labelX} cy={labelY} r="17" fill="rgba(4, 8, 22, 0.86)" stroke={moveColor} strokeWidth="2" />
              <text x={labelX} y={labelY + 5} textAnchor="middle" fontSize="16" fill="#f8fafc" fontWeight="700">
                {order.quantity}
              </text>
            </g>
          );
        })}

        {systems.map(system => {
          const owner = system.ownerIndex >= 0 ? players.find(player => player.index === system.ownerIndex) ?? null : null;
          const fill = owner ? playerBaseColor(owner) : '#111827';
          const stroke = owner ? playerAccent(owner) : '#64748b';
          const selected = selectedSystemIndex === system.index;
          const buildQuantity = buildOrderBySystem.get(system.index);
          const projectLabels = projectLabelsByTarget.get(system.index) ?? [];
          const radius = system.score >= 3 ? 24 : system.score >= 2 ? 21 : 18;

          return (
            <g key={system.index} className="cursor-pointer" onClick={() => onSelectSystem(system.index)}>
              {system.hasDefensiveNet ? (
                <circle
                  cx={system.x}
                  cy={system.y}
                  r={radius + 10}
                  fill="none"
                  stroke="rgba(111, 245, 216, 0.7)"
                  strokeWidth="3"
                  strokeDasharray="8 8"
                />
              ) : null}

              {armedMoveSource === system.index ? (
                <circle
                  cx={system.x}
                  cy={system.y}
                  r={radius + 14}
                  fill="none"
                  stroke={moveColor}
                  strokeWidth="4"
                  strokeDasharray="6 8"
                />
              ) : null}

              {selected ? (
                <circle
                  cx={system.x}
                  cy={system.y}
                  r={radius + 18}
                  fill="none"
                  stroke="rgba(248, 250, 252, 0.86)"
                  strokeWidth="4"
                />
              ) : null}

              <circle cx={system.x} cy={system.y} r={radius + 6} fill="rgba(4, 8, 22, 0.86)" />
              <circle cx={system.x} cy={system.y} r={radius} fill={fill} stroke={stroke} strokeWidth={selected ? '4' : '3'} />
              <text x={system.x} y={system.y + 5} textAnchor="middle" fontSize="18" fill="#f8fafc" fontWeight="700">
                {system.garrison}
              </text>
              <text x={system.x} y={system.y + radius + 24} textAnchor="middle" fontSize="15" fill="#cbd5e1" fontWeight="500">
                {system.name}
              </text>

              {buildQuantity ? (
                <>
                  <rect
                    x={system.x - 24}
                    y={system.y + radius + 34}
                    width="48"
                    height="24"
                    rx="12"
                    fill="rgba(111, 245, 216, 0.16)"
                    stroke="rgba(111, 245, 216, 0.8)"
                  />
                  <text x={system.x} y={system.y + radius + 51} textAnchor="middle" fontSize="14" fill="#ecfeff" fontWeight="700">
                    +{buildQuantity}
                  </text>
                </>
              ) : null}

              {projectLabels.length > 0 ? (
                <>
                  <rect
                    x={system.x - 28}
                    y={system.y - radius - 42}
                    width="56"
                    height="24"
                    rx="12"
                    fill={armedProjectType && projectLabels.includes(shortProjectLabel(armedProjectType)) ? `${moveColor}33` : 'rgba(248, 250, 252, 0.08)'}
                    stroke="rgba(248, 250, 252, 0.16)"
                  />
                  <text x={system.x} y={system.y - radius - 25} textAnchor="middle" fontSize="12" fill="#f8fafc" fontWeight="700">
                    {projectLabels.join('/')}
                  </text>
                </>
              ) : null}
            </g>
          );
        })}
      </svg>

      <div className="pointer-events-none absolute inset-x-4 bottom-4 flex justify-end">
        <div className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-2 text-xs uppercase tracking-[0.24em] text-slate-400 shadow-panel backdrop-blur-xl">
          {localPlayer ? `${localPlayer.name}` : 'Spectating'}
        </div>
      </div>
    </div>
  );
}
