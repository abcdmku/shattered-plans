import { useCallback, useEffect, useMemo, useState } from 'react';
import { AuthScreen } from './features/auth/AuthScreen';
import { GameScreen } from './features/game/GameScreen';
import { LobbyScreen } from './features/lobby/LobbyScreen';
import { RoomScreen } from './features/room/RoomScreen';
import { bootstrapSession, signIn } from './shared/api';
import { useSessionSocket } from './shared/socket';
import type { LobbySnapshot, RoomSummary, SessionSnapshot, ViewName } from './shared/types';

const EMPTY_LOBBY: LobbySnapshot = {
  players: [],
  rooms: [],
  messages: []
};

const BOOT_SESSION: SessionSnapshot = {
  view: 'boot',
  user: null,
  room: null,
  game: null,
  notices: ['Booting'],
  lobby: null,
  roomDetail: null,
  gameDetail: null
};

function normalizeView(snapshot: SessionSnapshot): ViewName {
  if (snapshot.view === 'room' && (!snapshot.room || !snapshot.roomDetail)) {
    return 'lobby';
  }
  if (snapshot.view === 'game' && (!snapshot.game || !snapshot.gameDetail)) {
    return snapshot.room && snapshot.roomDetail ? 'room' : 'lobby';
  }
  return snapshot.view;
}

function connectionLabel(status: 'idle' | 'connecting' | 'open' | 'closed' | 'error'): string {
  switch (status) {
    case 'open':
      return 'Online';
    case 'connecting':
      return 'Connecting';
    case 'closed':
      return 'Reconnecting';
    case 'error':
      return 'Error';
    default:
      return 'Idle';
  }
}

function roomIdValue(roomId: string): number {
  return Number.parseInt(roomId, 10);
}

export default function App() {
  const [session, setSession] = useState<SessionSnapshot>(BOOT_SESSION);
  const [authBusy, setAuthBusy] = useState(false);
  const [commandError, setCommandError] = useState<string | undefined>();

  useEffect(() => {
    let active = true;
    bootstrapSession().then(snapshot => {
      if (active) {
        setSession(snapshot);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const handleSnapshot = useCallback((next: SessionSnapshot) => {
    setSession(next);
    setCommandError(undefined);
  }, []);

  const handleSocketError = useCallback((message: string) => {
    setCommandError(message);
  }, []);

  const { status, sendCommand } = useSessionSocket(session.user?.id ?? null, {
    onSnapshot: handleSnapshot,
    onError: handleSocketError
  });

  const view = normalizeView(session);
  const lobby = session.lobby ?? EMPTY_LOBBY;
  const notice = commandError ?? session.notices?.[0];
  const canAct = !!session.user && status === 'open';
  const connectionStatus = useMemo(() => connectionLabel(status), [status]);

  const issueCommand = useCallback(
    (type: string, payload: unknown = {}) => {
      if (!sendCommand(type, payload)) {
        setCommandError('Connection unavailable.');
      }
    },
    [sendCommand]
  );

  if (view === 'boot') {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <div className="font-display text-lg font-light uppercase tracking-[0.3em] text-accent/60">
            Shattered Plans
          </div>
          <div className="mt-2 text-xs text-muted/40">Connecting</div>
        </div>
      </div>
    );
  }

  if (view === 'auth') {
    return (
      <AuthScreen
        busy={authBusy}
        notice={notice}
        onSignIn={async displayName => {
          setAuthBusy(true);
          setCommandError(undefined);
          try {
            const next = await signIn(displayName);
            setSession(next);
          } catch (error) {
            setCommandError(error instanceof Error ? error.message : 'Login failed.');
          } finally {
            setAuthBusy(false);
          }
        }}
      />
    );
  }

  if (view === 'room' && session.user && session.room && session.roomDetail) {
    return (
      <RoomScreen
        currentSessionId={session.user.id}
        lobbyPlayers={lobby.players}
        room={session.room}
        roomDetail={session.roomDetail}
        connectionStatus={connectionStatus}
        notice={notice}
        canAct={canAct}
        onLeaveRoom={() => issueCommand('leaveRoom')}
        onStartGame={() => issueCommand('startGame')}
        onUpdateRoomOptions={next => issueCommand('updateRoomOptions', next)}
        onInvitePlayer={userId => issueCommand('invitePlayer', { userId })}
        onAcceptJoinRequest={userId => issueCommand('acceptJoinRequest', { userId })}
        onRejectJoinRequest={userId => issueCommand('rejectJoinRequest', { userId })}
        onCancelInvitation={userId => issueCommand('cancelInvitation', { userId })}
        onKickPlayer={userId => issueCommand('kickPlayer', { userId })}
        onSendChat={message => issueCommand('sendChat', { scope: 'room', message })}
      />
    );
  }

  if (view === 'game' && session.game && session.gameDetail) {
    return (
      <GameScreen
        summary={session.game}
        detail={session.gameDetail}
        roomDetail={session.roomDetail}
        connectionStatus={connectionStatus}
        notice={notice}
        onLeave={() => {
          if (session.roomDetail) {
            issueCommand('leaveRoom');
          } else {
            issueCommand('leaveGame');
          }
        }}
        onSendChat={message => issueCommand('sendChat', { scope: 'game', message })}
        onSetOrders={orders => issueCommand('setOrders', orders)}
        onEndTurn={() => issueCommand('endTurn')}
        onCancelEndTurn={() => issueCommand('cancelEndTurn')}
        onResign={() => issueCommand('resign')}
        onRequestAlliance={targetPlayerIndex => issueCommand('requestAlliance', { targetPlayerIndex })}
        onAcceptAlliance={targetPlayerIndex => issueCommand('acceptAlliance', { targetPlayerIndex })}
      />
    );
  }

  return (
    <LobbyScreen
      displayName={session.user?.displayName ?? 'Commander'}
      lobby={lobby}
      connectionStatus={connectionStatus}
      notice={notice}
      canAct={canAct}
      onCreateRoom={() => issueCommand('createRoom')}
      onJoinRoom={roomId => issueCommand('joinRoom', { roomId: roomIdValue(roomId) })}
      onSpectateRoom={roomId => issueCommand('spectateRoom', { roomId: roomIdValue(roomId) })}
      onCreateSkirmish={payload => issueCommand('createSkirmish', payload)}
      onCreateTutorial={() => issueCommand('createTutorial')}
      onSendChat={message => issueCommand('sendChat', { scope: 'lobby', message })}
    />
  );
}
