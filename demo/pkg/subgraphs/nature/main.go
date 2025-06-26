package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gorilla/mux"
)

// Response represents a generic API response
type Response struct {
	Message   string    `json:"message"`
	Timestamp time.Time `json:"timestamp"`
}

// NatureFact represents a nature fact
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

// SingleFactResponse represents the response for a single fact
type SingleFactResponse struct {
	Fact      *NatureFact `json:"fact"`
	Timestamp time.Time   `json:"timestamp"`
}

func main() {
	// Create a new router
	r := mux.NewRouter()

	// Define routes
	r.HandleFunc("/health", healthCheckHandler).Methods("GET")
	r.HandleFunc("/facts", getNatureFactsHandler).Methods("GET")
	r.HandleFunc("/fact/{id}", getFactByIDHandler).Methods("GET")

	// Start the server
	fmt.Println("Starting Nature API server on :8091")
	log.Fatal(http.ListenAndServe(":8091", r))
}

// healthCheckHandler handles the health check endpoint
func healthCheckHandler(w http.ResponseWriter, r *http.Request) {
	response := Response{
		Message:   "Nature API is healthy and running!",
		Timestamp: time.Now(),
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(response)
}

// getNatureFactsHandler handles the nature facts endpoint
func getNatureFactsHandler(w http.ResponseWriter, r *http.Request) {
	facts := []NatureFact{
		{ID: 1, Fact: "Trees communicate with each other through underground fungal networks called mycorrhizae."},
		{ID: 2, Fact: "The Amazon Rainforest produces 20% of the world's oxygen."},
		{ID: 3, Fact: "A single oak tree can support over 500 different species of insects and animals."},
		{ID: 4, Fact: "Bamboo can grow up to 91 cm (35 inches) in a single day."},
		{ID: 5, Fact: "The Great Barrier Reef is the largest living structure on Earth, visible from space."},
	}

	response := NatureFactsResponse{
		Facts:     facts,
		Count:     len(facts),
		Timestamp: time.Now(),
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(response)
}

// getFactByIDHandler handles getting a specific fact by ID
func getFactByIDHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	idStr := vars["id"]

	id, err := strconv.Atoi(idStr)
	if err != nil {
		errorResponse := Response{
			Message:   "Invalid ID format. Please provide a valid number.",
			Timestamp: time.Now(),
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(errorResponse)
		return
	}

	// Get all facts
	facts := []NatureFact{
		{ID: 1, Fact: "Trees communicate with each other through underground fungal networks called mycorrhizae."},
		{ID: 2, Fact: "The Amazon Rainforest produces 20% of the world's oxygen."},
		{ID: 3, Fact: "A single oak tree can support over 500 different species of insects and animals."},
		{ID: 4, Fact: "Bamboo can grow up to 91 cm (35 inches) in a single day."},
		{ID: 5, Fact: "The Great Barrier Reef is the largest living structure on Earth, visible from space."},
	}

	// Find the fact with the specified ID
	var foundFact *NatureFact
	for _, fact := range facts {
		if fact.ID == id {
			foundFact = &fact
			break
		}
	}

	if foundFact == nil {
		errorResponse := Response{
			Message:   fmt.Sprintf("Fact with ID %d not found", id),
			Timestamp: time.Now(),
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(errorResponse)
		return
	}

	response := SingleFactResponse{
		Fact:      foundFact,
		Timestamp: time.Now(),
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(response)
}
