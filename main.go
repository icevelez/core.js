package main

import (
	"fmt"
	"log"
	"net/http"

	"github.com/CAFxX/httpcompression"
)

func main() {

	use_https := true
	host := "localhost"
	port := 3000

	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.Dir(".")))

	var err error

	compress, err := httpcompression.DefaultAdapter()
	if err != nil {
		log.Fatal(err)
	}

	if use_https {
		fmt.Printf("Web server listening on https://%s:%d/\n", host, port)
		err = http.ListenAndServeTLS(fmt.Sprintf("%s:%d", host, port), "ssl/default.cert", "ssl/default.key", compress(mux))
	} else {
		fmt.Printf("Web server listening on http://%s:%d/\n", host, port)
		err = http.ListenAndServe(fmt.Sprintf("%s:%d", host, port), mux)
	}

	if err != nil {
		log.Fatal(err)
	}
}
