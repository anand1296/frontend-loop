// Package handler is the Vercel serverless entry point: Vercel's Go runtime
// calls Handler for every request routed to /api/* (see vercel.json).
// Keep this directory to this single file: Vercel turns every .go file in
// api/ into its own function.
package handler

import (
	"net/http"

	"github.com/anand1296/frontend-loop/backend/server"
)

var app = server.Vercel(server.ConfigFromEnv())

// Handler serves the whole API.
func Handler(w http.ResponseWriter, r *http.Request) { app.ServeHTTP(w, r) }
