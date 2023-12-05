package pubsub

import (
	"context"
	"errors"
	"fmt"

	"github.com/nats-io/nats.go"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/pubsub_datasource"
)

var (
	_ pubsub_datasource.Connector = (*natsConnector)(nil)
	_ pubsub_datasource.PubSub    = (*natsPubSub)(nil)
)

type natsConnector struct {
	conn *nats.Conn
}

func NewNATSConnector(conn *nats.Conn) pubsub_datasource.Connector {
	return &natsConnector{conn: conn}
}

func (c *natsConnector) New(ctx context.Context) pubsub_datasource.PubSub {
	return &natsPubSub{
		ctx:  ctx,
		conn: c.conn,
	}
}

type natsPubSub struct {
	ctx  context.Context
	conn *nats.Conn
}

func (p *natsPubSub) Subscribe(ctx context.Context, topic string, next chan<- []byte) error {
	if p.conn == nil {
		return errors.New("NATS is not configured")
	}
	ch := make(chan *nats.Msg)
	sub, err := p.conn.ChanSubscribe(topic, ch)
	if err != nil {
		return fmt.Errorf("error subscribing to NATS topic %s: %w", topic, err)
	}
	for {
		select {
		case <-ctx.Done():
			_ = sub.Unsubscribe()
			close(next)
			close(ch)
			return nil
		case msg := <-ch:
			next <- msg.Data
			msg.Ack()
		}
	}
}
