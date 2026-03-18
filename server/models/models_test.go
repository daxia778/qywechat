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
		{StatusDesigning, false},
		{StatusDelivered, false},
		{StatusCompleted, true},
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
		{StatusPending, StatusGroupCreated, true},
		{StatusPending, StatusRefunded, true},
		{StatusPending, StatusClosed, true},
		{StatusPending, StatusDesigning, false}, // invalid skip
		
		{StatusGroupCreated, StatusDesigning, true},
		{StatusGroupCreated, StatusDelivered, false}, // invalid skip
		
		{StatusDesigning, StatusDelivered, true},
		{StatusDesigning, StatusClosed, true},
		
		{StatusDelivered, StatusCompleted, true},
		{StatusDelivered, StatusDesigning, false}, // Cannot go back
		
		{StatusCompleted, StatusRefunded, false}, // Terminal state
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
	// 验证设计模式：设计师只能流转单子到"已交付"状态
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

	// 验证客服操作范围
	completedAllowed := StatusChangePermission[StatusCompleted]
	hasOperator := false
	for _, role := range completedAllowed {
		if role == "operator" {
			hasOperator = true
		}
	}
	if !hasOperator {
		t.Errorf("Operator should be allowed to change status to %s", StatusCompleted)
	}

	// 验证未定义状态的获取
	_, exists := StatusChangePermission["UNKNOWN"]
	if exists {
		t.Errorf("UNKNOWN status should not have permissions defined")
	}
}
