package app

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLogPanics(t *testing.T) {
	var logBuf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logBuf, nil))
	previousLogger := slog.Default()
	slog.SetDefault(logger)
	t.Cleanup(func() {
		slog.SetDefault(previousLogger)
	})

	handler := logPanics(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("boom")
	}))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/cycles", nil)
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("got status %d, want %d", rec.Code, http.StatusInternalServerError)
	}
	if !strings.Contains(rec.Body.String(), "Internal Server Error") {
		t.Fatalf("response body does not contain expected message: %q", rec.Body.String())
	}
	if !strings.Contains(logBuf.String(), "panic in handler") {
		t.Fatalf("panic log entry not found: %q", logBuf.String())
	}
}

func TestLogRequests(t *testing.T) {
	var logBuf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logBuf, nil))
	previousLogger := slog.Default()
	slog.SetDefault(logger)
	t.Cleanup(func() {
		slog.SetDefault(previousLogger)
	})

	handler := logRequests(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusCreated)
	}))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/start?token=tok1", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	req.Header.Set("User-Agent", "littletable-test")
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("got status %d, want %d", rec.Code, http.StatusCreated)
	}

	logs := logBuf.String()
	if !strings.Contains(logs, "msg=request") {
		t.Fatalf("request log entry not found: %q", logs)
	}
	if !strings.Contains(logs, "msg=response") {
		t.Fatalf("response log entry not found: %q", logs)
	}
	if !strings.Contains(logs, "method=POST") {
		t.Fatalf("method field missing from logs: %q", logs)
	}
	if !strings.Contains(logs, "path=/start") {
		t.Fatalf("path field missing or includes unexpected query values: %q", logs)
	}
	if !strings.Contains(logs, "remote_addr=127.0.0.1:1234") {
		t.Fatalf("remote_addr field missing from logs: %q", logs)
	}
	if !strings.Contains(logs, "user_agent=littletable-test") {
		t.Fatalf("user_agent field missing from logs: %q", logs)
	}
	if !strings.Contains(logs, "status=201") {
		t.Fatalf("status field missing from logs: %q", logs)
	}
}
