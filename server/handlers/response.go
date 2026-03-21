package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// ─── 错误码常量 ──────────────────────────────────────────

const (
	CodeBadRequest  = "BAD_REQUEST"
	CodeUnauthorized = "UNAUTHORIZED"
	CodeForbidden   = "FORBIDDEN"
	CodeNotFound    = "NOT_FOUND"
	CodeConflict    = "CONFLICT"
	CodeTooManyReqs = "TOO_MANY_REQUESTS"
	CodeInternal    = "INTERNAL_ERROR"
)

// APIError 统一错误响应结构
type APIError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// ─── 错误响应便捷函数 ──────────────────────────────────────

func respondError(c *gin.Context, status int, code, msg string) {
	c.JSON(status, APIError{Code: code, Message: msg})
}

func badRequest(c *gin.Context, msg string) {
	respondError(c, http.StatusBadRequest, CodeBadRequest, msg)
}

func unauthorized(c *gin.Context, msg string) {
	respondError(c, http.StatusUnauthorized, CodeUnauthorized, msg)
}

func notFound(c *gin.Context, msg string) {
	respondError(c, http.StatusNotFound, CodeNotFound, msg)
}

func forbidden(c *gin.Context, msg string) {
	respondError(c, http.StatusForbidden, CodeForbidden, msg)
}

func conflict(c *gin.Context, msg string) {
	respondError(c, http.StatusConflict, CodeConflict, msg)
}

func internalError(c *gin.Context, msg string) {
	respondError(c, http.StatusInternalServerError, CodeInternal, msg)
}

// ─── 成功响应便捷函数 ──────────────────────────────────────

func respondOK(c *gin.Context, data interface{}) {
	c.JSON(http.StatusOK, data)
}

func respondList(c *gin.Context, data interface{}, total int) {
	c.JSON(http.StatusOK, gin.H{"data": data, "total": total})
}

func respondMessage(c *gin.Context, msg string) {
	c.JSON(http.StatusOK, gin.H{"message": msg})
}
