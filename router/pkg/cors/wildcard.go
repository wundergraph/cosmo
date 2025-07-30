package cors

import (
	"bytes"
	"regexp"
	"strings"
)

// WildcardPattern represents a wildcard pattern that can match strings containing '*' wildcards
type WildcardPattern struct {
	pattern string
	cards   []card
}

// card represents a literal string segment between wildcards
type card struct {
	offset int
	size   int
}

var repeatedWildcards = regexp.MustCompile(`\*+`)

// NewWildcardPattern creates a new wildcard pattern from the given text
func Compile(pattern string) *WildcardPattern {
	if pattern == "" {
		return &WildcardPattern{
			pattern: pattern,
			cards:   make([]card, 0),
		}
	}

	pattern = repeatedWildcards.ReplaceAllString(pattern, "*")

	wp := &WildcardPattern{
		pattern: pattern,
		cards:   make([]card, 0),
	}

	pos := strings.Index(pattern, "*")
	if pos == -1 {
		// No wildcards, just one card with the entire string
		wp.cards = append(wp.cards, card{offset: 0, size: len(pattern)})
		return wp
	}

	// Add first card (prefix before first '*')
	wp.cards = append(wp.cards, card{offset: 0, size: pos})
	pos++

	// Process middle segments between '*' characters
	for {
		pos2 := strings.Index(pattern[pos:], "*")
		if pos2 == -1 {
			break
		}
		pos2 += pos // Convert back to absolute position
		if pos2 != pos {
			// Non-empty segment between wildcards
			wp.cards = append(wp.cards, card{offset: pos, size: pos2 - pos})
		}
		pos = pos2 + 1
	}

	// Add last card (suffix after last '*')
	wp.cards = append(wp.cards, card{offset: pos, size: len(pattern) - pos})

	return wp
}

// Match checks if the given string matches the wildcard pattern
func (wp *WildcardPattern) Match(s string) bool {
	matched := wp.MatchBytes([]byte(s))
	return matched
}

// MatchBytes checks if the given byte slice matches the wildcard pattern
func (wp *WildcardPattern) MatchBytes(data []byte) bool {
	begin := 0
	end := len(data)

	numCards := len(wp.cards)

	// Handle empty pattern
	if numCards == 0 {
		return len(data) == 0
	}

	// Check anchored prefix card
	firstCard := wp.cards[0]
	if end-begin < firstCard.size {
		return false
	}

	if !bytes.Equal(data[begin:begin+firstCard.size], []byte(wp.pattern[firstCard.offset:firstCard.offset+firstCard.size])) {
		return false
	}

	begin += firstCard.size

	if numCards == 1 {
		return begin == end
	}

	// Check anchored suffix card
	lastCard := wp.cards[numCards-1]
	if end-begin < lastCard.size {
		return false
	}

	suffixPattern := wp.pattern[lastCard.offset : lastCard.offset+lastCard.size]
	if string(data[end-lastCard.size:end]) != suffixPattern {
		return false
	}
	end -= lastCard.size

	// Check unanchored infix cards
	for i := 1; i < numCards-1; i++ {
		card := wp.cards[i]

		// Find the pattern in the remaining data
		idx := bytes.Index(data[begin:end], []byte(wp.pattern[card.offset:card.offset+card.size]))
		if idx == -1 {
			return false
		}
		begin += idx + card.size
	}

	return true
}
