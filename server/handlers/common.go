package handlers

import (
	"log"
	"runtime/debug"
	"strings"

	"gorm.io/gorm"
)

// escapeLike 转义 LIKE 查询中的特殊通配符，防止用户注入 % 或 _ 改变查询范围
func escapeLike(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, "%", `\%`)
	s = strings.ReplaceAll(s, "_", `\_`)
	return s
}

// safeGo 启动一个带 recover 保护的 goroutine，防止异步任务 panic 导致进程崩溃
func safeGo(tag string, fn func()) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[safeGo:%s] panic recovered: %v\n%s", tag, r, debug.Stack())
			}
		}()
		fn()
	}()
}

// filterByRole 根据角色对查询施加数据权限过滤（v2.0: admin/follow/sales 三角色）
// 返回 false 表示角色未知 / 无权限，由调用方决定具体的 HTTP 错误码
func filterByRole(query *gorm.DB, role, userID string) (*gorm.DB, bool) {
	switch role {
	case "admin":
		return query, true
	case "follow":
		// 跟单客服只能查看自己作为录单人或跟单客服的订单
		return query.Where("operator_id = ? OR follow_operator_id = ?", userID, userID), true
	case "sales":
		return query.Where("operator_id = ?", userID), true
	default:
		return query, false
	}
}
