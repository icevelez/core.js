package main

import (
	"fmt"
	"log"
	"net/http"
)

func main() {

	host := "localhost"
	port := 3000

	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.Dir(".")))

	err := http.ListenAndServe(fmt.Sprintf("%s:%d", host, port), mux)
	if err != nil {
		log.Fatal(err)
	}
}
