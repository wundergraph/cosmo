package subgraph

import (
	"fmt"
	"time"

	"github.com/wundergraph/benchmark-services/graphs/accounts/subgraph/model"
)

type UserManager struct {
	users map[string]*model.User
}

func NewUserManager() *UserManager {
	return &UserManager{
		users: make(map[string]*model.User),
	}
}

func (u *UserManager) GetAllUsers() []*model.User {
	users := make([]*model.User, 0)
	for _, user := range u.users {
		users = append(users, user)
	}
	return users
}

func (u *UserManager) GetOrCreateUser(id string) *model.User {
	return &model.User{
		ID:        id,
		Name:      "Unknown User",
		Email:     "unknown@example.com",
		Password:  "unknown",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
}

func (u *UserManager) GetUser(id string) *model.User {
	return &model.User{
		ID:        id,
		Name:      "Unknown User",
		Email:     "unknown@example.com",
		Password:  "unknown",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
}
func (u *UserManager) CreateUser(name string, email string, password string) *model.User {
	id := fmt.Sprintf("%d", len(u.users)+1)
	user := &model.User{
		ID:        id,
		Name:      name,
		Email:     email,
		Password:  password,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	return user
}
