package app

import (
	"fmt"
	"log/slog"
	"net/http"
	"runtime/debug"
)

// loggingResponseWriter wraps http.ResponseWriter and tracks the status code
// written by handlers for response logs.
type loggingResponseWriter struct {
	http.ResponseWriter
	status int
}

func (w *loggingResponseWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

// logRequests logs each request before it is processed and each response after
// it completes.
func logRequests(handler http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		slog.Info("request",
			slog.String("method", r.Method),
			slog.String("path", r.URL.Path),
			slog.String("remote_addr", r.RemoteAddr),
			slog.String("user_agent", r.UserAgent()),
		)

		lw := &loggingResponseWriter{ResponseWriter: w, status: http.StatusOK}
		handler.ServeHTTP(lw, r)

		slog.Info("response",
			slog.String("method", r.Method),
			slog.String("path", r.URL.Path),
			slog.String("remote_addr", r.RemoteAddr),
			slog.String("user_agent", r.UserAgent()),
			slog.String("status", fmt.Sprintf("%d", lw.status)),
		)
	})
}

// logPanics recovers from panics in handlers, logs panic details and stack
// trace, and writes a generic 500 response.
func logPanics(handler http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if p := recover(); p != nil {
				slog.Error("panic in handler",
					slog.Any("panic", p),
					slog.String("stack", string(debug.Stack())),
				)
				jsonError(w, "Internal Server Error", http.StatusInternalServerError)
			}
		}()
		handler.ServeHTTP(w, r)
	})
}
