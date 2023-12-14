package pubsub

import (
	"context"
	"errors"
	"fmt"
	"io"

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

func (p *natsPubSub) ensureConn() error {
	if p.conn == nil {
		return errors.New("NATS is not configured")
	}
	return nil
}

func (p *natsPubSub) Subscribe(ctx context.Context, topic string, next chan<- []byte) error {
	if err := p.ensureConn(); err != nil {
		return err
	}
	ch := make(chan *nats.Msg)
	sub, err := p.conn.ChanSubscribe(topic, ch)
	if err != nil {
		return fmt.Errorf("error subscribing to NATS topic %s: %w", topic, err)
	}
	go func() {
		for {
			select {
			case <-ctx.Done():
				_ = sub.Unsubscribe()
				close(ch)
				return
			case msg := <-ch:
				next <- msg.Data
				msg.Ack()
			}
		}
	}()
	return nil
}

func (p *natsPubSub) Publish(ctx context.Context, topic string, data []byte) error {
	if err := p.ensureConn(); err != nil {
		return err
	}
	return p.conn.Publish(topic, data)
}

func (p *natsPubSub) Request(ctx context.Context, topic string, data []byte, w io.Writer) error {
	if err := p.ensureConn(); err != nil {
		return err
	}
	msg, err := p.conn.RequestWithContext(ctx, topic, []byte(`{"id": 3}`))
	if err != nil {
		return fmt.Errorf("error requesting NATS topic %s: %w", topic, err)
	}
	_, err = w.Write(msg.Data)
	if err := msg.Ack(); err != nil {
		return fmt.Errorf("error acknowledging NATS message: %w", err)
	}
	return err
}
