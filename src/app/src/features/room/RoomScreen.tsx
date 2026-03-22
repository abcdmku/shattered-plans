import type { ReactNode } from 'react';
import { ACCESS_MODE_OPTIONS, GALAXY_SIZE_OPTIONS, GAME_TYPE_OPTIONS, TURN_LENGTH_OPTIONS, getOptionLabel, sortMembersByName } from '../../shared/game';
import type { PlayerPresence, RoomDetail, RoomSummary } from '../../shared/types';
import { ChatPanel } from '../../shared/ui/ChatPanel';
import { Panel } from '../../shared/ui/Panel';

interface RoomScreenProps {
  currentSessionId: string;
  lobbyPlayers: PlayerPresence[];
  room: RoomSummary;
  roomDetail: RoomDetail;
  connectionStatus: string;
  notice?: string;
  canAct: boolean;
  onLeaveRoom: () => void;
  onStartGame: () => void;
  onUpdateRoomOptions: (next: RoomDetail['options']) => void;
  onInvitePlayer: (userId: number) => void;
  onAcceptJoinRequest: (userId: number) => void;
  onRejectJoinRequest: (userId: number) => void;
  onCancelInvitation: (userId: number) => void;
  onKickPlayer: (userId: number) => void;
  onSendChat: (message: string) => void;
}

export function RoomScreen({
  currentSessionId,
  lobbyPlayers,
  room,
  roomDetail,
  connectionStatus,
  notice,
  canAct,
  onLeaveRoom,
  onStartGame,
  onUpdateRoomOptions,
  onInvitePlayer,
  onAcceptJoinRequest,
  onRejectJoinRequest,
  onCancelInvitation,
  onKickPlayer,
  onSendChat
}: RoomScreenProps) {
  const isOwner = roomDetail.ownerSessionId === currentSessionId;
  const occupiedUserIds = new Set([
    ...roomDetail.members.map(member => member.userId),
    ...roomDetail.invitations.map(member => member.userId),
    ...roomDetail.joinRequests.map(member => member.userId)
  ]);

  const inviteCandidates = sortMembersByName(
    lobbyPlayers
      .filter(player => !occupiedUserIds.has(player.userId))
      .filter(player => player.id !== currentSessionId)
      .filter(player => !player.roomId)
  );

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1200px] flex-col gap-4 px-4 py-4 lg:px-8 lg:py-6">
      {/* Top bar */}
      <header className="panel flex items-center justify-between gap-4 px-5 py-3">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-lg tracking-tight text-white">{room.title}</h1>
          <span className="rounded-full bg-white/10 px-2.5 py-0.5 font-display text-xs text-accent">
            {room.playerCount}/{room.maxPlayers}
          </span>
          {notice ? <span className="text-xs text-muted">{notice}</span> : null}
        </div>
        <div className="flex items-center gap-2">
          <button className="btn btn-ghost btn-sm" onClick={onLeaveRoom}>Leave</button>
          {isOwner ? (
            <button className="btn btn-primary btn-sm" disabled={!canAct} onClick={onStartGame}>Start Game</button>
          ) : null}
        </div>
      </header>

      {/* Two-column layout */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* Left column: Settings + Chat */}
        <div className="space-y-4">
          <Panel title="SETTINGS" compact>
            <div className="grid grid-cols-2 gap-3">
              <OptionField label="Game type">
                <select
                  className="select"
                  disabled={!isOwner || !canAct}
                  value={roomDetail.options.gameType}
                  onChange={event => onUpdateRoomOptions({ ...roomDetail.options, gameType: event.target.value })}
                >
                  {GAME_TYPE_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </OptionField>

              <OptionField label="Galaxy">
                <select
                  className="select"
                  disabled={!isOwner || !canAct}
                  value={roomDetail.options.galaxySize}
                  onChange={event => onUpdateRoomOptions({ ...roomDetail.options, galaxySize: event.target.value })}
                >
                  {GALAXY_SIZE_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </OptionField>

              <OptionField label="Humans">
                <select
                  className="select"
                  disabled={!isOwner || !canAct}
                  value={roomDetail.options.maxHumanPlayers}
                  onChange={event => onUpdateRoomOptions({ ...roomDetail.options, maxHumanPlayers: Number(event.target.value) })}
                >
                  {[2, 3, 4, 5, 6].map(value => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </OptionField>

              <OptionField label="AI">
                <select
                  className="select"
                  disabled={!isOwner || !canAct}
                  value={roomDetail.options.aiPlayers}
                  onChange={event => onUpdateRoomOptions({ ...roomDetail.options, aiPlayers: Number(event.target.value) })}
                >
                  {[0, 1, 2, 3, 4, 5].map(value => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </OptionField>

              <OptionField label="Turn length">
                <select
                  className="select"
                  disabled={!isOwner || !canAct}
                  value={roomDetail.options.turnLengthIndex}
                  onChange={event => onUpdateRoomOptions({ ...roomDetail.options, turnLengthIndex: Number(event.target.value) })}
                >
                  {TURN_LENGTH_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </OptionField>

              <OptionField label="Access mode">
                <select
                  className="select"
                  disabled={!isOwner || !canAct}
                  value={roomDetail.options.accessMode}
                  onChange={event => onUpdateRoomOptions({ ...roomDetail.options, accessMode: event.target.value })}
                >
                  {ACCESS_MODE_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </OptionField>
            </div>

            <div className="mt-3 space-y-2">
              <ToggleRow
                checked={roomDetail.options.classicRuleset}
                disabled={!isOwner || !canAct}
                label="Classic ruleset"
                onChange={checked => onUpdateRoomOptions({ ...roomDetail.options, classicRuleset: checked })}
              />
              <ToggleRow
                checked={roomDetail.options.allowSpectate}
                disabled={!isOwner || !canAct}
                label="Allow spectate"
                onChange={checked => onUpdateRoomOptions({ ...roomDetail.options, allowSpectate: checked })}
              />
            </div>

            {!isOwner ? (
              <p className="mt-3 text-xs text-muted">{roomDetail.ownerName} controls room settings.</p>
            ) : null}
          </Panel>

          <Panel title="CHAT" compact>
            <ChatPanel messages={roomDetail.messages} disabled={!canAct} placeholder="Message room" onSend={onSendChat} />
          </Panel>
        </div>

        {/* Right column: Members + Requests + Invitations + Invite */}
        <div className="space-y-4">
          <Panel title="MEMBERS" compact>
            <div className="space-y-1">
              {sortMembersByName(roomDetail.members).map(member => (
                <div key={member.id} className="flex items-center justify-between gap-2 rounded px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <span className={`status-dot ${member.connected ? 'online' : 'offline'}`} />
                    <span className="font-body text-sm text-white">{member.displayName}</span>
                    {member.id === roomDetail.ownerSessionId ? (
                      <span className="font-display text-[10px] uppercase tracking-widest text-accent">Owner</span>
                    ) : null}
                  </div>
                  {isOwner && member.id !== roomDetail.ownerSessionId ? (
                    <button className="btn btn-ghost btn-sm text-xs" disabled={!canAct} onClick={() => onKickPlayer(member.userId)}>
                      Kick
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </Panel>

          {roomDetail.joinRequests.length > 0 ? (
            <Panel title="REQUESTS" compact>
              <div className="space-y-1">
                {sortMembersByName(roomDetail.joinRequests).map(member => (
                  <div key={member.id} className="flex items-center justify-between gap-2 rounded px-2 py-1.5">
                    <span className="font-body text-sm text-white">{member.displayName}</span>
                    {isOwner ? (
                      <div className="flex gap-1">
                        <button className="btn btn-primary btn-sm text-xs" disabled={!canAct} onClick={() => onAcceptJoinRequest(member.userId)}>
                          Accept
                        </button>
                        <button className="btn btn-ghost btn-sm text-xs" disabled={!canAct} onClick={() => onRejectJoinRequest(member.userId)}>
                          Decline
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}

          {roomDetail.invitations.length > 0 ? (
            <Panel title="INVITATIONS" compact>
              <div className="space-y-1">
                {sortMembersByName(roomDetail.invitations).map(member => (
                  <div key={member.id} className="flex items-center justify-between gap-2 rounded px-2 py-1.5">
                    <span className="font-body text-sm text-white">{member.displayName}</span>
                    {isOwner ? (
                      <button className="btn btn-ghost btn-sm text-xs" disabled={!canAct} onClick={() => onCancelInvitation(member.userId)}>
                        Cancel
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}

          {isOwner && inviteCandidates.length > 0 ? (
            <Panel title="INVITE" compact>
              <div className="space-y-1">
                {inviteCandidates.map(player => (
                  <div key={player.id} className="flex items-center justify-between gap-2 rounded px-2 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className={`status-dot ${player.connected ? 'online' : 'offline'}`} />
                      <span className="font-body text-sm text-white">{player.displayName}</span>
                    </div>
                    <button className="btn btn-primary btn-sm text-xs" disabled={!canAct} onClick={() => onInvitePlayer(player.userId)}>
                      Invite
                    </button>
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function OptionField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

function ToggleRow({
  label,
  checked,
  disabled,
  onChange
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between text-sm text-white/80">
      <span className="font-body">{label}</span>
      <input
        className="toggle"
        checked={checked}
        disabled={disabled}
        onChange={event => onChange(event.target.checked)}
        type="checkbox"
      />
    </label>
  );
}
