package main

import (
	"testing"
	"time"
)

var testCycleStart = time.Date(2026, time.August, 8, 0, 0, 0, 0, time.UTC)

func TestParseVnStatMonthlyJSONSelectsCurrentCycle(t *testing.T) {
	data := []byte(`{
		"interfaces": [{
			"name": "eth0",
			"traffic": {"month": [
				{"date": {"year": 2026, "month": 7}, "rx": 100, "tx": 200},
				{"date": {"year": 2026, "month": 8}, "rx": 300, "tx": 400}
			]}
		}]
	}`)

	rx, tx, ok := parseVnStatMonthlyJSON(data, "", testCycleStart)
	if !ok || rx != 300 || tx != 400 {
		t.Fatalf("got rx=%d tx=%d ok=%v, want rx=300 tx=400 ok=true", rx, tx, ok)
	}
}

func TestParseVnStatMonthlyJSONUsesRequestedInterface(t *testing.T) {
	data := []byte(`{
		"interfaces": [
			{"name": "eth0", "traffic": {"month": [{"date": {"year": 2026, "month": 8}, "rx": 10, "tx": 20}]}},
			{"name": "ens3", "traffic": {"month": [{"date": {"year": 2026, "month": 8}, "rx": 30, "tx": 40}]}}
		]
	}`)

	rx, tx, ok := parseVnStatMonthlyJSON(data, "ens3", testCycleStart)
	if !ok || rx != 30 || tx != 40 {
		t.Fatalf("got rx=%d tx=%d ok=%v, want rx=30 tx=40 ok=true", rx, tx, ok)
	}
	if _, _, ok := parseVnStatMonthlyJSON(data, "missing0", testCycleStart); ok {
		t.Fatal("missing interface unexpectedly returned data")
	}
}

func TestParseVnStatMonthlyJSONSupportsV1Format(t *testing.T) {
	data := []byte(`{
		"interfaces": [{
			"id": "eth0",
			"traffic": {"months": [{"date": {"year": 2026, "month": 8}, "rx": 50, "tx": 60}]}
		}]
	}`)

	rx, tx, ok := parseVnStatMonthlyJSON(data, "eth0", testCycleStart)
	if !ok || rx != 50*1024 || tx != 60*1024 {
		t.Fatalf("got rx=%d tx=%d ok=%v, want rx=51200 tx=61440 ok=true", rx, tx, ok)
	}
}

func TestParseVnStatMonthlyJSONRejectsUnavailableCycle(t *testing.T) {
	for _, data := range []string{
		`not json`,
		`{"interfaces":[]}`,
		`{"interfaces":[{"name":"eth0","traffic":{"month":[]}}]}`,
		`{"interfaces":[{"name":"eth0","traffic":{"month":[{"date":{"year":2026,"month":7},"rx":900,"tx":800}]}}]}`,
		`{"interfaces":[{"id":"eth0","traffic":{"months":[{"date":{"year":2026,"month":8},"rx":18446744073709551615,"tx":0}]}}]}`,
	} {
		if _, _, ok := parseVnStatMonthlyJSON([]byte(data), "eth0", testCycleStart); ok {
			t.Fatalf("invalid/stale data accepted: %s", data)
		}
	}
}

func TestParseVnStatMonthlyJSONBeforeResetUsesPreviousMonth(t *testing.T) {
	start, _ := trafficCycleBounds(time.Date(2026, time.September, 7, 23, 59, 0, 0, time.UTC), 8)
	data := []byte(`{"interfaces":[{"name":"eth0","traffic":{"month":[{"date":{"year":2026,"month":8},"rx":500,"tx":100},{"date":{"year":2026,"month":9},"rx":0,"tx":0}]}}]}`)
	rx, tx, ok := parseVnStatMonthlyJSON(data, "eth0", start)
	if !ok || rx != 500 || tx != 100 {
		t.Fatalf("wrong billing cycle: rx=%d tx=%d ok=%v", rx, tx, ok)
	}
}

func TestTrafficCycleBounds(t *testing.T) {
	location := time.FixedZone("UTC+8", 8*60*60)
	tests := []struct {
		name      string
		now       time.Time
		resetDay  int
		wantStart string
		wantEnd   string
	}{
		{
			name:      "after reset day",
			now:       time.Date(2026, time.August, 12, 9, 30, 0, 0, location),
			resetDay:  8,
			wantStart: "2026-08-08",
			wantEnd:   "2026-09-08",
		},
		{
			name:      "before reset day",
			now:       time.Date(2026, time.August, 3, 9, 30, 0, 0, location),
			resetDay:  8,
			wantStart: "2026-07-08",
			wantEnd:   "2026-08-08",
		},
		{
			name:      "invalid day defaults to first",
			now:       time.Date(2026, time.August, 3, 9, 30, 0, 0, location),
			resetDay:  31,
			wantStart: "2026-08-01",
			wantEnd:   "2026-09-01",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			start, end := trafficCycleBounds(test.now, test.resetDay)
			if got := start.Format("2006-01-02"); got != test.wantStart {
				t.Fatalf("start=%s, want %s", got, test.wantStart)
			}
			if got := end.Format("2006-01-02"); got != test.wantEnd {
				t.Fatalf("end=%s, want %s", got, test.wantEnd)
			}
		})
	}
}
