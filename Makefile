SHELL := /bin/bash

TOKENS = alice:avoid-pregnancy-zealous,bob:pregnancy

.PHONY: dev test

dev:
	d=$$(date -d '-14 days' +%s); \
	dates=""; \
	for i in $$(seq 1 28); do \
		dates="$$(date -d @$$d +%Y-%m-%d) $$dates"; \
		offset=$$(( (RANDOM % 10) + 21 )); \
		d=$$(( d - offset * 86400 )); \
	done; \
	json='{ "cycles": { "alice": ['; \
	first=1; \
	for dt in $$dates; do \
		if [ "$$first" -eq 1 ]; then first=0; else json="$$json,"; fi; \
		json="$$json \"$$dt\""; \
	done; \
	json="$$json ] } }"; \
	echo "$$json" > db.json && \
	TOKENS=$(TOKENS) \
	go run -buildvcs=true ./cmd/littletablesrv

test:
	go test ./... -count=1 -cover -coverprofile /tmp/cover.out
