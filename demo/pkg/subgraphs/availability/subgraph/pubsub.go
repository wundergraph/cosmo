package subgraph

import (
	"encoding/json"
	"fmt"
	"log"
	"os"

	"github.com/nats-io/nats.go"
)

var pubsub = newPubSub()

type message struct {
	ID       int    `json:"id"`
	TypeName string `json:"__typename"`
}

type PubSub interface {
	Publish(subscription string, id int)
}

type pubSub struct {
	nc *nats.Conn
}

func (p *pubSub) Publish(subscription string, id int) {
	if p.nc == nil {
		return
	}
	data, err := json.Marshal(message{
		ID:       id,
		TypeName: "Employee",
	})
	if err != nil {
		panic(err)
	}
	topic := fmt.Sprintf("%s.%d", subscription, id)
	p.nc.Publish(topic, data)
}

func newPubSub() PubSub {
	url := nats.DefaultURL
	if u := os.Getenv("NATS_URL"); u != "" {
		url = u
	}
	nc, err := nats.Connect(url)
	if err != nil {
		log.Printf("failed to connect to nats: %v", err)
	} else {
		log.Printf("connected to nats at %s", url)
	}
	return &pubSub{nc: nc}
}
