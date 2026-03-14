package main

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	defaultDBPath          = "db.json"
	defaultPort            = 8080
	defaultPersistInterval = 5 * time.Minute
)

func DBPath() string {
	s := os.Getenv("DB_PATH")
	if s == "" {
		return defaultDBPath
	}
	return s
}

func PersistInterval() time.Duration {
	s := os.Getenv("PERSIST_INTERVAL")
	if d, err := time.ParseDuration(s); err == nil {
		return d
	}
	return defaultPersistInterval
}

func Port() (int, error) {
	s := os.Getenv("PORT")
	if s == "" {
		return defaultPort, nil
	}
	port, err := strconv.Atoi(s)
	if err != nil {
		return 0, fmt.Errorf("PORT is not a valid integer: %w", err)
	}
	if port < 1 || port > 65535 {
		return 0, fmt.Errorf("PORT must be between 1 and 65535")
	}
	return port, nil
}

// validStrategies lists the allowed strategy values.
var validStrategies = []string{
	"pregnancy",
	"avoid-pregnancy",
	"avoid-pregnancy-zealous",
}

func Tokens() (map[string]string, error) {
	s := os.Getenv("TOKENS")
	if s == "" {
		return nil, fmt.Errorf("TOKENS is not set")
	}
	parts := strings.Split(s, ",")
	if len(parts) == 0 {
		return nil, fmt.Errorf("TOKENS must contain at least one token")
	}
	tokens := make(map[string]string, len(parts))
	for _, p := range parts {
		kv := strings.SplitN(p, ":", 2)
		if len(kv) != 2 || kv[0] == "" || kv[1] == "" {
			return nil, fmt.Errorf("TOKENS entry %q must be in token:strategy format", p)
		}
		validStrategy := false
		for _, vs := range validStrategies {
			if kv[1] == vs {
				validStrategy = true
				break
			}
		}
		if !validStrategy {
			return nil, fmt.Errorf("TOKENS entry %q has invalid strategy %q; valid strategies: %v", p, kv[1], validStrategies)
		}
		tokens[kv[0]] = kv[1]
	}
	return tokens, nil
}
