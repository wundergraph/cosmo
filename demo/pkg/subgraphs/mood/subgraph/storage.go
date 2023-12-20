package subgraph

import (
	"sync"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/mood/subgraph/model"
)

var storage = NewMoodStorage()

type moodStorage struct {
	mu sync.RWMutex
	m  map[int]model.Mood
}

func NewMoodStorage() *moodStorage {
	return &moodStorage{
		m: make(map[int]model.Mood),
	}
}

func (s *moodStorage) Get(id int) model.Mood {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.m[id]
}

func (s *moodStorage) Set(id int, mood model.Mood) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.m[id] = mood
}
