package config

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/dustin/go-humanize"
)

type RegExArray []*regexp.Regexp

func (b *RegExArray) UnmarshalText(value []byte) error {

	// Reset the array to not merge environment variables
	*b = nil

	if len(value) == 0 {
		return nil
	}

	text := string(value)

	regStrings := strings.Split(text, ",")

	for _, regString := range regStrings {
		reg, err := regexp.Compile(regString)
		if err != nil {
			return fmt.Errorf("could not compile regex string: %w", err)
		}
		*b = append(*b, reg)
	}

	return nil
}

func (b *RegExArray) UnmarshalYAML(unmarshal func(interface{}) error) error {
	var s []string
	if err := unmarshal(&s); err != nil {
		return err
	}
	return b.UnmarshalText([]byte(strings.Join(s, ",")))
}

func (b RegExArray) MarshalYAML() (interface{}, error) {
	var s []string
	for _, reg := range b {
		s = append(s, reg.String())
	}
	return s, nil

}

type BytesString uint64

func (b BytesString) Uint64() uint64 {
	return uint64(b)
}

func (b *BytesString) UnmarshalText(value []byte) error {
	decoded, err := humanize.ParseBytes(string(value))
	if err != nil {
		return fmt.Errorf("could not parse bytes string: %w", err)
	}

	*b = BytesString(decoded)

	return nil
}

func (b *BytesString) UnmarshalYAML(unmarshal func(interface{}) error) error {
	var s string
	if err := unmarshal(&s); err != nil {
		return err
	}
	return b.UnmarshalText([]byte(s))
}

func (b BytesString) MarshalYAML() (interface{}, error) {
	return humanize.Bytes(uint64(b)), nil
}
