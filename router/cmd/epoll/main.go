package main

import (
	"context"
	"fmt"
	"github.com/wundergraph/cosmo/router/internal/epoller"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	// Handling shutdown
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt,
		syscall.SIGHUP,  // process is detached from terminal
		syscall.SIGTERM, // default for kill
		syscall.SIGKILL,
		syscall.SIGQUIT, // ctrl + \
		syscall.SIGINT,  // ctrl+c
	)
	defer stop()

	poller, err := epoller.NewPoller(128, time.Second)
	if err != nil {
		panic(err)
	}

	fmt.Println("Server started")

	// start server
	ln, err := net.Listen("tcp", "127.0.0.1:3111")
	if err != nil {
		panic(err)
	}
	defer ln.Close()

	fmt.Println("Listening on", ln.Addr())

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				fmt.Println("Server closed with error", err)
				return
			}

			fmt.Println("New connection", conn.RemoteAddr())

			poller.Add(conn)

			fmt.Println("Connection added to poller")
		}
	}()

	<-ctx.Done()

	if err := poller.Close(true); err != nil {
		panic(err)
	}

	fmt.Println("Server closed")
}
