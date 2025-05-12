package utils

type OrderedSet[T comparable] struct {
	elements []T
	index    map[T]struct{}
}

// NewOrderedSet creates and returns a new OrderedSet.
func NewOrderedSet[T comparable]() *OrderedSet[T] {
	return &OrderedSet[T]{
		elements: make([]T, 0),
		index:    make(map[T]struct{}),
	}
}

// Add inserts elem into the set if it's not already present.
func (s *OrderedSet[T]) Add(elem T) {
	if _, exists := s.index[elem]; !exists {
		s.index[elem] = struct{}{}
		s.elements = append(s.elements, elem)
	}
}

// Remove deletes elem from the set if it exists, preserving order of other elements.
func (s *OrderedSet[T]) Remove(elem T) {
	if _, exists := s.index[elem]; exists {
		delete(s.index, elem)
		// rebuild slice without the removed element
		for i, v := range s.elements {
			if v == elem {
				s.elements = append(s.elements[:i], s.elements[i+1:]...)
				break
			}
		}
	}
}

// Contains returns true if elem is in the set.
func (s *OrderedSet[T]) Contains(elem T) bool {
	_, exists := s.index[elem]
	return exists
}

// Values returns a slice of elements in insertion order.
// The returned slice is a copy; modifying it won't affect the set.
func (s *OrderedSet[T]) Values() []T {
	dup := make([]T, len(s.elements))
	copy(dup, s.elements)
	return dup
}

// Len returns the number of elements in the set.
func (s *OrderedSet[T]) Len() int {
	return len(s.elements)
}

// Clear removes all elements from the set.
func (s *OrderedSet[T]) Clear() {
	s.elements = make([]T, 0)
	s.index = make(map[T]struct{})
}