import { createContext, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { getToken } from '../utils/storage';

/** Connection state constants */
export const WS_STATE = {
  CONNECTED: 'connected',
  AUTHENTICATING: 'authenticating',
  RECONNECTING: 'reconnecting',
  DISCONNECTED: 'disconnected',
  OFFLINE: 'offline',          // 后端不可达，停止重试
};

const MAX_RETRIES = 5;         // 最多重试 5 次后进入离线模式

export const WebSocketContext = createContext(null);

export function WebSocketProvider({ children }) {
  const [connectionState, setConnectionState] = useState(WS_STATE.DISCONNECTED);
  const connectionStateRef = useRef(connectionState);
  connectionStateRef.current = connectionState;
  const listenersRef = useRef(new Map());
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const heartbeatTimerRef = useRef(null);
  const manualDisconnectRef = useRef(false);
  const retryCountRef = useRef(0);
  const messageQueueRef = useRef([]);

  // ---------------------------------------------------------------------------
  // Exponential backoff with jitter: base starts at 2s, doubles each retry,
  // capped at 30s, plus 0-30% random jitter.
  // ---------------------------------------------------------------------------
  const getReconnectDelay = useCallback(() => {
    const base = Math.min(2000 * Math.pow(2, retryCountRef.current), 30000);
    const jitter = base * 0.3 * Math.random();
    return base + jitter;
  }, []);

  // ---------------------------------------------------------------------------
  // Heartbeat: send { type: "ping" } every 30s.
  // ---------------------------------------------------------------------------
  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const startHeartbeat = useCallback(() => {
    stopHeartbeat();
    heartbeatTimerRef.current = setInterval(() => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'ping' }));
        } catch {
          // Will be caught by onerror / onclose
        }
      }
    }, 30000);
  }, [stopHeartbeat]);

  // ---------------------------------------------------------------------------
  // Message queue
  // ---------------------------------------------------------------------------
  const flushMessageQueue = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    while (messageQueueRef.current.length > 0) {
      const msg = messageQueueRef.current.shift();
      try {
        ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
      } catch {
        messageQueueRef.current.unshift(msg);
        break;
      }
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Core connect / disconnect
  // ---------------------------------------------------------------------------
  const connect = useCallback(() => {
    const token = getToken();
    if (!token) return;
    manualDisconnectRef.current = false;

    // Tear down any previous socket cleanly
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      if (
        wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING
      ) {
        wsRef.current.close();
      }
    }

    // Show "reconnecting" when this is not the initial connection attempt
    if (retryCountRef.current > 0) {
      setConnectionState(WS_STATE.RECONNECTING);
    }

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = import.meta.env.VITE_WS_URL || `${wsProtocol}//${window.location.host}/api/v1/ws`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', token }));
      setConnectionState(WS_STATE.AUTHENTICATING);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'pong') return;

        if (data.type === 'auth_ok') {
          retryCountRef.current = 0;
          setConnectionState(WS_STATE.CONNECTED);
          startHeartbeat();
          flushMessageQueue();
          return;
        }

        if (data.type === 'error' && connectionStateRef.current !== WS_STATE.CONNECTED) {
          // FE-03: Auth error — stop reconnection attempts
          manualDisconnectRef.current = true;
          ws.close();
          return;
        }

        const cbs = listenersRef.current.get(data.type);
        if (cbs) cbs.forEach((cb) => cb(data.payload));

        const wildcard = listenersRef.current.get('*');
        if (wildcard) wildcard.forEach((cb) => cb(data));
      } catch (e) {
        console.error('[WS] Parse error:', e);
      }
    };

    ws.onclose = () => {
      stopHeartbeat();
      wsRef.current = null;

      if (!manualDisconnectRef.current) {
        retryCountRef.current += 1;

        // 超过最大重试次数 → 切到离线模式，停止重连
        if (retryCountRef.current > MAX_RETRIES) {
          setConnectionState(WS_STATE.OFFLINE);
          return;
        }

        setConnectionState(WS_STATE.RECONNECTING);
        const delay = getReconnectDelay();
        reconnectTimerRef.current = setTimeout(connect, delay);
      } else {
        setConnectionState(WS_STATE.DISCONNECTED);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [startHeartbeat, stopHeartbeat, getReconnectDelay, flushMessageQueue]);

  const disconnect = useCallback(() => {
    manualDisconnectRef.current = true;
    clearTimeout(reconnectTimerRef.current);
    stopHeartbeat();
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnectionState(WS_STATE.DISCONNECTED);
    messageQueueRef.current = [];
    retryCountRef.current = 0;
  }, [stopHeartbeat]);

  // ---------------------------------------------------------------------------
  // Manual retry from OFFLINE state
  // ---------------------------------------------------------------------------
  const retry = useCallback(() => {
    retryCountRef.current = 0;
    connect();
  }, [connect]);

  // ---------------------------------------------------------------------------
  // send() -- queue-aware
  // ---------------------------------------------------------------------------
  const send = useCallback((message) => {
    const ws = wsRef.current;
    const data = typeof message === 'string' ? message : JSON.stringify(message);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    } else {
      if (messageQueueRef.current.length < 100) {
        messageQueueRef.current.push(data);
      }
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Event listener helpers
  // ---------------------------------------------------------------------------
  const on = useCallback((eventType, callback) => {
    if (!listenersRef.current.has(eventType)) {
      listenersRef.current.set(eventType, new Set());
    }
    listenersRef.current.get(eventType).add(callback);
  }, []);

  const off = useCallback((eventType, callback) => {
    listenersRef.current.get(eventType)?.delete(callback);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => disconnect();
  }, [disconnect]);

  // Derived boolean for backward compatibility
  const connected = connectionState === WS_STATE.CONNECTED;

  const value = useMemo(() => ({
    connected, connectionState, connect, disconnect, retry, send, on, off
  }), [connected, connectionState, connect, disconnect, retry, send, on, off]);

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}
