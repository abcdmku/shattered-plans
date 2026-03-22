import type { SessionSnapshot } from './types';

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {})
    },
    ...init
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `${path} failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function bootstrapSession(): Promise<SessionSnapshot> {
  try {
    return await requestJson<SessionSnapshot>('/api/session');
  } catch (error) {
    return {
      view: 'auth',
      user: null,
      room: null,
      game: null,
      notices: [error instanceof Error ? error.message : 'Backend unavailable.'],
      lobby: null,
      roomDetail: null,
      gameDetail: null
    };
  }
}

export function signIn(displayName: string): Promise<SessionSnapshot> {
  return requestJson<SessionSnapshot>('/api/session/login', {
    method: 'POST',
    body: JSON.stringify({ displayName })
  });
}
