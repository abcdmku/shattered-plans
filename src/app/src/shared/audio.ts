export type OriginalSoundKey =
  | 'shipSelection'
  | 'shipMoveOrder'
  | 'shipAttackOrder'
  | 'factoryNoise'
  | 'explosion'
  | 'nextOpen'
  | 'nextClose';

export type OriginalMusicKey =
  | 'intro'
  | 'ingamePrimary'
  | 'ingameSecondary'
  | 'win'
  | 'lose';

export interface AudioSettings {
  soundVolume: number;
  musicVolume: number;
  soundMuted: boolean;
  musicMuted: boolean;
}

const SOUND_PATHS: Record<OriginalSoundKey, string> = {
  shipSelection: '/audio/original/sfx/ship-selection.wav',
  shipMoveOrder: '/audio/original/sfx/ship-move-order.wav',
  shipAttackOrder: '/audio/original/sfx/ship-attack-order.wav',
  factoryNoise: '/audio/original/sfx/factory-noise.wav',
  explosion: '/audio/original/sfx/explosion.wav',
  nextOpen: '/audio/original/sfx/next-open.wav',
  nextClose: '/audio/original/sfx/next-close.wav'
};

const MUSIC_TRACKS: Record<OriginalMusicKey, { src: string; loop: boolean }> = {
  intro: {
    src: '/audio/original/music/intro.wav',
    loop: true
  },
  ingamePrimary: {
    src: '/audio/original/music/ingame.wav',
    loop: true
  },
  ingameSecondary: {
    src: '/audio/original/music/ingame-two.wav',
    loop: true
  },
  win: {
    src: '/audio/original/music/win.wav',
    loop: false
  },
  lose: {
    src: '/audio/original/music/lose.wav',
    loop: false
  }
};

const AUDIO_SETTINGS_STORAGE_KEY = 'shattered-plans.audio-settings';
const DEFAULT_SOUND_VOLUME = 0.95;
const DEFAULT_MUSIC_VOLUME = 0.8;
const MUSIC_FADE_MS = 360;

let soundVolume = DEFAULT_SOUND_VOLUME;
let musicVolume = DEFAULT_MUSIC_VOLUME;
let soundMuted = false;
let musicMuted = false;
let audioUnlocked = false;
let unlockListenersInstalled = false;
let pendingMusic: OriginalMusicKey | null = null;
let currentMusicKey: OriginalMusicKey | null = null;
let currentMusic: HTMLAudioElement | null = null;
let musicFadeTimer: number | null = null;

loadStoredAudioSettings();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function loadStoredAudioSettings(): void {
  if (typeof window === 'undefined') return;

  try {
    const raw = window.localStorage.getItem(AUDIO_SETTINGS_STORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw) as Partial<AudioSettings>;
    soundVolume = clamp(parsed.soundVolume ?? DEFAULT_SOUND_VOLUME, 0, 1);
    musicVolume = clamp(parsed.musicVolume ?? DEFAULT_MUSIC_VOLUME, 0, 1);
    soundMuted = Boolean(parsed.soundMuted);
    musicMuted = Boolean(parsed.musicMuted);
  } catch {
    soundVolume = DEFAULT_SOUND_VOLUME;
    musicVolume = DEFAULT_MUSIC_VOLUME;
    soundMuted = false;
    musicMuted = false;
  }
}

function persistAudioSettings(): void {
  if (typeof window === 'undefined') return;

  window.localStorage.setItem(AUDIO_SETTINGS_STORAGE_KEY, JSON.stringify(getAudioSettings()));
}

function effectiveSoundVolume(requestedVolume: number): number {
  if (soundMuted) return 0;
  return clamp(requestedVolume * soundVolume, 0, 1);
}

function effectiveMusicVolume(): number {
  if (musicMuted) return 0;
  return clamp(musicVolume, 0, 1);
}

function applyCurrentMusicVolume(): void {
  if (!currentMusic) return;
  currentMusic.volume = effectiveMusicVolume();
}

export function getAudioSettings(): AudioSettings {
  return {
    soundVolume,
    musicVolume,
    soundMuted,
    musicMuted
  };
}

export function setSoundVolume(nextVolume: number): AudioSettings {
  soundVolume = clamp(nextVolume, 0, 1);
  persistAudioSettings();
  return getAudioSettings();
}

export function setMusicVolume(nextVolume: number): AudioSettings {
  musicVolume = clamp(nextVolume, 0, 1);
  applyCurrentMusicVolume();
  persistAudioSettings();
  return getAudioSettings();
}

export function setSoundMuted(nextMuted: boolean): AudioSettings {
  soundMuted = nextMuted;
  persistAudioSettings();
  return getAudioSettings();
}

export function setMusicMuted(nextMuted: boolean): AudioSettings {
  musicMuted = nextMuted;
  applyCurrentMusicVolume();
  persistAudioSettings();
  return getAudioSettings();
}

export function resetAudioSettings(): AudioSettings {
  soundVolume = DEFAULT_SOUND_VOLUME;
  musicVolume = DEFAULT_MUSIC_VOLUME;
  soundMuted = false;
  musicMuted = false;
  applyCurrentMusicVolume();
  persistAudioSettings();
  return getAudioSettings();
}

function getAudio(path: string): HTMLAudioElement {
  const audio = new Audio(path);
  audio.preload = 'auto';
  return audio;
}

function clearMusicFadeTimer(): void {
  if (musicFadeTimer !== null) {
    window.clearInterval(musicFadeTimer);
    musicFadeTimer = null;
  }
}

export function stopMusic(): void {
  clearMusicFadeTimer();
  if (!currentMusic) return;

  currentMusic.pause();
  currentMusic.currentTime = 0;
  currentMusic = null;
  currentMusicKey = null;
}

async function fadeInMusic(audio: HTMLAudioElement, fadeMs: number): Promise<void> {
  audio.volume = 0;
  await audio.play();

  clearMusicFadeTimer();
  const startedAt = window.performance.now();
  musicFadeTimer = window.setInterval(() => {
    const elapsed = window.performance.now() - startedAt;
    const progress = clamp(elapsed / Math.max(1, fadeMs), 0, 1);
    audio.volume = effectiveMusicVolume() * progress;

    if (progress >= 1) {
      clearMusicFadeTimer();
      audio.volume = effectiveMusicVolume();
    }
  }, 24);
}

function syncPendingMusic(): void {
  if (!audioUnlocked || pendingMusic === null) return;
  const next = pendingMusic;
  pendingMusic = null;
  void setMusic(next, { force: true });
}

function unlockAudio(): void {
  if (audioUnlocked) return;
  audioUnlocked = true;
  syncPendingMusic();
}

export function installAudioUnlockListeners(): () => void {
  if (unlockListenersInstalled || typeof window === 'undefined') {
    return () => {};
  }

  unlockListenersInstalled = true;
  const onUnlock = () => unlockAudio();
  const options: AddEventListenerOptions = { once: true, capture: true, passive: true };

  window.addEventListener('pointerdown', onUnlock, options);
  window.addEventListener('keydown', onUnlock, options);
  window.addEventListener('touchstart', onUnlock, options);

  return () => {
    window.removeEventListener('pointerdown', onUnlock, options);
    window.removeEventListener('keydown', onUnlock, options);
    window.removeEventListener('touchstart', onUnlock, options);
    unlockListenersInstalled = false;
  };
}

export function playOriginalSound(soundKey: OriginalSoundKey, volume = 1): void {
  if (typeof window === 'undefined') return;

  const nextVolume = effectiveSoundVolume(volume);
  if (nextVolume <= 0) return;

  const audio = getAudio(SOUND_PATHS[soundKey]);
  audio.volume = nextVolume;
  audio.play().catch(() => {});
}

export async function setMusic(
  musicKey: OriginalMusicKey | null,
  options: { force?: boolean; fadeMs?: number } = {}
): Promise<void> {
  const { force = false, fadeMs = MUSIC_FADE_MS } = options;
  pendingMusic = musicKey;

  if (!audioUnlocked) {
    return;
  }

  if (musicKey === currentMusicKey && !force) {
    return;
  }

  stopMusic();

  if (musicKey === null) {
    return;
  }

  const nextTrack = MUSIC_TRACKS[musicKey];
  const nextMusic = getAudio(nextTrack.src);
  currentMusic = nextMusic;
  currentMusicKey = musicKey;
  nextMusic.loop = nextTrack.loop;
  nextMusic.volume = 0;

  try {
    await fadeInMusic(nextMusic, fadeMs);
  } catch {
    if (currentMusic === nextMusic) {
      currentMusic = null;
      currentMusicKey = null;
    }
  }
}

export function getOriginalMusicKeyForGame(ended: boolean, endedTurn: boolean, localOutcome: 'winner' | 'loser' | 'draw' | null): OriginalMusicKey {
  if (ended) {
    if (localOutcome === 'winner') return 'win';
    if (localOutcome === 'loser') return 'lose';
    return 'intro';
  }

  return endedTurn ? 'ingameSecondary' : 'ingamePrimary';
}
