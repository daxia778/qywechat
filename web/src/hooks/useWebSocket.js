import { useContext } from 'react';
import { WebSocketContext, WS_STATE } from '../contexts/WebSocketContext';

export function useWebSocket() {
  return useContext(WebSocketContext);
}

export { WS_STATE };
