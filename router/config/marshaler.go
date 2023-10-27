package config

import (
	b64 "encoding/base64"
	"fmt"
	"github.com/dustin/go-humanize"
	"regexp"
	"strings"
)

type Base64Decoder []byte

func (ipd *Base64Decoder) Decode(value string) error {
	decoded, err := b64.StdEncoding.DecodeString(value)
	if err != nil {
		return fmt.Errorf("could not decode base64 string: %w", err)
	}

	*ipd = decoded

	return nil
}

type RegExArray []*regexp.Regexp

func (b *RegExArray) Decode(value string) error {

	// Reset the array to not merge environment variables
	*b = nil

	regStrings := strings.Split(value, ",")

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
	return b.Decode(strings.Join(s, ","))
}

type BytesString uint64

func (b *BytesString) Decode(value string) error {
	decoded, err := humanize.ParseBytes(value)
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
	return b.Decode(s)
}
