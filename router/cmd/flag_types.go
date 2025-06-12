package cmd

import (
	"flag"
	"log"
	"strings"
)

// multipleString is a custom flag type that parses comma-separated values into a string slice
type multipleString []string

func newMultipleString(name, defaultValue, usage string) *multipleString {
	multipleStringEntry := &multipleString{}
	flag.Var(multipleStringEntry, name, usage)

	err := flag.Set(name, defaultValue)
	// This should be unreachable since we return nil from set
	// however if an error was to be added to Set this could be triggered
	if err != nil {
		log.Fatal(err)
	}

	return multipleStringEntry
}

// String returns the string representation of the slice
func (s *multipleString) String() string {
	return strings.Join(*s, ",")
}

// Set parses the comma-separated value into the slice
func (s *multipleString) Set(value string) error {
	if value == "" {
		*s = make(multipleString, 0)
		return nil
	}
	*s = append(*s, strings.Split(value, ",")...)
	return nil
}
