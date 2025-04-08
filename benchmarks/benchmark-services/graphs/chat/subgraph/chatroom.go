package subgraph

import (
	"context"
	"fmt"
	"slices"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wundergraph/benchmark-services/graphs/chat/subgraph/model"
)

type chatRoomChannel struct {
	channel chan *model.ChatMessage
	ctx     context.Context
}

type ChatRoomContainer struct {
	id       string
	name     string
	product  *model.Product
	messages []*model.ChatMessage
	users    []*model.User

	chatRoomContainerMutex sync.Mutex
	chatRoomChannel        []*chatRoomChannel
}

func (c *ChatRoomContainer) GetModel() *model.ChatRoom {
	return &model.ChatRoom{
		ID:       c.id,
		Name:     c.name,
		Messages: c.messages,
		Users:    c.users,
		Product:  c.product,
	}
}

func (c *ChatRoomContainer) GetMessages() []*model.ChatMessage {
	return c.messages
}

func NewChatRoomContainer(id string, name string) *ChatRoomContainer {
	return &ChatRoomContainer{
		id:              id,
		name:            name,
		product:         &model.Product{ID: "1"},
		chatRoomChannel: make([]*chatRoomChannel, 0),
	}
}

func (c *ChatRoomContainer) Subscribe(ctx context.Context) (<-chan *model.ChatMessage, error) {
	c.chatRoomContainerMutex.Lock()
	defer c.chatRoomContainerMutex.Unlock()

	channel := make(chan *model.ChatMessage)
	c.chatRoomChannel = append(c.chatRoomChannel, &chatRoomChannel{
		channel: channel,
		ctx:     ctx,
	})

	return channel, nil
}

func (c *ChatRoomContainer) Unsubscribe() {
	c.chatRoomContainerMutex.Lock()
	defer c.chatRoomContainerMutex.Unlock()

	for _, ch := range c.chatRoomChannel {
		close(ch.channel)
	}
}

func (c *ChatRoomContainer) publishMessage(message *model.ChatMessage) {
	fmt.Println("Publishing message to", len(c.chatRoomChannel), "channels")

	for idx, ch := range c.chatRoomChannel {
		select {
		case <-ch.ctx.Done():
			// If the channel is closed, skip the message and remove it from the list
			c.chatRoomChannel = slices.Delete(c.chatRoomChannel, idx, idx+1)
		case ch.channel <- message:
		default:
			// If the channel is blocked, skip the message
		}
	}
}

func (c *ChatRoomContainer) SendMessage(message string, senderID string) *model.ChatMessage {
	c.chatRoomContainerMutex.Lock()
	defer c.chatRoomContainerMutex.Unlock()

	msg := &model.ChatMessage{
		ID:        uuid.New().String(),
		Message:   message,
		CreatedAt: time.Now(),
		Sender:    &model.User{ID: senderID},
	}

	c.messages = append(c.messages, msg)
	c.publishMessage(msg)

	return msg
}

func (c *ChatRoomContainer) Messages() []*model.ChatMessage {
	return c.messages
}

type ChatRoomManager struct {
	chatrooms map[string]*ChatRoomContainer
}

func NewChatRoomManager() *ChatRoomManager {
	return &ChatRoomManager{
		chatrooms: make(map[string]*ChatRoomContainer),
	}
}

func (c *ChatRoomManager) GetChatRoom(id string) *ChatRoomContainer {
	return c.chatrooms[id]
}

func (c *ChatRoomManager) GetOrCreateChatRoom(id string) *ChatRoomContainer {
	if c.chatrooms[id] == nil {
		c.chatrooms[id] = NewChatRoomContainer(id, id)
	}
	return c.chatrooms[id]
}

func (c *ChatRoomManager) CreateChatRoom(id string, name string) *ChatRoomContainer {
	c.chatrooms[id] = NewChatRoomContainer(id, name)
	return c.chatrooms[id]
}

func (c *ChatRoomManager) DeleteChatRoom(id string) {
	c.chatrooms[id].Unsubscribe()
	delete(c.chatrooms, id)
}

func (c *ChatRoomManager) CleanUp() {
	for _, chatroom := range c.chatrooms {
		chatroom.Unsubscribe()
	}
	c.chatrooms = make(map[string]*ChatRoomContainer)
}

func (c *ChatRoomManager) GetAllChatRooms() []*model.ChatRoom {
	chatrooms := make([]*model.ChatRoom, 0)
	for _, chatroom := range c.chatrooms {
		chatrooms = append(chatrooms, chatroom.GetModel())
	}
	return chatrooms
}
