package app

import (
	"embed"
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"io/fs"
	"net/http"
	"slices"
	"sync"
	"time"

	"github.com/alnvdl/autosave"

	"github.com/alnvdl/littletable/internal/version"
)

//go:embed templates/*
var templateFS embed.FS

//go:embed static/*
var staticFS embed.FS

// db holds the persistent state.
type db struct {
	Cycles map[string][]string `json:"cycles"`
}

// Params configures the application.
type Params struct {
	Tokens         map[string]string
	AutoSaveParams autosave.Params
}

// App is the littletable application.
type App struct {
	tokens map[string]string

	mu sync.RWMutex
	db db

	autoSaver    *autosave.AutoSaver
	mux          *http.ServeMux
	indexTmpl    *template.Template
	manifestTmpl *template.Template
}

// New creates a new App instance.
func New(params Params) (*App, error) {
	a := &App{
		tokens: params.Tokens,
		db:     db{Cycles: make(map[string][]string)},
	}

	var err error
	a.indexTmpl, err = template.New("").ParseFS(templateFS, "templates/index.html")
	if err != nil {
		return nil, fmt.Errorf("parsing index template: %w", err)
	}
	a.manifestTmpl, err = template.New("").ParseFS(templateFS, "templates/manifest.json")
	if err != nil {
		return nil, fmt.Errorf("parsing manifest template: %w", err)
	}

	// Initialize auto-save.
	if params.AutoSaveParams.FilePath != "" {
		params.AutoSaveParams.LoaderSaver = a
		a.autoSaver, err = autosave.New(params.AutoSaveParams)
		if err != nil {
			return nil, fmt.Errorf("cannot initialize auto-saver: %v", err)
		}
	}

	// Routes.
	a.mux = http.NewServeMux()
	staticContent, _ := fs.Sub(staticFS, "static")
	staticHandler := http.StripPrefix("/static/", http.FileServerFS(staticContent))
	a.mux.HandleFunc("GET /static/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/static/sw.js" {
			w.Header().Set("Service-Worker-Allowed", "/")
		}
		w.Header().Set("Cache-Control", "max-age=604800, public")
		staticHandler.ServeHTTP(w, r)
	})
	a.mux.HandleFunc("GET /{$}", a.handleIndex)
	a.mux.HandleFunc("GET /cycles", a.handleCyclesGet)
	a.mux.HandleFunc("POST /start", a.handleStartPost)
	a.mux.HandleFunc("DELETE /start", a.handleStartDelete)
	a.mux.HandleFunc("GET /manifest.json", a.handleManifest)
	a.mux.HandleFunc("GET /status", a.handleStatus)

	return a, nil
}

// ServeHTTP delegates to the internal mux.
func (a *App) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	a.mux.ServeHTTP(w, r)
}

// Load reads the database from an io.Reader.
func (a *App) Load(r io.Reader) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	if err := json.NewDecoder(r).Decode(&a.db); err != nil {
		return fmt.Errorf("decoding database: %w", err)
	}
	if a.db.Cycles == nil {
		a.db.Cycles = make(map[string][]string)
	}
	return nil
}

// Save writes the database to an io.Writer.
func (a *App) Save(w io.Writer) error {
	a.mu.RLock()
	defer a.mu.RUnlock()

	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(a.db)
}

// Close shuts down the auto-saver.
func (a *App) Close() {
	if a.autoSaver != nil {
		a.autoSaver.Close()
	}
}

func (a *App) delayAutoSave() {
	if a.autoSaver != nil {
		a.autoSaver.Delay()
	}
}

// authenticate checks the token query parameter.
func (a *App) authenticate(r *http.Request) bool {
	token := r.URL.Query().Get("token")
	_, ok := a.tokens[token]
	return ok
}

// tokenFromRequest extracts the token from the request.
func tokenFromRequest(r *http.Request) string {
	return r.URL.Query().Get("token")
}

// getCycles returns the sorted list of cycle start dates for a token.
func (a *App) getCycles(token string) []string {
	a.mu.RLock()
	defer a.mu.RUnlock()

	dates := a.db.Cycles[token]
	if dates == nil {
		return []string{}
	}
	result := make([]string, len(dates))
	copy(result, dates)
	return result
}

// addStart adds a cycle start date for a token.
func (a *App) addStart(token string, date string) {
	a.mu.Lock()
	defer a.mu.Unlock()

	dates := a.db.Cycles[token]
	if slices.Contains(dates, date) {
		return
	}
	dates = append(dates, date)
	slices.Sort(dates)
	a.db.Cycles[token] = dates
	a.delayAutoSave()
}

// removeStart removes a cycle start date for a token.
func (a *App) removeStart(token string, date string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()

	dates := a.db.Cycles[token]
	for i, d := range dates {
		if d == date {
			a.db.Cycles[token] = append(dates[:i], dates[i+1:]...)
			a.delayAutoSave()
			return true
		}
	}
	return false
}

// handleIndex serves the SPA index page.
func (a *App) handleIndex(w http.ResponseWriter, r *http.Request) {
	if !a.authenticate(r) {
		jsonError(w, "Forbidden", http.StatusForbidden)
		return
	}

	token := tokenFromRequest(r)
	data := struct{ Token string }{Token: token}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := a.indexTmpl.ExecuteTemplate(w, "index.html", data); err != nil {
		jsonError(w, "Internal Server Error", http.StatusInternalServerError)
	}
}

// handleCyclesGet returns all cycle start dates for the authenticated user.
func (a *App) handleCyclesGet(w http.ResponseWriter, r *http.Request) {
	if !a.authenticate(r) {
		jsonError(w, "Forbidden", http.StatusForbidden)
		return
	}

	token := tokenFromRequest(r)
	dates := a.getCycles(token)

	resp := struct {
		Strategy string   `json:"strategy"`
		Dates    []string `json:"dates"`
	}{
		Strategy: a.tokens[token],
		Dates:    dates,
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(resp)
}

// handleStartPost adds a cycle start date.
func (a *App) handleStartPost(w http.ResponseWriter, r *http.Request) {
	if !a.authenticate(r) {
		jsonError(w, "Forbidden", http.StatusForbidden)
		return
	}

	var date string
	if err := json.NewDecoder(r.Body).Decode(&date); err != nil {
		jsonError(w, "Bad Request: invalid JSON", http.StatusBadRequest)
		return
	}

	if _, err := time.Parse(time.DateOnly, date); err != nil {
		jsonError(w, "Bad Request: date must be in YYYY-MM-DD format", http.StatusBadRequest)
		return
	}

	token := tokenFromRequest(r)
	a.addStart(token, date)
	w.WriteHeader(http.StatusNoContent)
}

// handleStartDelete removes a cycle start date.
func (a *App) handleStartDelete(w http.ResponseWriter, r *http.Request) {
	if !a.authenticate(r) {
		jsonError(w, "Forbidden", http.StatusForbidden)
		return
	}

	var date string
	if err := json.NewDecoder(r.Body).Decode(&date); err != nil {
		jsonError(w, "Bad Request: invalid JSON", http.StatusBadRequest)
		return
	}

	if _, err := time.Parse(time.DateOnly, date); err != nil {
		jsonError(w, "Bad Request: date must be in YYYY-MM-DD format", http.StatusBadRequest)
		return
	}

	token := tokenFromRequest(r)
	if !a.removeStart(token, date) {
		jsonError(w, "Not Found", http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleManifest serves the PWA manifest with the user's token.
func (a *App) handleManifest(w http.ResponseWriter, r *http.Request) {
	if !a.authenticate(r) {
		jsonError(w, "Forbidden", http.StatusForbidden)
		return
	}

	token := tokenFromRequest(r)
	data := struct{ Token string }{Token: token}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if err := a.manifestTmpl.ExecuteTemplate(w, "manifest.json", data); err != nil {
		jsonError(w, "Internal Server Error", http.StatusInternalServerError)
	}
}

// handleStatus returns the application version.
func (a *App) handleStatus(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(map[string]string{"version": version.Version()})
}

// jsonError writes a JSON error response.
func jsonError(w http.ResponseWriter, message string, code int) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"message": message})
}
