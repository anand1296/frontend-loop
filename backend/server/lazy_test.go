package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestVercelEntryWithoutDatabase(t *testing.T) {
	h := Vercel(Config{})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/index?__route=bootstrap", nil))
	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "not_configured") {
		t.Fatalf("got %d %s", rec.Code, rec.Body.String())
	}
}

func TestVercelRestoresOriginalPath(t *testing.T) {
	cases := map[string]string{
		"/api/index?__route=content/sections/js&x=1": "/api/content/sections/js?x=1",
		"/api?__route=bootstrap":                     "/api/bootstrap",
		"/api/bootstrap":                             "/api/bootstrap",
	}
	for in, want := range cases {
		var got string
		h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			got = r.URL.Path
			if r.URL.RawQuery != "" {
				got += "?" + r.URL.RawQuery
			}
		})
		rewrite(h).ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", in, nil))
		if got != want {
			t.Errorf("%s: got %s, want %s", in, got, want)
		}
	}
}
