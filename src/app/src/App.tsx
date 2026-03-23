import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AuthScreen } from './features/auth/AuthScreen';
import { GameScreen } from './features/game/GameScreen';
import { LobbyScreen } from './features/lobby/LobbyScreen';
import { RoomScreen } from './features/room/RoomScreen';
import { bootstrapSession, signIn } from './shared/api';
import {
  getAudioSettings,
  getOriginalMusicKeyForGame,
  installAudioUnlockListeners,
  resetAudioSettings,
  setMusic,
  setMusicMuted,
  setMusicVolume,
  setSoundMuted,
  setSoundVolume,
  type AudioSettings
} from './shared/audio';
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
  const [audioSettings, setAudioSettings] = useState<AudioSettings>(() => getAudioSettings());
  const [audioControlsOpen, setAudioControlsOpen] = useState(false);
  const audioControlsRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => installAudioUnlockListeners(), []);

  const view = normalizeView(session);
  const lobby = session.lobby ?? EMPTY_LOBBY;
  const notice = commandError ?? session.notices?.[0];
  const canAct = !!session.user && status === 'open';
  const connectionStatus = useMemo(() => connectionLabel(status), [status]);
  const localOutcome = useMemo(() => {
    if (view !== 'game' || !session.gameDetail || session.gameDetail.localPlayerIndex === null) {
      return null;
    }

    const victors = session.gameDetail.victory.victors;
    if (victors.length !== 1) {
      return victors.includes(session.gameDetail.localPlayerIndex) ? 'draw' : 'loser';
    }

    return victors.includes(session.gameDetail.localPlayerIndex) ? 'winner' : 'loser';
  }, [session.gameDetail, view]);
  const desiredMusicKey = useMemo(() => {
    if (view !== 'game' || !session.gameDetail) {
      return 'intro';
    }

    return getOriginalMusicKeyForGame(
      session.gameDetail.ended,
      session.gameDetail.endedTurn,
      localOutcome
    );
  }, [localOutcome, session.gameDetail, view]);

  useEffect(() => {
    void setMusic(desiredMusicKey);
  }, [desiredMusicKey]);

  useEffect(() => {
    if (!audioControlsOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && audioControlsRef.current?.contains(target)) {
        return;
      }
      setAudioControlsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAudioControlsOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [audioControlsOpen]);

  const issueCommand = useCallback(
    (type: string, payload: unknown = {}) => {
      if (!sendCommand(type, payload)) {
        setCommandError('Connection unavailable.');
      }
    },
    [sendCommand]
  );

  const updateSoundVolume = (value: number) => {
    setAudioSettings(setSoundVolume(value));
  };

  const updateMusicVolume = (value: number) => {
    setAudioSettings(setMusicVolume(value));
  };

  const toggleSoundMuted = () => {
    setAudioSettings(setSoundMuted(!audioSettings.soundMuted));
  };

  const toggleMusicMuted = () => {
    setAudioSettings(setMusicMuted(!audioSettings.musicMuted));
  };

  const resetSoundControls = () => {
    setAudioSettings(resetAudioSettings());
  };

  let screen: ReactNode;

  if (view === 'boot') {
    screen = (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <div className="font-display text-lg font-light uppercase tracking-[0.3em] text-accent/60">
            Shattered Plans
          </div>
          <div className="mt-2 text-xs text-muted/40">Connecting</div>
        </div>
      </div>
    );
  } else if (view === 'auth') {
    screen = (
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
  } else if (view === 'room' && session.user && session.room && session.roomDetail) {
    screen = (
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
  } else if (view === 'game' && session.game && session.gameDetail) {
    screen = (
      <GameScreen
        summary={session.game}
        detail={session.gameDetail}
        roomDetail={session.roomDetail}
        canRematch={Boolean(
          session.gameDetail
          && (session.roomDetail ? session.roomDetail.ownerSessionId === session.user?.id : session.gameDetail.kind !== 'multiplayer')
        )}
        connectionStatus={connectionStatus}
        notice={notice}
        onLeave={() => {
          if (session.roomDetail) {
            issueCommand('leaveRoom');
          } else {
            issueCommand('leaveGame');
          }
        }}
        onRematch={() => issueCommand('rematch')}
        onSendChat={message => issueCommand('sendChat', { scope: 'game', message })}
        onSetOrders={orders => issueCommand('setOrders', orders)}
        onEndTurn={() => issueCommand('endTurn')}
        onCancelEndTurn={() => issueCommand('cancelEndTurn')}
        onResign={() => issueCommand('resign')}
        onRequestAlliance={targetPlayerIndex => issueCommand('requestAlliance', { targetPlayerIndex })}
        onAcceptAlliance={targetPlayerIndex => issueCommand('acceptAlliance', { targetPlayerIndex })}
      />
    );
  } else {
    screen = (
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

  return (
    <>
      {screen}
      <div
        ref={audioControlsRef}
        className={`audio-settings-dock ${view === 'game' ? 'is-game' : ''} ${audioControlsOpen ? 'is-open' : ''}`}
      >
        {audioControlsOpen && (
          <section className="audio-settings-panel panel" aria-label="Audio controls">
            <div className="audio-settings-header">
              <div className="audio-settings-heading">
                <div className="label">Audio</div>
                <div className="audio-settings-title">Sound Controls</div>
              </div>
              <button className="hud-chip" onClick={resetSoundControls} type="button">
                Defaults
              </button>
            </div>

            <div className="audio-settings-group">
              <div className="audio-settings-row">
                <div className="audio-settings-copy">
                  <span>Effects</span>
                  <strong>{Math.round(audioSettings.soundVolume * 100)}%</strong>
                </div>
                <label className="audio-settings-switch">
                  <span>{audioSettings.soundMuted ? 'Muted' : 'On'}</span>
                  <input
                    className="toggle"
                    checked={!audioSettings.soundMuted}
                    onChange={toggleSoundMuted}
                    type="checkbox"
                  />
                </label>
              </div>
              <input
                aria-label="Effects volume"
                className="audio-settings-slider"
                max={100}
                min={0}
                onChange={event => updateSoundVolume(Number(event.target.value) / 100)}
                step={1}
                type="range"
                value={Math.round(audioSettings.soundVolume * 100)}
              />
            </div>

            <div className="audio-settings-group">
              <div className="audio-settings-row">
                <div className="audio-settings-copy">
                  <span>Music</span>
                  <strong>{Math.round(audioSettings.musicVolume * 100)}%</strong>
                </div>
                <label className="audio-settings-switch">
                  <span>{audioSettings.musicMuted ? 'Muted' : 'On'}</span>
                  <input
                    className="toggle"
                    checked={!audioSettings.musicMuted}
                    onChange={toggleMusicMuted}
                    type="checkbox"
                  />
                </label>
              </div>
              <input
                aria-label="Music volume"
                className="audio-settings-slider"
                max={100}
                min={0}
                onChange={event => updateMusicVolume(Number(event.target.value) / 100)}
                step={1}
                type="range"
                value={Math.round(audioSettings.musicVolume * 100)}
              />
            </div>
          </section>
        )}

        <button
          aria-expanded={audioControlsOpen}
          aria-label={audioControlsOpen ? 'Close sound controls' : 'Open sound controls'}
          className={`audio-settings-button ${audioControlsOpen ? 'is-open' : ''}`}
          onClick={() => setAudioControlsOpen(open => !open)}
          type="button"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12 3.6 13.9 5l2.37-.39.88 2.23 2.16 1.04-.39 2.37L20.4 12l-1.48 1.75.39 2.37-2.16 1.04-.88 2.23-2.37-.39L12 20.4 10.25 19l-2.37.39L7 17.16l-2.16-1.04.39-2.37L3.6 12l1.63-1.75-.39-2.37L7 6.84l.88-2.23 2.37.39L12 3.6Z"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
            />
            <circle
              cx="12"
              cy="12"
              fill="none"
              r="3.35"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
        </button>
      </div>
    </>
  );
}
