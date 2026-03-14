TOKENS = alice:avoid-pregnancy-zealous,bob:pregnancy
# TODO: generate cycle dates on the fly when starting.
CYCLE_DATES = '{ \
	"cycles": { \
		"alice": [ \
			"2024-03-12", \
			"2024-04-08", \
			"2024-05-03", \
			"2024-05-28", \
			"2024-06-25", \
			"2024-07-21", \
			"2024-08-15", \
			"2024-09-12", \
			"2024-10-06", \
			"2024-11-02", \
			"2024-11-30", \
			"2024-12-24", \
			"2025-01-20", \
			"2025-02-17", \
			"2025-03-14", \
			"2025-04-10", \
			"2025-05-08", \
			"2025-06-01", \
			"2025-06-27", \
			"2025-07-25", \
			"2025-08-19", \
			"2025-09-16", \
			"2025-10-14", \
			"2025-11-08", \
			"2025-12-05", \
			"2026-01-02", \
			"2026-01-29", \
			"2026-02-24" \
		] \
	} \
}'

.PHONY: dev test

dev:
	echo $(CYCLE_DATES) > /tmp/littletable_db.json && \
	TOKENS=$(TOKENS) \
	DB_PATH=/tmp/littletable_db.json \
	go run -buildvcs=true ./cmd/littletablesrv

test:
	go test ./... -count=1 -cover -coverprofile /tmp/cover.out
