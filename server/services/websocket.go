package services

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"pdd-order-system/config"

	"github.com/gorilla/websocket"
)

const (
	// pongWait is the maximum time to wait for a pong (or any read) before
	// considering the connection dead.
	pongWait = 60 * time.Second

	// pingInterval must be shorter than pongWait so the server sends a
	// WebSocket-level ping before the read deadline expires.
	pingInterval = 30 * time.Second

	// writeWait is the deadline for individual write operations.
	writeWait = 5 * time.Second

	// maxConnsPerUser 每个用户最大 WebSocket 连接数，防止单用户 DoS
	maxConnsPerUser = 5
)

// WSEvent WebSocket 推送事件
type WSEvent struct {
	Type    string      `json:"type"`    // order_created / order_updated / notification
	Payload interface{} `json:"payload"`
}

// clientMessage represents an inbound JSON message from a browser client.
type clientMessage struct {
	Type string `json:"type"`
}

// safeConn 包装 websocket.Conn，提供并发安全的写操作
// gorilla/websocket 的 WriteMessage 不是并发安全的，必须串行化写操作
type safeConn struct {
	conn   *websocket.Conn
	mu     sync.Mutex
	userID string
}

func (sc *safeConn) writeMessage(msgType int, data []byte) error {
	sc.mu.Lock()
	defer sc.mu.Unlock()
	sc.conn.SetWriteDeadline(time.Now().Add(writeWait))
	return sc.conn.WriteMessage(msgType, data)
}

func (sc *safeConn) writeControl(msgType int, data []byte, deadline time.Time) error {
	sc.mu.Lock()
	defer sc.mu.Unlock()
	return sc.conn.WriteControl(msgType, data, deadline)
}

// WSHub WebSocket 连接管理中心
type WSHub struct {
	mu      sync.RWMutex
	clients map[*safeConn]struct{}
}

var Hub = &WSHub{
	clients: make(map[*safeConn]struct{}),
}

var upgrader = websocket.Upgrader{
	CheckOrigin:     checkWSOrigin,
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

// checkWSOrigin 校验 WebSocket 连接的 Origin 是否在允许列表中
func checkWSOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true // 非浏览器客户端（如桌面端 Wails）允许
	}
	for _, allowed := range config.C.CORSOrigins {
		if origin == allowed {
			return true
		}
	}
	log.Printf("⚠️ WebSocket Origin 被拒绝: %s", origin)
	return false
}

// pongPayload is the pre-serialized JSON response to application-level pings.
var pongPayload = []byte(`{"type":"pong"}`)

// Register 注册一个新的 WebSocket 连接
func (h *WSHub) Register(conn *websocket.Conn, userID string) {
	// 检查该用户当前连接数，超过上限则拒绝
	if h.UserClientCount(userID) >= maxConnsPerUser {
		log.Printf("⚠️ WebSocket 连接被拒绝 | user=%s | 已达上限 %d", userID, maxConnsPerUser)
		conn.WriteControl(
			websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "too many connections"),
			time.Now().Add(writeWait),
		)
		conn.Close()
		return
	}

	sc := &safeConn{conn: conn, userID: userID}

	h.mu.Lock()
	h.clients[sc] = struct{}{}
	h.mu.Unlock()
	log.Printf("🔌 WebSocket 连接 | user=%s | total=%d", userID, len(h.clients))

	// 启动读循环 — handles both disconnect detection and application-level
	// ping messages from the browser client.
	go func() {
		defer func() {
			h.mu.Lock()
			delete(h.clients, sc)
			h.mu.Unlock()
			conn.Close()
			log.Printf("🔌 WebSocket 断开 | user=%s | total=%d", userID, len(h.clients))
		}()

		conn.SetReadDeadline(time.Now().Add(pongWait))

		// Handle WebSocket-level pong frames (response to our server pings).
		conn.SetPongHandler(func(string) error {
			conn.SetReadDeadline(time.Now().Add(pongWait))
			return nil
		})

		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				break
			}

			// Any successful read proves the connection is alive — reset
			// the read deadline so the client doesn't time out.
			conn.SetReadDeadline(time.Now().Add(pongWait))

			// Handle application-level ping from the browser client.
			// The frontend sends {"type":"ping"} every 30 seconds.
			var cm clientMessage
			if json.Unmarshal(msg, &cm) == nil && cm.Type == "ping" {
				if writeErr := sc.writeMessage(websocket.TextMessage, pongPayload); writeErr != nil {
					break
				}
			}
		}
	}()

	// 心跳 — server-side WebSocket-level pings to detect stale clients.
	go func() {
		ticker := time.NewTicker(pingInterval)
		defer ticker.Stop()
		for range ticker.C {
			h.mu.RLock()
			_, exists := h.clients[sc]
			h.mu.RUnlock()
			if !exists {
				return
			}
			if err := sc.writeControl(websocket.PingMessage, nil, time.Now().Add(writeWait)); err != nil {
				return
			}
		}
	}()
}

// Broadcast 向所有在线客户端广播事件
func (h *WSHub) Broadcast(event WSEvent) {
	data, err := json.Marshal(event)
	if err != nil {
		return
	}

	h.mu.RLock()
	// 复制一份连接列表，避免在写操作时持有 RLock（写操作需要获取 safeConn.mu）
	clients := make([]*safeConn, 0, len(h.clients))
	for sc := range h.clients {
		clients = append(clients, sc)
	}
	h.mu.RUnlock()

	for _, sc := range clients {
		if err := sc.writeMessage(websocket.TextMessage, data); err != nil {
			sc.conn.Close()
		}
	}
}

// SendTo 向指定用户推送事件
func (h *WSHub) SendTo(userID string, event WSEvent) {
	data, err := json.Marshal(event)
	if err != nil {
		return
	}

	h.mu.RLock()
	clients := make([]*safeConn, 0)
	for sc := range h.clients {
		if sc.userID == userID {
			clients = append(clients, sc)
		}
	}
	h.mu.RUnlock()

	for _, sc := range clients {
		if err := sc.writeMessage(websocket.TextMessage, data); err != nil {
			sc.conn.Close()
		}
	}
}

// ClientCount returns the number of currently connected clients.
func (h *WSHub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// UserClientCount returns the number of connections for a specific user.
func (h *WSHub) UserClientCount(userID string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	count := 0
	for sc := range h.clients {
		if sc.userID == userID {
			count++
		}
	}
	return count
}
