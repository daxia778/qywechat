//go:build !windows

package main

import (
	"os"
	"os/signal"
	"syscall"
)

func registerSignals(quit chan<- os.Signal) {
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)
}
