package main

import (
	"encoding/json"
	"net/http"
)

func hello(w http.ResponseWriter, r *http.Request) {
	what := r.URL.Path[len("/hello/"):]
	encoded, err := json.Marshal(map[string]interface{}{"what": what})
	if err != nil {
		panic(err)
	}
	w.Write(encoded)
}

func main() {
	http.HandleFunc("/hello/", hello)
	http.ListenAndServe(":8080", nil)
}
