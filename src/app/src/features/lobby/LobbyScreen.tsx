import { useState } from 'react';
import { ACCESS_MODE_OPTIONS, GAME_TYPE_OPTIONS, TURN_LENGTH_OPTIONS, getOptionLabel } from '../../shared/game';
import type { LobbySnapshot, RoomSummary } from '../../shared/types';
import { ChatPanel } from '../../shared/ui/ChatPanel';
import { Panel } from '../../shared/ui/Panel';

interface LobbyScreenProps {
  displayName: string;
  lobby: LobbySnapshot;
  connectionStatus: string;
  notice?: string;
  canAct: boolean;
  onCreateRoom: () => void;
  onJoinRoom: (roomId: string) => void;
  onSpectateRoom: (roomId: string) => void;
  onCreateSkirmish: (payload: { gameType: string; classicRuleset: boolean; aiPlayers: number; turnLengthIndex: number }) => void;
  onCreateTutorial: () => void;
  onSendChat: (message: string) => void;
}

export function LobbyScreen({
  displayName,
  lobby,
  connectionStatus,
  notice,
  canAct,
  onCreateRoom,
  onJoinRoom,
  onSpectateRoom,
  onCreateSkirmish,
  onCreateTutorial,
  onSendChat
}: LobbyScreenProps) {
  const [gameType, setGameType] = useState('CONQUEST');
  const [classicRuleset, setClassicRuleset] = useState(true);
  const [aiPlayers, setAiPlayers] = useState(3);
  const [turnLengthIndex, setTurnLengthIndex] = useState(0);

  const isOnline = connectionStatus === 'connected';

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1200px] flex-col gap-4 px-4 py-6">
      {/* Top bar */}
      <header className="flex items-center justify-between gap-4">
        <h1 className="font-display text-lg font-bold tracking-wide text-accent">SHATTERED PLANS</h1>

        <div className="flex items-center gap-4">
          <span className="flex items-center gap-2 text-sm">
            <span className={`status-dot ${isOnline ? 'online' : 'offline'}`} />
            <span className={isOnline ? 'text-accent' : 'text-muted'}>{isOnline ? 'Online' : 'Offline'}</span>
          </span>

          {notice && <span className="text-xs text-danger">{notice}</span>}

          <button className="btn btn-ghost btn-sm" onClick={onCreateTutorial} disabled={!canAct}>
            Tutorial
          </button>
          <button className="btn btn-primary btn-sm" onClick={onCreateRoom} disabled={!canAct}>
            Create Room
          </button>
        </div>
      </header>

      {/* Two-column layout */}
      <div className="grid flex-1 grid-cols-[1fr_300px] gap-4">
        {/* Left column */}
        <div className="flex flex-col gap-4">
          <Panel title="ROOMS">
            <div className="flex flex-col gap-2">
              {lobby.rooms.map(room => (
                <RoomRow
                  key={room.id}
                  room={room}
                  canAct={canAct}
                  onJoin={() => onJoinRoom(room.id)}
                  onSpectate={() => onSpectateRoom(room.id)}
                />
              ))}

              {lobby.rooms.length === 0 && (
                <div className="py-8 text-center text-sm text-muted">No rooms available.</div>
              )}
            </div>
          </Panel>

          <Panel title="CHAT" className="flex-1">
            <ChatPanel messages={lobby.messages} disabled={!canAct} placeholder="Message lobby" onSend={onSendChat} />
          </Panel>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-4">
          <Panel title="QUICK GAME">
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="label">Game type</span>
                <select className="select" value={gameType} onChange={e => setGameType(e.target.value)}>
                  {GAME_TYPE_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="label">AI count</span>
                  <select className="select" value={aiPlayers} onChange={e => setAiPlayers(Number(e.target.value))}>
                    {[1, 2, 3, 4, 5].map(v => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="label">Turn speed</span>
                  <select className="select" value={turnLengthIndex} onChange={e => setTurnLengthIndex(Number(e.target.value))}>
                    {TURN_LENGTH_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="flex items-center justify-between py-1 text-sm text-slate-200">
                <span className="font-body">Classic ruleset</span>
                <input
                  className="toggle"
                  type="checkbox"
                  checked={classicRuleset}
                  onChange={e => setClassicRuleset(e.target.checked)}
                />
              </label>

              <button
                className="btn btn-primary w-full"
                disabled={!canAct}
                onClick={() => onCreateSkirmish({ gameType, classicRuleset, aiPlayers, turnLengthIndex })}
              >
                Launch
              </button>
            </div>
          </Panel>

          <Panel title="ONLINE">
            <div className="flex flex-col gap-1">
              {lobby.players.map(player => (
                <div key={player.id} className="flex items-center gap-2 px-2 py-1.5">
                  <span className={`status-dot ${player.connected ? 'online' : 'offline'}`} />
                  <span className="text-sm font-body text-slate-100">{player.displayName}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function RoomRow({
  room,
  canAct,
  onJoin,
  onSpectate
}: {
  room: RoomSummary;
  canAct: boolean;
  onJoin: () => void;
  onSpectate: () => void;
}) {
  const isSpectate = room.status === 'running' && room.canSpectate && !room.member && !room.invited;
  const action = isSpectate ? onSpectate : onJoin;

  const actionLabel = room.requested
    ? 'Pending'
    : room.member
      ? 'Enter'
      : isSpectate
        ? 'Spectate'
        : room.invited
          ? 'Accept'
          : 'Join';

  return (
    <div className="panel-card flex items-center justify-between gap-3 px-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-slate-100">{room.title}</div>
        <div className="text-xs text-muted">
          {room.ownerName} &middot; {room.playerCount}/{room.maxPlayers} &middot; {room.status}
        </div>
      </div>

      <button
        className="btn btn-primary btn-sm shrink-0"
        disabled={!canAct || room.requested}
        onClick={action}
      >
        {actionLabel}
      </button>
    </div>
  );
}
