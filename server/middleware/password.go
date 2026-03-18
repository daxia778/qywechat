package middleware

import (
	"fmt"
	"unicode"
)

// ValidatePasswordStrength 密码强度校验
// 要求至少 8 位，包含大写、小写、数字
func ValidatePasswordStrength(password string) error {
	if len(password) < 8 {
		return fmt.Errorf("密码长度至少 8 位")
	}

	var hasUpper, hasLower, hasDigit bool
	for _, c := range password {
		switch {
		case unicode.IsUpper(c):
			hasUpper = true
		case unicode.IsLower(c):
			hasLower = true
		case unicode.IsDigit(c):
			hasDigit = true
		}
	}

	if !hasUpper {
		return fmt.Errorf("密码必须包含至少一个大写字母")
	}
	if !hasLower {
		return fmt.Errorf("密码必须包含至少一个小写字母")
	}
	if !hasDigit {
		return fmt.Errorf("密码必须包含至少一个数字")
	}

	return nil
}
