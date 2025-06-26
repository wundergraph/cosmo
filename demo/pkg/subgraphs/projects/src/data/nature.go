package data

import "time"

type NatureFact struct {
	ID   int    `json:"id"`
	Fact string `json:"fact"`
}

// NatureFactsResponse represents the response for nature facts
type NatureFactsResponse struct {
	Facts     []NatureFact `json:"facts"`
	Count     int          `json:"count"`
	Timestamp time.Time    `json:"timestamp"`
}
