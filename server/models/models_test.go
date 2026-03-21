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
		{StatusGroupCreated, false},
		{StatusConfirmed, false},
		{StatusDesigning, false},
		{StatusDelivered, false},
		{StatusRevision, false},
		{StatusAfterSale, false},
		// COMPLETED 不再是终态：可转到 AFTER_SALE / REFUNDED
		{StatusCompleted, false},
		{StatusRefunded, true},
		{StatusClosed, true},
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
		// PENDING 起点
		{StatusPending, StatusGroupCreated, true},
		{StatusPending, StatusRefunded, true},
		{StatusPending, StatusClosed, true},
		{StatusPending, StatusDesigning, false}, // 不可跳过

		// GROUP_CREATED → CONFIRMED（不可直接跳到 DESIGNING）
		{StatusGroupCreated, StatusConfirmed, true},
		{StatusGroupCreated, StatusDesigning, false},  // 需经过 CONFIRMED
		{StatusGroupCreated, StatusDelivered, false},  // 不可跳过

		// CONFIRMED → DESIGNING
		{StatusConfirmed, StatusDesigning, true},
		{StatusConfirmed, StatusDelivered, false}, // 不可跳过

		// DESIGNING 流转
		{StatusDesigning, StatusDelivered, true},
		{StatusDesigning, StatusAfterSale, true},
		{StatusDesigning, StatusClosed, true},

		// DELIVERED 流转
		{StatusDelivered, StatusCompleted, true},
		{StatusDelivered, StatusRevision, true},
		{StatusDelivered, StatusAfterSale, true},
		{StatusDelivered, StatusDesigning, false}, // 不可直接回退

		// REVISION 循环
		{StatusRevision, StatusDesigning, true},
		{StatusRevision, StatusAfterSale, true},

		// AFTER_SALE 处理
		{StatusAfterSale, StatusDesigning, true},
		{StatusAfterSale, StatusCompleted, true},

		// COMPLETED 可继续流转（非终态）
		{StatusCompleted, StatusAfterSale, true},
		{StatusCompleted, StatusRefunded, true},
		{StatusCompleted, StatusDesigning, false}, // 不可直接回退到设计
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
	// 验证设计师只能流转到"已交付"状态
	designAllowed := StatusChangePermission[StatusDelivered]
	hasDesigner := false
	for _, role := range designAllowed {
		if role == "designer" {
			hasDesigner = true
		}
	}
	if !hasDesigner {
		t.Errorf("Designer should be allowed to change status to %s", StatusDelivered)
	}

	// 验证 sales 可以操作 COMPLETED（角色已从 operator 重命名为 sales）
	completedAllowed := StatusChangePermission[StatusCompleted]
	hasSales := false
	for _, role := range completedAllowed {
		if role == "sales" {
			hasSales = true
		}
	}
	if !hasSales {
		t.Errorf("Sales should be allowed to change status to %s", StatusCompleted)
	}

	// 验证 follow 可以操作 COMPLETED
	hasFollow := false
	for _, role := range completedAllowed {
		if role == "follow" {
			hasFollow = true
		}
	}
	if !hasFollow {
		t.Errorf("Follow should be allowed to change status to %s", StatusCompleted)
	}

	// 验证未定义状态的获取
	_, exists := StatusChangePermission["UNKNOWN"]
	if exists {
		t.Errorf("UNKNOWN status should not have permissions defined")
	}
}
