package handlers

import "os"

func init() {
	os.MkdirAll("uploads", 0o755)
}
