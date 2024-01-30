package main

import (
	"bytes"
	"context"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"sync"
	"syscall"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"golang.org/x/sync/errgroup"
)

type Message struct {
	ID      string  `json:"id"`
	Type    string  `json:"type"`
	Payload Payload `json:"payload"`
}

type Payload struct {
	Data Data `json:"data"`
}

type Data struct {
	EmployeeUpdated EmployeeUpdated `json:"employeeUpdated"`
}

type EmployeeUpdated struct {
	ID          int     `json:"id"`
	Details     Details `json:"details"`
	Role        Role    `json:"role"`
	UpdatedAt   string  `json:"updatedAt"`
	IsAvailable bool    `json:"isAvailable"`
	CurrentMood string  `json:"currentMood"`
}

type Details struct {
	Forename string `json:"forename"`
	Location string `json:"location"`
	Surname  string `json:"surname"`
}

type Role struct {
	Title []string `json:"title"`
}

var (
	instances = flag.Int("instances", 0, "number of instances to run")
	host      = flag.String("host", "127.0.0.1", "host to connect to")
)

func main() {
	flag.Parse()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if *instances != 0 {
		slog.Info("starting instances")
		for i := 0; i < *instances; i++ {
			runProcess(ctx, i)
		}
		slog.Info("all instances started")
		// wait for signal of app termination
		signalCh := make(chan os.Signal, 1)
		signal.Notify(signalCh, syscall.SIGINT, syscall.SIGTERM)
		<-signalCh
		slog.Info("shutting down instances")
		// cancel all instances
		cancel()
		// wait for all instances to terminate
		<-ctx.Done()
		slog.Info("all instances shut down")
		return
	}

	connections := 100
	g, ctx := errgroup.WithContext(ctx)
	tick := make(chan struct{})
	acked := &sync.WaitGroup{}
	acked.Add(connections)
	for i := 0; i < connections; i++ {
		num := i
		g.Go(func() error {
			connect(ctx, num, tick, acked)
			return nil
		})
	}
	go func() {
		acked.Wait()
		slog.Info(fmt.Sprintf("processID: %d - %d connections acked", os.Getppid(), connections))
	}()
	go func() {
		counter := 0
		for {
			<-tick
			counter++
			if counter == connections {
				slog.Info(fmt.Sprintf("all %d connections received an update", connections))
				counter = 0
			}
		}
	}()
	err := g.Wait()
	if err != nil {
		slog.Error(err.Error())
	}
}

func connect(ctx context.Context, num int, tick chan struct{}, acked *sync.WaitGroup) {
	u, err := url.Parse(fmt.Sprintf("ws://%s:3003/graphql", *host))
	if err != nil {
		slog.Error(err.Error())
		return
	}
	c, _, err := websocket.DefaultDialer.DialContext(ctx, u.String(), http.Header{
		"Sec-WebSocket-Protocol": []string{"graphql-transport-ws"},
		"Sec-WebSocket-Version":  []string{"13"},
	})
	if err != nil {
		slog.Error(err.Error(), slog.Int("num", num))
		return
	}
	defer c.Close()
	err = c.WriteMessage(websocket.TextMessage, []byte(`{"type":"connection_init"}`))
	if err != nil {
		slog.Error(err.Error())
	}
	_, message, err := c.ReadMessage()
	if err != nil {
		slog.Error(err.Error())
	}
	if !bytes.Contains(message, []byte(`connection_ack`)) {
		slog.Error("connection not acked")
		return
	}
	acked.Done()
	id, err := uuid.NewUUID()
	if err != nil {
		slog.Error(err.Error())
		return
	}
	err = c.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf(`{"id":"%s","type":"subscribe","payload":{"query":"subscription {\n  employeeUpdated(employeeID: 1) {\n    id\n    details {\n      forename\n      location\n      surname\n    }\n    role {\n      title\n    }\n    updatedAt\n    isAvailable\n    currentMood\n  }\n}\n"}}`, id.String())))
	if err != nil {
		slog.Error(err.Error())
	}
	for {
		if ctx.Err() != nil {
			return
		}
		_, _, err := c.ReadMessage()
		if err != nil {
			slog.Error(err.Error())
			break
		}
		tick <- struct{}{}
	}
	slog.Info(fmt.Sprintf("connection %d closed", num))
}

func runProcess(ctx context.Context, instance int) {
	cmd := exec.CommandContext(ctx, "./subscriptiontest", "-host", *host)
	// pipe stdout and stderr to the same pipe with a process prefix
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	slog.Info(fmt.Sprintf("starting instance %d", instance))
	err := cmd.Start()
	if err != nil {
		slog.Error(err.Error())
		return
	}
}
