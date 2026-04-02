package models

import (
	"testing"
)

func TestIsTerminalStatus(t *testing.T) {
	tests := []struct {
		status   string
		expected bool
	}{
		{StatusPending, false},
		{StatusDesigning, false},
		// v2.0: COMPLETED 不是终态，可转到 REFUNDED
		{StatusCompleted, false},
		{StatusRefunded, true},
		// 旧状态（保留兼容）
		{StatusGroupCreated, false},
		{StatusConfirmed, false},
		{StatusDelivered, false},
		{StatusClosed, false}, // CLOSED 在 v2.0 中不再定义为终态（IsTerminalStatus 只认 REFUNDED）
		{"UNKNOWN", false},
	}

	for _, tt := range tests {
		t.Run(tt.status, func(t *testing.T) {
			if got := IsTerminalStatus(tt.status); got != tt.expected {
				t.Errorf("IsTerminalStatus(%q) = %v; want %v", tt.status, got, tt.expected)
			}
		})
	}
}

func TestValidTransitions(t *testing.T) {
	tests := []struct {
		from     string
		to       string
		expected bool
	}{
		// v2.0 正向流转: PENDING → DESIGNING → COMPLETED → REFUNDED
		{StatusPending, StatusDesigning, true},
		{StatusDesigning, StatusCompleted, true},
		{StatusCompleted, StatusRefunded, true},

		// v2.0 非法转换
		{StatusPending, StatusCompleted, false},   // 不可跳过 DESIGNING
		{StatusPending, StatusRefunded, false},    // 不可直接退款
		{StatusDesigning, StatusRefunded, false},   // 必须先完成
		{StatusCompleted, StatusDesigning, false},  // 不可回退
		{StatusRefunded, StatusPending, false},     // 终态不可转换

		// 旧状态不在 ValidTransitions 中，所以都是 false
		{StatusPending, StatusGroupCreated, false},
		{StatusGroupCreated, StatusConfirmed, false},
	}

	for _, tt := range tests {
		t.Run(tt.from+"_to_"+tt.to, func(t *testing.T) {
			allowedList, hasTransitions := ValidTransitions[tt.from]

			isValid := false
			if hasTransitions {
				for _, allowed := range allowedList {
					if allowed == tt.to {
						isValid = true
						break
					}
				}
			}

			if isValid != tt.expected {
				t.Errorf("Transition %s -> %s: got %v, want %v", tt.from, tt.to, isValid, tt.expected)
			}
		})
	}
}

func TestStatusChangePermission(t *testing.T) {
	// v2.0: 只有 admin 和 follow 可以操作状态变更
	// 验证 admin 可以操作 DESIGNING
	designingAllowed := StatusChangePermission[StatusDesigning]
	hasAdmin := false
	for _, role := range designingAllowed {
		if role == "admin" {
			hasAdmin = true
		}
	}
	if !hasAdmin {
		t.Errorf("Admin should be allowed to change status to %s", StatusDesigning)
	}

	// 验证 follow 可以操作 COMPLETED
	completedAllowed := StatusChangePermission[StatusCompleted]
	hasFollow := false
	for _, role := range completedAllowed {
		if role == "follow" {
			hasFollow = true
		}
	}
	if !hasFollow {
		t.Errorf("Follow should be allowed to change status to %s", StatusCompleted)
	}

	// 验证 follow 可以操作 REFUNDED
	refundedAllowed := StatusChangePermission[StatusRefunded]
	hasFollowRefund := false
	for _, role := range refundedAllowed {
		if role == "follow" {
			hasFollowRefund = true
		}
	}
	if !hasFollowRefund {
		t.Errorf("Follow should be allowed to change status to %s", StatusRefunded)
	}

	// 验证 designer/sales 不在权限列表中 (v2.0 移除了这些角色的状态操作权限)
	for _, status := range []string{StatusDesigning, StatusCompleted, StatusRefunded} {
		roles := StatusChangePermission[status]
		for _, role := range roles {
			if role == "designer" || role == "sales" {
				t.Errorf("Role %s should NOT be allowed to change status to %s in v2.0", role, status)
			}
		}
	}

	// 验证未定义状态的获取
	_, exists := StatusChangePermission["UNKNOWN"]
	if exists {
		t.Errorf("UNKNOWN status should not have permissions defined")
	}
}
