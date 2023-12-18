package subgraph

import (
	"sync"
)

var storage = NewAvailabilityStorage()

type availabilityStorage struct {
	mu sync.RWMutex
	m  map[int]bool
}

func NewAvailabilityStorage() *availabilityStorage {
	return &availabilityStorage{
		m: make(map[int]bool),
	}
}

func (s *availabilityStorage) Get(id int) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.m[id]
}

func (s *availabilityStorage) Set(id int, availability bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.m[id] = availability
}
