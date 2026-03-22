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
    <div className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col gap-4 px-4 py-4 lg:px-8 lg:py-6">
      <header className="panel flex flex-wrap items-end justify-between gap-4 p-6">
        <div className="space-y-2">
          <div className="label">Room</div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">{room.title}</h1>
          <div className="flex flex-wrap gap-2">
            <span className="notice-chip">{connectionStatus}</span>
            <span className="notice-chip border-white/10 bg-white/[0.03] text-slate-300">
              {room.playerCount}/{room.maxPlayers}
            </span>
            {notice ? <span className="notice-chip border-amber-400/20 bg-amber-400/8 text-amber-100">{notice}</span> : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button className="button button-muted" onClick={onLeaveRoom}>
            Leave
          </button>
          {isOwner ? (
            <button className="button button-primary" disabled={!canAct} onClick={onStartGame}>
              Start
            </button>
          ) : null}
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Panel eyebrow="Members" title="Table">
            <div className="grid gap-2">
              {sortMembersByName(roomDetail.members).map(member => (
                <div key={member.id} className="panel-soft flex items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <div className="text-sm font-medium text-slate-100">{member.displayName}</div>
                    <div className="mt-1 text-xs uppercase tracking-[0.22em] text-slate-500">
                      {member.id === roomDetail.ownerSessionId ? 'Owner' : member.connected ? 'Connected' : 'Away'}
                    </div>
                  </div>
                  {isOwner && member.id !== roomDetail.ownerSessionId ? (
                    <button className="button button-muted px-3 py-2 text-xs" disabled={!canAct} onClick={() => onKickPlayer(member.userId)}>
                      Kick
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </Panel>

          <Panel eyebrow="Requests" title="Pending">
            <div className="space-y-3">
              {roomDetail.joinRequests.length === 0 ? (
                <div className="panel-soft px-4 py-4 text-sm text-slate-400">No join requests.</div>
              ) : (
                sortMembersByName(roomDetail.joinRequests).map(member => (
                  <div key={member.id} className="panel-soft flex items-center justify-between gap-3 px-4 py-3">
                    <span className="text-sm text-slate-100">{member.displayName}</span>
                    {isOwner ? (
                      <div className="flex gap-2">
                        <button className="button px-3 py-2 text-xs" disabled={!canAct} onClick={() => onAcceptJoinRequest(member.userId)}>
                          Accept
                        </button>
                        <button className="button button-muted px-3 py-2 text-xs" disabled={!canAct} onClick={() => onRejectJoinRequest(member.userId)}>
                          Decline
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel eyebrow="Board" title="Room setup">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
              <div className="panel-soft min-h-[360px] p-5">
                <div className="h-full rounded-[24px] border border-white/8 bg-[radial-gradient(circle_at_top,rgba(111,245,216,0.14),transparent_36%),linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0))]" />
              </div>

              <div className="space-y-3">
                <OptionField label="Game type">
                  <select
                    className="select"
                    disabled={!isOwner || !canAct}
                    value={roomDetail.options.gameType}
                    onChange={event => onUpdateRoomOptions({ ...roomDetail.options, gameType: event.target.value })}
                  >
                    {GAME_TYPE_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
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
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </OptionField>

                <div className="grid grid-cols-2 gap-3">
                  <OptionField label="Humans">
                    <select
                      className="select"
                      disabled={!isOwner || !canAct}
                      value={roomDetail.options.maxHumanPlayers}
                      onChange={event => onUpdateRoomOptions({ ...roomDetail.options, maxHumanPlayers: Number(event.target.value) })}
                    >
                      {[2, 3, 4, 5, 6].map(value => (
                        <option key={value} value={value}>
                          {value}
                        </option>
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
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </OptionField>
                </div>

                <OptionField label="Turn">
                  <select
                    className="select"
                    disabled={!isOwner || !canAct}
                    value={roomDetail.options.turnLengthIndex}
                    onChange={event => onUpdateRoomOptions({ ...roomDetail.options, turnLengthIndex: Number(event.target.value) })}
                  >
                    {TURN_LENGTH_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </OptionField>

                <OptionField label="Access">
                  <select
                    className="select"
                    disabled={!isOwner || !canAct}
                    value={roomDetail.options.accessMode}
                    onChange={event => onUpdateRoomOptions({ ...roomDetail.options, accessMode: event.target.value })}
                  >
                    {ACCESS_MODE_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </OptionField>

                <div className="grid gap-2">
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
                  <div className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-slate-400">
                    {roomDetail.ownerName} controls setup.
                  </div>
                ) : null}
              </div>
            </div>
          </Panel>

          <Panel eyebrow="Chat" title="Room channel">
            <ChatPanel messages={roomDetail.messages} disabled={!canAct} placeholder="Message room" onSend={onSendChat} />
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel eyebrow="Invites" title="Waiting">
            <div className="space-y-3">
              {roomDetail.invitations.length === 0 ? (
                <div className="panel-soft px-4 py-4 text-sm text-slate-400">No invitations out.</div>
              ) : (
                sortMembersByName(roomDetail.invitations).map(member => (
                  <div key={member.id} className="panel-soft flex items-center justify-between gap-3 px-4 py-3">
                    <span className="text-sm text-slate-100">{member.displayName}</span>
                    {isOwner ? (
                      <button className="button button-muted px-3 py-2 text-xs" disabled={!canAct} onClick={() => onCancelInvitation(member.userId)}>
                        Cancel
                      </button>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </Panel>

          <Panel eyebrow="Players" title="Invite from lobby">
            <div className="space-y-2">
              {inviteCandidates.length === 0 ? (
                <div className="panel-soft px-4 py-4 text-sm text-slate-400">Nobody available.</div>
              ) : (
                inviteCandidates.map(player => (
                  <div key={player.id} className="panel-soft flex items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <div className="text-sm font-medium text-slate-100">{player.displayName}</div>
                      <div className="mt-1 text-xs uppercase tracking-[0.22em] text-slate-500">
                        {player.connected ? 'Online' : 'Away'}
                      </div>
                    </div>
                    {isOwner ? (
                      <button className="button button-primary px-3 py-2 text-xs" disabled={!canAct} onClick={() => onInvitePlayer(player.userId)}>
                        Invite
                      </button>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </Panel>

          <Panel eyebrow="Summary" title="Settings">
            <div className="grid gap-2 text-sm text-slate-300">
              <SummaryRow label="Type" value={getOptionLabel(GAME_TYPE_OPTIONS, roomDetail.options.gameType)} />
              <SummaryRow label="Galaxy" value={getOptionLabel(GALAXY_SIZE_OPTIONS, roomDetail.options.galaxySize)} />
              <SummaryRow label="Turn" value={getOptionLabel(TURN_LENGTH_OPTIONS, roomDetail.options.turnLengthIndex)} />
              <SummaryRow label="Access" value={getOptionLabel(ACCESS_MODE_OPTIONS, roomDetail.options.accessMode)} />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function OptionField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-2">
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
    <label className="flex items-center justify-between rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-slate-200">
      <span>{label}</span>
      <input checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} type="checkbox" />
    </label>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel-soft flex items-center justify-between gap-3 px-4 py-3">
      <span>{label}</span>
      <span className="text-xs uppercase tracking-[0.22em] text-slate-500">{value}</span>
    </div>
  );
}
