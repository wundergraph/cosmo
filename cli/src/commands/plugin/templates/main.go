package main

import (
	"context"
	"log"
	"strconv"

	service "github.com/wundergraph/cosmo/plugin/generated"

	routerplugin "github.com/wundergraph/cosmo/router-plugin"
	"google.golang.org/grpc"
)

func main() {
	pl, err := routerplugin.NewRouterPlugin(func(s *grpc.Server) {
		s.RegisterService(&service.{serviceName}_ServiceDesc, &{serviceName}{
			users:  make(map[string]*service.User),
			nextID: 1,
		})
	})

	if err != nil {
		log.Fatalf("failed to create router plugin: %v", err)
	}

	pl.Serve()
}

type {serviceName} struct {
	service.Unimplemented{serviceName}Server
	users  map[string]*service.User
	nextID int
}

func (s *{serviceName}) QueryUser(ctx context.Context, req *service.QueryUserRequest) (*service.QueryUserResponse, error) {
	user, exists := s.users[req.Id]
	if !exists {
		// Return a default user if not found (for demo purposes)
		return &service.QueryUserResponse{
			User: &service.User{
				Id:   req.Id,
				Name: "Demo User",
				Role: service.UserRole_USER_ROLE_USER, // Default role
			},
		}, nil
	}

	return &service.QueryUserResponse{
		User: user,
	}, nil
}

func (s *{serviceName}) QueryUsersByRole(ctx context.Context, req *service.QueryUsersByRoleRequest) (*service.QueryUsersByRoleResponse, error) {
	var filteredUsers []*service.User

	for _, user := range s.users {
		if user.Role == req.Role {
			filteredUsers = append(filteredUsers, user)
		}
	}

	return &service.QueryUsersByRoleResponse{
		UsersByRole: filteredUsers,
	}, nil
}

func (s *{serviceName}) MutationCreateUser(ctx context.Context, req *service.MutationCreateUserRequest) (*service.MutationCreateUserResponse, error) {
	id := strconv.Itoa(s.nextID)
	s.nextID++

	// Use provided role or default to USER
	role := req.Role
	if role == service.UserRole_USER_ROLE_UNSPECIFIED {
		role = service.UserRole_USER_ROLE_USER
	}

	user := &service.User{
		Id:   id,
		Name: req.Name,
		Role: role,
	}

	s.users[id] = user

	return &service.MutationCreateUserResponse{
		CreateUser: user,
	}, nil
}

func (s *{serviceName}) MutationDeleteUser(ctx context.Context, req *service.MutationDeleteUserRequest) (*service.MutationDeleteUserResponse, error) {
	user, exists := s.users[req.Id]

	// If user doesn't exist, just return a canned response for demo purposes
	if !exists {
		return &service.MutationDeleteUserResponse{
			DeleteUser: &service.User{
				Id:   req.Id,
				Name: "Demo User",
				Role: service.UserRole_USER_ROLE_USER, // Default role
			},
		}, nil
	}

	delete(s.users, req.Id)

	return &service.MutationDeleteUserResponse{
		DeleteUser: user,
	}, nil
}

func (s *{serviceName}) MutationUpdateUserRole(ctx context.Context, req *service.MutationUpdateUserRoleRequest) (*service.MutationUpdateUserRoleResponse, error) {
	user, exists := s.users[req.Id]

	// If user doesn't exist, return a canned response for demo purposes
	if !exists {
		return &service.MutationUpdateUserRoleResponse{
			UpdateUserRole: &service.User{
				Id:   req.Id,
				Name: "Demo User",
				Role: req.Role,
			},
		}, nil
	}

	// Update the user's role
	user.Role = req.Role
	s.users[req.Id] = user

	return &service.MutationUpdateUserRoleResponse{
		UpdateUserRole: user,
	}, nil
}
