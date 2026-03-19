import { createContext, useState, useCallback, useRef, useEffect } from 'react';
import { getToken } from '../utils/storage';

/** Connection state constants */
export const WS_STATE = {
  CONNECTED: 'connected',
  AUTHENTICATING: 'authenticating',
  RECONNECTING: 'reconnecting',
  DISCONNECTED: 'disconnected',
};

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
  // Exponential backoff with jitter: base starts at 1s, doubles each retry,
  // capped at 30s, plus 0-30% random jitter to avoid thundering herd.
  // ---------------------------------------------------------------------------
  const getReconnectDelay = useCallback(() => {
    const base = Math.min(1000 * Math.pow(2, retryCountRef.current), 30000);
    const jitter = base * 0.3 * Math.random();
    return base + jitter;
  }, []);

  // ---------------------------------------------------------------------------
  // Heartbeat: send application-level { type: "ping" } every 30s.
  // The server responds with { type: "pong" }. If no pong arrives, the browser
  // will eventually fire onerror/onclose when the TCP stack detects the break.
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
  // Message queue: messages sent while disconnected/reconnecting are buffered
  // and flushed as soon as the connection is re-established.
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

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/api/v1/ws`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      // Authenticate via first message instead of query string to avoid token leaking in logs
      ws.send(JSON.stringify({ type: 'auth', token }));
      setConnectionState(WS_STATE.AUTHENTICATING);
      console.log('[WS] Socket opened, authenticating...');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        // Silently consume pong responses from the server
        if (data.type === 'pong') return;

        // Handle auth_ok: transition to CONNECTED only after server confirms auth
        if (data.type === 'auth_ok') {
          retryCountRef.current = 0;
          setConnectionState(WS_STATE.CONNECTED);
          startHeartbeat();
          flushMessageQueue();
          console.log('[WS] Authenticated and connected');
          return;
        }

        // Handle auth error from server
        if (data.type === 'error' && connectionStateRef.current !== WS_STATE.CONNECTED) {
          console.error('[WS] Auth failed:', data.message);
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
        setConnectionState(WS_STATE.RECONNECTING);
        retryCountRef.current += 1;
        const delay = getReconnectDelay();
        console.log(
          `[WS] Reconnecting in ${Math.round(delay)}ms (attempt ${retryCountRef.current})`
        );
        reconnectTimerRef.current = setTimeout(connect, delay);
      } else {
        setConnectionState(WS_STATE.DISCONNECTED);
      }
    };

    ws.onerror = () => {
      // onerror is always followed by onclose in browsers, so just close here
      ws.close();
    };
  }, [startHeartbeat, stopHeartbeat, getReconnectDelay, flushMessageQueue]);

  const disconnect = useCallback(() => {
    manualDisconnectRef.current = true;
    clearTimeout(reconnectTimerRef.current);
    stopHeartbeat();
    if (wsRef.current) {
      wsRef.current.onclose = null; // prevent auto-reconnect
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnectionState(WS_STATE.DISCONNECTED);
    messageQueueRef.current = [];
    retryCountRef.current = 0;
  }, [stopHeartbeat]);

  // ---------------------------------------------------------------------------
  // send() -- queue-aware: buffers messages while disconnected
  // ---------------------------------------------------------------------------
  const send = useCallback((message) => {
    const ws = wsRef.current;
    const data = typeof message === 'string' ? message : JSON.stringify(message);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    } else {
      messageQueueRef.current.push(data);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Event listener helpers  (unchanged API surface)
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

  return (
    <WebSocketContext.Provider
      value={{ connected, connectionState, connect, disconnect, send, on, off }}
    >
      {children}
    </WebSocketContext.Provider>
  );
}
