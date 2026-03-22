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

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1500px] flex-col gap-4 px-4 py-4 lg:px-8 lg:py-6">
      <header className="panel flex flex-wrap items-end justify-between gap-4 p-6">
        <div className="space-y-2">
          <div className="label">Lobby</div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Commander {displayName}</h1>
          <div className="flex flex-wrap gap-2">
            <span className="notice-chip">{connectionStatus}</span>
            {notice ? <span className="notice-chip border-amber-400/20 bg-amber-400/8 text-amber-100">{notice}</span> : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button className="button" onClick={onCreateTutorial} disabled={!canAct}>
            Tutorial
          </button>
          <button className="button button-primary" onClick={onCreateRoom} disabled={!canAct}>
            Create room
          </button>
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_360px]">
        <div className="space-y-4">
          <Panel eyebrow="Rooms" title="Open tables">
            <div className="grid gap-3">
              {lobby.rooms.map(room => (
                <RoomRow
                  key={room.id}
                  room={room}
                  canAct={canAct}
                  onJoin={() => onJoinRoom(room.id)}
                  onSpectate={() => onSpectateRoom(room.id)}
                />
              ))}

              {lobby.rooms.length === 0 ? (
                <div className="panel-soft px-4 py-10 text-center text-sm text-slate-400">No tables open.</div>
              ) : null}
            </div>
          </Panel>

          <Panel eyebrow="Lobby chat" title="Channel">
            <ChatPanel messages={lobby.messages} disabled={!canAct} placeholder="Message lobby" onSend={onSendChat} />
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel eyebrow="Skirmish" title="Quick launch">
            <div className="space-y-4">
              <label className="block space-y-2">
                <span className="label">Game type</span>
                <select className="select" value={gameType} onChange={event => setGameType(event.target.value)}>
                  {GAME_TYPE_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-2">
                  <span className="label">AI</span>
                  <select className="select" value={aiPlayers} onChange={event => setAiPlayers(Number(event.target.value))}>
                    {[1, 2, 3, 4, 5].map(value => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-2">
                  <span className="label">Turn</span>
                  <select className="select" value={turnLengthIndex} onChange={event => setTurnLengthIndex(Number(event.target.value))}>
                    {TURN_LENGTH_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="flex items-center justify-between rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-slate-200">
                <span>Classic ruleset</span>
                <input checked={classicRuleset} onChange={event => setClassicRuleset(event.target.checked)} type="checkbox" />
              </label>

              <button
                className="button button-primary w-full"
                disabled={!canAct}
                onClick={() => onCreateSkirmish({ gameType, classicRuleset, aiPlayers, turnLengthIndex })}
              >
                Launch skirmish
              </button>
            </div>
          </Panel>

          <Panel eyebrow="Players" title="Present">
            <div className="grid gap-2">
              {lobby.players.map(player => (
                <div key={player.id} className="panel-soft flex items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <div className="text-sm font-medium text-slate-100">{player.displayName}</div>
                    <div className="mt-1 text-xs uppercase tracking-[0.22em] text-slate-500">
                      {player.roomId ? `Room ${player.roomId}` : 'Lobby'}
                    </div>
                  </div>
                  <span className={`text-[11px] uppercase tracking-[0.24em] ${player.connected ? 'text-emerald-300' : 'text-slate-500'}`}>
                    {player.connected ? 'Online' : 'Away'}
                  </span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel eyebrow="Rules" title="Access">
            <div className="grid gap-2 text-sm text-slate-300">
              {ACCESS_MODE_OPTIONS.map(option => (
                <div key={option.value} className="panel-soft flex items-center justify-between px-4 py-3">
                  <span>{option.label}</span>
                  <span className="text-xs uppercase tracking-[0.22em] text-slate-500">
                    {getOptionLabel(ACCESS_MODE_OPTIONS, option.value)}
                  </span>
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
  const actionLabel = room.requested
    ? 'Pending'
    : room.member
      ? 'Enter'
      : room.status === 'running' && room.canSpectate
        ? 'Spectate'
        : room.invited
          ? 'Accept'
          : 'Join';

  const action = room.status === 'running' && room.canSpectate && !room.member && !room.invited ? onSpectate : onJoin;

  return (
    <div className="panel-soft flex flex-col gap-3 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-base font-medium text-slate-100">{room.title}</div>
          {room.invited ? <span className="notice-chip">Invited</span> : null}
          {room.requested ? <span className="notice-chip border-white/10 bg-white/[0.03] text-slate-300">Requested</span> : null}
        </div>
        <div className="text-sm text-slate-400">
          {room.ownerName} · {room.playerCount}/{room.maxPlayers} · {room.status}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-white/8 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-slate-400">
          {room.isPublic ? 'Open' : 'Invite'}
        </span>
        <button className="button button-primary" disabled={!canAct || room.requested} onClick={action}>
          {actionLabel}
        </button>
      </div>
    </div>
  );
}
