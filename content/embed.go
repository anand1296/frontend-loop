// Package content exposes the repository's Markdown question bank to Go.
//
// The same files feed the static build (Vite plugin) and the backend, which
// seeds its database from them on first start and can re-import them later
// from the admin console ("Sync from repository").
package content

import "embed"

// Files holds every round file (content/*.md) compiled into the binary.
//
//go:embed *.md
var Files embed.FS
