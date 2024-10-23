package benchmarksubscriptions

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"go.uber.org/atomic"
)

func TestSubscriptions(t *testing.T) {
	subscribers := 10_000

	wg := &sync.WaitGroup{}
	wg.Add(subscribers)

	messageCount := &atomic.Int64{}
	subscriberCount := &atomic.Int64{}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	prevMessageCount := int64(0)

	go func() {
		tick := time.NewTicker(time.Second)
		defer tick.Stop()
		for {
			select {
			case <-tick.C:
				currentMessageCount := messageCount.Load()
				msgsPerSecond := currentMessageCount - prevMessageCount
				fmt.Printf("Subscribers: %d Message count: %d, Msgs per second: %d\n", subscriberCount.Load(), messageCount.Load(), msgsPerSecond)
				prevMessageCount = currentMessageCount
			case <-ctx.Done():
				return
			}
		}
	}()

	for i := 0; i < subscribers; i++ {
		i := i
		maxCount := 1000
		intervalMilliseconds := 3000 + i
		time.Sleep(time.Millisecond * 10)
		subscriberCount.Inc()
		go subscribe(t, i, messageCount, wg, maxCount, intervalMilliseconds)
	}

	wg.Wait()
	fmt.Printf("All subscribers done\n")
}

func subscribe(t *testing.T, iteration int, messageCount *atomic.Int64, wg *sync.WaitGroup, maxCount, intervalMilliseconds int) {
	defer wg.Done()

	dialer := websocket.Dialer{
		Subprotocols: []string{"graphql-transport-ws"},
	}
	conn, resp, err := dialer.Dial("ws://localhost:3002/graphql", nil)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
		return
	}
	if resp.StatusCode != http.StatusSwitchingProtocols {
		fmt.Printf("Unexpected status code: %d\n", resp.StatusCode)
		return
	}
	t.Cleanup(func() {
		_ = conn.Close()
	})
	err = conn.WriteJSON(WebSocketMessage{
		Type: "connection_init",
	})
	if err != nil {
		fmt.Printf("Error: %v\n", err)
		return
	}
	var ack WebSocketMessage
	err = conn.ReadJSON(&ack)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
		return
	}
	if ack.Type != "connection_ack" {
		fmt.Printf("Unexpected message: %+v\n", ack)
		return
	}

	err = conn.WriteJSON(&testenv.WebSocketMessage{
		ID:      "1",
		Type:    "subscribe",
		Payload: []byte(fmt.Sprintf(`{"query":"subscription { countEmp(max: %d, intervalMilliseconds: %d) }"}`, maxCount, intervalMilliseconds)),
	})
	if err != nil {
		fmt.Printf("Error: %v\n", err)
		return
	}

	for i := 0; i < maxCount; i++ {
		var message WebSocketMessage
		err = conn.ReadJSON(&message)
		if err != nil {
			fmt.Printf("Error: %v\n", err)
			return
		}
		if message.Type != "next" {
			fmt.Printf("Unexpected message: %+v\n", message)
			return
		}
		var res CountEmpResponse
		err = json.Unmarshal(message.Payload, &res)
		if err != nil {
			fmt.Printf("Error: %v\n", err)
			return
		}
		if res.Data.CountEmp != i {
			fmt.Printf("Unexpected count: %d, expected %d\n", res.Data.CountEmp, i)
			return
		}
		messageCount.Inc()
	}

	err = conn.WriteJSON(&WebSocketMessage{
		ID:   "1",
		Type: "complete",
	})
	if err != nil {
		fmt.Printf("Error: %v\n", err)
		return
	}

	var complete WebSocketMessage
	err = conn.SetReadDeadline(time.Now().Add(1 * time.Second))
	if err != nil {
		fmt.Printf("Error: %v\n", err)
	}
	err = conn.ReadJSON(&complete)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
		return
	}
	if complete.Type != "complete" {
		fmt.Printf("Unexpected message: %v\n", complete)
		return
	}
	if complete.ID != "1" {
		fmt.Printf("Unexpected message: %v\n", complete)
		return
	}
	fmt.Printf("Subscriber %d done\n", iteration)
}

type CountEmpResponse struct {
	Data struct {
		CountEmp int `json:"countEmp"`
	} `json:"data"`
}

type WebSocketMessage struct {
	ID      string          `json:"id,omitempty"`
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

type GraphQLResponse struct {
	Data   json.RawMessage `json:"data,omitempty"`
	Errors []GraphQLError  `json:"errors,omitempty"`
}

type GraphQLError struct {
	Message string `json:"message"`
}
