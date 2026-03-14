package app_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/alnvdl/littletable/internal/app"
)

func testTokens() map[string]string {
	return map[string]string{"tok1": "avoid-pregnancy", "tok2": "pregnancy"}
}

func newTestApp(t *testing.T) *app.App {
	t.Helper()
	a, err := app.New(app.Params{
		Tokens: testTokens(),
	})
	if err != nil {
		t.Fatal(err)
	}
	return a
}

func TestNew(t *testing.T) {
	var tests = []struct {
		desc    string
		tokens  map[string]string
		wantErr string
	}{{
		desc:   "valid tokens",
		tokens: map[string]string{"tok": "pregnancy"},
	}, {
		desc:   "nil tokens",
		tokens: nil,
	}}

	for _, test := range tests {
		t.Run(test.desc, func(t *testing.T) {
			_, err := app.New(app.Params{
				Tokens: test.tokens,
			})
			if test.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), test.wantErr) {
					t.Errorf("got err %v, want %q", err, test.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

func TestLoadSave(t *testing.T) {
	a := newTestApp(t)

	// Load some data.
	input := `{"cycles":{"tok1":["2026-01-01","2026-01-28"],"tok2":["2026-02-15"]}}`
	if err := a.Load(strings.NewReader(input)); err != nil {
		t.Fatalf("Load failed: %v", err)
	}

	// Save and verify round-trip.
	var buf bytes.Buffer
	if err := a.Save(&buf); err != nil {
		t.Fatalf("Save failed: %v", err)
	}

	var saved struct {
		Cycles map[string][]string `json:"cycles"`
	}
	if err := json.Unmarshal(buf.Bytes(), &saved); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}

	if len(saved.Cycles["tok1"]) != 2 {
		t.Errorf("got %d dates for tok1, want 2", len(saved.Cycles["tok1"]))
	}
	if len(saved.Cycles["tok2"]) != 1 {
		t.Errorf("got %d dates for tok2, want 1", len(saved.Cycles["tok2"]))
	}
}

func TestLoadInvalid(t *testing.T) {
	a := newTestApp(t)
	err := a.Load(strings.NewReader("not json"))
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestHandleIndex(t *testing.T) {
	a := newTestApp(t)

	var tests = []struct {
		desc   string
		token  string
		status int
	}{{
		desc:   "valid token",
		token:  "tok1",
		status: http.StatusOK,
	}, {
		desc:   "invalid token",
		token:  "bad",
		status: http.StatusForbidden,
	}, {
		desc:   "no token",
		token:  "",
		status: http.StatusForbidden,
	}}

	for _, test := range tests {
		t.Run(test.desc, func(t *testing.T) {
			url := "/"
			if test.token != "" {
				url += "?token=" + test.token
			}
			req := httptest.NewRequest("GET", url, nil)
			rec := httptest.NewRecorder()
			a.ServeHTTP(rec, req)
			if rec.Code != test.status {
				t.Errorf("got status %d, want %d", rec.Code, test.status)
			}
			if test.status == http.StatusOK {
				body := rec.Body.String()
				if !strings.Contains(body, "manifest.json?token="+test.token) {
					t.Error("response does not contain manifest link with token")
				}
			}
		})
	}
}

func TestHandleCyclesGet(t *testing.T) {
	a := newTestApp(t)

	// Seed data.
	input := `{"cycles":{"tok1":["2026-01-01","2026-01-28"]}}`
	if err := a.Load(strings.NewReader(input)); err != nil {
		t.Fatal(err)
	}

	var tests = []struct {
		desc         string
		token        string
		status       int
		want         []string
		wantStrategy string
	}{{
		desc:         "valid token with data",
		token:        "tok1",
		status:       http.StatusOK,
		want:         []string{"2026-01-01", "2026-01-28"},
		wantStrategy: "avoid-pregnancy",
	}, {
		desc:         "valid token without data",
		token:        "tok2",
		status:       http.StatusOK,
		want:         []string{},
		wantStrategy: "pregnancy",
	}, {
		desc:   "invalid token",
		token:  "bad",
		status: http.StatusForbidden,
	}}

	for _, test := range tests {
		t.Run(test.desc, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/cycles?token="+test.token, nil)
			rec := httptest.NewRecorder()
			a.ServeHTTP(rec, req)
			if rec.Code != test.status {
				t.Errorf("got status %d, want %d", rec.Code, test.status)
			}
			if test.status == http.StatusOK {
				var got struct {
					Strategy string   `json:"strategy"`
					Dates    []string `json:"dates"`
				}
				if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
					t.Fatalf("failed to unmarshal response: %v", err)
				}
				if got.Strategy != test.wantStrategy {
					t.Errorf("got strategy %q, want %q", got.Strategy, test.wantStrategy)
				}
				if len(got.Dates) != len(test.want) {
					t.Fatalf("got %d dates, want %d", len(got.Dates), len(test.want))
				}
				for i, d := range got.Dates {
					if d != test.want[i] {
						t.Errorf("date[%d]: got %q, want %q", i, d, test.want[i])
					}
				}
			}
		})
	}
}

func TestHandleStartPost(t *testing.T) {
	a := newTestApp(t)

	var tests = []struct {
		desc   string
		token  string
		body   string
		status int
	}{{
		desc:   "valid date",
		token:  "tok1",
		body:   `"2026-03-08"`,
		status: http.StatusNoContent,
	}, {
		desc:   "invalid token",
		token:  "bad",
		body:   `"2026-03-08"`,
		status: http.StatusForbidden,
	}, {
		desc:   "invalid JSON",
		token:  "tok1",
		body:   `not json`,
		status: http.StatusBadRequest,
	}, {
		desc:   "invalid date format",
		token:  "tok1",
		body:   `"03-08-2026"`,
		status: http.StatusBadRequest,
	}, {
		desc:   "date with extra content",
		token:  "tok1",
		body:   `"2026-03-08T00:00:00"`,
		status: http.StatusBadRequest,
	}}

	for _, test := range tests {
		t.Run(test.desc, func(t *testing.T) {
			req := httptest.NewRequest("POST", "/start?token="+test.token,
				strings.NewReader(test.body))
			rec := httptest.NewRecorder()
			a.ServeHTTP(rec, req)
			if rec.Code != test.status {
				t.Errorf("got status %d, want %d: %s", rec.Code, test.status, rec.Body.String())
			}
		})
	}

	// Verify the date was actually stored.
	req := httptest.NewRequest("GET", "/cycles?token=tok1", nil)
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)
	var resp struct {
		Dates []string `json:"dates"`
	}
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp.Dates) != 1 || resp.Dates[0] != "2026-03-08" {
		t.Errorf("expected [2026-03-08], got %v", resp.Dates)
	}
}

func TestHandleStartPostDuplicate(t *testing.T) {
	a := newTestApp(t)

	// Add same date twice.
	for i := 0; i < 2; i++ {
		req := httptest.NewRequest("POST", "/start?token=tok1",
			strings.NewReader(`"2026-03-08"`))
		rec := httptest.NewRecorder()
		a.ServeHTTP(rec, req)
		if rec.Code != http.StatusNoContent {
			t.Fatalf("attempt %d: got status %d", i+1, rec.Code)
		}
	}

	// Verify only one entry.
	req := httptest.NewRequest("GET", "/cycles?token=tok1", nil)
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)
	var resp struct {
		Dates []string `json:"dates"`
	}
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp.Dates) != 1 {
		t.Errorf("expected 1 date, got %d: %v", len(resp.Dates), resp.Dates)
	}
}

func TestHandleStartPostSorting(t *testing.T) {
	a := newTestApp(t)

	// Add dates out of order.
	for _, d := range []string{"2026-03-15", "2026-01-01", "2026-02-10"} {
		req := httptest.NewRequest("POST", "/start?token=tok1",
			strings.NewReader(`"`+d+`"`))
		rec := httptest.NewRecorder()
		a.ServeHTTP(rec, req)
		if rec.Code != http.StatusNoContent {
			t.Fatalf("got status %d for %s", rec.Code, d)
		}
	}

	// Verify sorted order.
	req := httptest.NewRequest("GET", "/cycles?token=tok1", nil)
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)
	var resp struct {
		Dates []string `json:"dates"`
	}
	json.Unmarshal(rec.Body.Bytes(), &resp)
	want := []string{"2026-01-01", "2026-02-10", "2026-03-15"}
	if len(resp.Dates) != len(want) {
		t.Fatalf("got %d dates, want %d", len(resp.Dates), len(want))
	}
	for i, d := range resp.Dates {
		if d != want[i] {
			t.Errorf("date[%d]: got %q, want %q", i, d, want[i])
		}
	}
}

func TestHandleStartDelete(t *testing.T) {
	a := newTestApp(t)

	// Seed data.
	input := `{"cycles":{"tok1":["2026-01-01","2026-01-28","2026-02-25"]}}`
	if err := a.Load(strings.NewReader(input)); err != nil {
		t.Fatal(err)
	}

	var tests = []struct {
		desc   string
		token  string
		body   string
		status int
	}{{
		desc:   "delete existing date",
		token:  "tok1",
		body:   `"2026-01-28"`,
		status: http.StatusNoContent,
	}, {
		desc:   "delete non-existing date",
		token:  "tok1",
		body:   `"2026-06-15"`,
		status: http.StatusNotFound,
	}, {
		desc:   "invalid token",
		token:  "bad",
		body:   `"2026-01-01"`,
		status: http.StatusForbidden,
	}, {
		desc:   "invalid JSON",
		token:  "tok1",
		body:   `not json`,
		status: http.StatusBadRequest,
	}, {
		desc:   "invalid date format",
		token:  "tok1",
		body:   `"bad-date"`,
		status: http.StatusBadRequest,
	}}

	for _, test := range tests {
		t.Run(test.desc, func(t *testing.T) {
			req := httptest.NewRequest("DELETE", "/start?token="+test.token,
				strings.NewReader(test.body))
			rec := httptest.NewRecorder()
			a.ServeHTTP(rec, req)
			if rec.Code != test.status {
				t.Errorf("got status %d, want %d: %s", rec.Code, test.status, rec.Body.String())
			}
		})
	}

	// Verify remaining dates.
	req := httptest.NewRequest("GET", "/cycles?token=tok1", nil)
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)
	var resp struct {
		Dates []string `json:"dates"`
	}
	json.Unmarshal(rec.Body.Bytes(), &resp)
	want := []string{"2026-01-01", "2026-02-25"}
	if len(resp.Dates) != len(want) {
		t.Fatalf("got %d dates, want %d: %v", len(resp.Dates), len(want), resp.Dates)
	}
	for i, d := range resp.Dates {
		if d != want[i] {
			t.Errorf("date[%d]: got %q, want %q", i, d, want[i])
		}
	}
}

func TestHandleManifest(t *testing.T) {
	a := newTestApp(t)

	var tests = []struct {
		desc   string
		token  string
		status int
	}{{
		desc:   "valid token",
		token:  "tok1",
		status: http.StatusOK,
	}, {
		desc:   "invalid token",
		token:  "bad",
		status: http.StatusForbidden,
	}}

	for _, test := range tests {
		t.Run(test.desc, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/manifest.json?token="+test.token, nil)
			rec := httptest.NewRecorder()
			a.ServeHTTP(rec, req)
			if rec.Code != test.status {
				t.Errorf("got status %d, want %d", rec.Code, test.status)
			}
			if test.status == http.StatusOK {
				body := rec.Body.String()
				if !strings.Contains(body, test.token) {
					t.Error("manifest does not contain token")
				}
				if !strings.Contains(body, "Littletable") {
					t.Error("manifest does not contain app name")
				}
			}
		})
	}
}

func TestHandleStatus(t *testing.T) {
	a := newTestApp(t)
	req := httptest.NewRequest("GET", "/status", nil)
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("got status %d, want %d", rec.Code, http.StatusOK)
	}
}

func TestStaticFiles(t *testing.T) {
	a := newTestApp(t)

	// Static files should be accessible without token.
	req := httptest.NewRequest("GET", "/static/littletable.css", nil)
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("got status %d, want %d", rec.Code, http.StatusOK)
	}
	if !strings.Contains(rec.Header().Get("Cache-Control"), "max-age=604800") {
		t.Error("missing cache header")
	}
}

func TestCycleDataIsolation(t *testing.T) {
	a := newTestApp(t)

	// Add data for tok1.
	req := httptest.NewRequest("POST", "/start?token=tok1",
		strings.NewReader(`"2026-03-01"`))
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("got status %d", rec.Code)
	}

	// Verify tok2 has no data.
	req = httptest.NewRequest("GET", "/cycles?token=tok2", nil)
	rec = httptest.NewRecorder()
	a.ServeHTTP(rec, req)
	var resp struct {
		Dates []string `json:"dates"`
	}
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp.Dates) != 0 {
		t.Errorf("tok2 should have no data, got %v", resp.Dates)
	}
}
