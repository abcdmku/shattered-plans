import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionSnapshot, SocketEnvelope } from './types';

type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

interface UseSessionSocketOptions {
  onSnapshot: (snapshot: SessionSnapshot) => void;
  onError: (message: string) => void;
}

interface UseSessionSocketResult {
  status: ConnectionStatus;
  sendCommand: (type: string, payload?: unknown) => boolean;
}

export function useSessionSocket(sessionId: string | null | undefined, options: UseSessionSocketOptions): UseSessionSocketResult {
  const { onSnapshot, onError } = options;
  const socketRef = useRef<WebSocket | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('idle');

  useEffect(() => {
    if (!sessionId) {
      setStatus('idle');
      return;
    }

    let cancelled = false;

    const clearRetry = () => {
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };

    const connect = () => {
      if (cancelled) {
        return;
      }

      clearRetry();
      setStatus('connecting');

      const socket = new WebSocket(
        `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws?sessionId=${encodeURIComponent(sessionId)}`
      );
      socketRef.current = socket;

      socket.addEventListener('open', () => {
        if (!cancelled) {
          setStatus('open');
        }
      });

      socket.addEventListener('message', event => {
        try {
          const envelope = JSON.parse(String(event.data)) as SocketEnvelope;
          if (envelope.type === 'snapshot') {
            onSnapshot(envelope.payload as SessionSnapshot);
            return;
          }
          if (envelope.type === 'error') {
            const payload = envelope.payload as { message?: string } | null;
            onError(payload?.message ?? 'Command failed.');
          }
        } catch {
          onError('Invalid websocket payload.');
        }
      });

      socket.addEventListener('close', () => {
        if (cancelled) {
          return;
        }
        setStatus('closed');
        retryTimerRef.current = window.setTimeout(connect, 1500);
      });

      socket.addEventListener('error', () => {
        if (!cancelled) {
          setStatus('error');
        }
      });
    };

    connect();

    return () => {
      cancelled = true;
      clearRetry();
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [onError, onSnapshot, sessionId]);

  const sendCommand = useCallback((type: string, payload: unknown = {}) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    socket.send(JSON.stringify({ type, payload }));
    return true;
  }, []);

  return { status, sendCommand };
}
