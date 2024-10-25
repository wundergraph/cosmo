package benchmarksubscriptions

import (
	"bufio"
	"bytes"
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
	subscribers := 1_000 * 5

	wg := &sync.WaitGroup{}
	wg.Add(subscribers)

	messageCount := &atomic.Int64{}
	subscriberCount := &atomic.Int64{}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	prevMessageCount := int64(0)
	totalMessageCount := int64(0)
	ticks := int64(0)
	go func() {
		tick := time.NewTicker(time.Second)
		defer tick.Stop()
		for {
			select {
			case <-tick.C:
				ticks++
				currentMessageCount := messageCount.Load()
				msgsPerSecond := currentMessageCount - prevMessageCount
				totalMessageCount += msgsPerSecond
				fmt.Printf("Sub count: %d Msg total: %d, Msg/s: %d, Avg Msg/s: %d\n", subscriberCount.Load(), messageCount.Load(), msgsPerSecond, totalMessageCount/ticks)
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
		time.Sleep(time.Millisecond)
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

func TestMultipartSubscription(t *testing.T) {
	subscribers := 1_000 * 5

	wg := &sync.WaitGroup{}
	wg.Add(subscribers)

	messageCount := &atomic.Int64{}
	subscriberCount := &atomic.Int64{}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	prevMessageCount := int64(0)
	totalMessageCount := int64(0)
	ticks := int64(0)
	go func() {
		tick := time.NewTicker(time.Second)
		defer tick.Stop()
		for {
			select {
			case <-tick.C:
				ticks++
				currentMessageCount := messageCount.Load()
				msgsPerSecond := currentMessageCount - prevMessageCount
				totalMessageCount += msgsPerSecond
				fmt.Printf("Sub count: %d Msg total: %d, Msg/s: %d, Avg Msg/s: %d\n", subscriberCount.Load(), messageCount.Load(), msgsPerSecond, totalMessageCount/ticks)
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
		time.Sleep(time.Millisecond)
		subscriberCount.Inc()
		go subscribeMultipart(t, i, messageCount, wg, maxCount, intervalMilliseconds)
	}

	wg.Wait()
	fmt.Printf("All subscribers done\n")
}

func subscribeMultipart(t *testing.T, iteration int, messageCount *atomic.Int64, wg *sync.WaitGroup, maxCount, intervalMilliseconds int) {
	defer wg.Done()
	req, err := http.NewRequest("POST", "http://localhost:3011/", bytes.NewReader([]byte(fmt.Sprintf(`{"query":"subscription { countEmp(max: %d, intervalMilliseconds: %d) }"}`, maxCount, intervalMilliseconds))))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("accept", "multipart/mixed;subscriptionSpec=1.0, application/json")
	req.Header.Set("content-type", "application/json")
	client := &http.Client{
		Timeout: time.Second * 60 * 5,
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	r := bufio.NewReader(resp.Body)
	for {
		line, isPrefix, err := r.ReadLine()
		if err != nil {
			t.Fatal(err)
		}
		if isPrefix {
			t.Fatal("isPrefix")
		}
		if string(line) == "--graphql" {
			continue
		}
		if string(line) == "" {
			continue
		}
		if string(line) == "content-type: application/json" {
			continue
		}
		if string(line) == "--graphql--" {
			break
		}
		if string(line) == "{}" {
			continue
		}
		messageCount.Inc()
	}
	fmt.Printf("Subscriber %d done\n", iteration)
}
