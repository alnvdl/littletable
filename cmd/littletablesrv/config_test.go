package main

import (
	"strings"
	"testing"
)

func TestTokens(t *testing.T) {
	var tests = []struct {
		desc    string
		env     string
		want    map[string]string
		wantErr string
	}{{
		desc:    "not set",
		env:     "",
		wantErr: "TOKENS is not set",
	}, {
		desc: "single token",
		env:  "tok1:pregnancy",
		want: map[string]string{"tok1": "pregnancy"},
	}, {
		desc: "multiple tokens",
		env:  "tok1:avoid-pregnancy,tok2:avoid-pregnancy-zealous",
		want: map[string]string{
			"tok1": "avoid-pregnancy",
			"tok2": "avoid-pregnancy-zealous",
		},
	}, {
		desc:    "missing strategy",
		env:     "tok1",
		wantErr: "must be in token:strategy format",
	}, {
		desc:    "empty token",
		env:     ":pregnancy",
		wantErr: "must be in token:strategy format",
	}, {
		desc:    "empty strategy",
		env:     "tok1:",
		wantErr: "must be in token:strategy format",
	}, {
		desc:    "invalid strategy",
		env:     "tok1:bad-strategy",
		wantErr: "invalid strategy",
	}}

	for _, test := range tests {
		t.Run(test.desc, func(t *testing.T) {
			if test.env != "" {
				t.Setenv("TOKENS", test.env)
			}
			got, err := Tokens()
			if test.wantErr != "" {
				if err == nil {
					t.Fatalf("expected error containing %q, got nil", test.wantErr)
				}
				if !strings.Contains(err.Error(), test.wantErr) {
					t.Errorf("got error %q, want it to contain %q", err, test.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(got) != len(test.want) {
				t.Fatalf("got %d tokens, want %d", len(got), len(test.want))
			}
			for k, v := range test.want {
				if got[k] != v {
					t.Errorf("token %q: got strategy %q, want %q", k, got[k], v)
				}
			}
		})
	}
}
