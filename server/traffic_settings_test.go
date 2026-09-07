package main

import (
	"errors"
	"testing"
)

func TestTrafficCalibrationLifecycle(t *testing.T) {
	s := newTestStore(t)
	m := SystemMetric{ID: "traffic", Name: "VM", TrafficSource: "vnstat", TrafficCycleStart: "2026-08-18", TrafficCycleEnd: "2026-09-18", TrafficResetDay: 18, MonthlyNetInBytes: 40, MonthlyNetOutBytes: 60}
	if err := s.Upsert(m); err != nil {
		t.Fatal(err)
	}
	stale := m
	m.MonthlyNetOutBytes = 80
	if err := s.UpsertFromAgent(m); err != nil {
		t.Fatal(err)
	}
	mode, used := "out", uint64(854710000000)
	saved, err := s.SaveAdminTraffic(stale, &mode, &used, false)
	if err != nil {
		t.Fatal(err)
	}
	if saved.TrafficCalibration.BaseOut != 80 || saved.MonthlyNetOutBytes != 80 || saved.TrafficCalibration.UsedBytes != used {
		t.Fatalf("not calibrated atomically: %+v", saved)
	}
	if err := s.patchMetric(m.ID, func(current *SystemMetric) { current.Alert = true }); err != nil {
		t.Fatal(err)
	}
	patched, _ := s.Get(m.ID)
	if patched.TrafficCalibration == nil || patched.TrafficCalibration.UsedBytes != used {
		t.Fatal("background metadata erased calibration")
	}
	// An agent must not modify admin settings; a normal push keeps the reference.
	m.MonthlyNetOutBytes = 90
	m.TrafficBillingMode = "in"
	if err := s.UpsertFromAgent(m); err != nil {
		t.Fatal(err)
	}
	got, _ := s.Get(m.ID)
	if got.TrafficBillingMode != "out" || got.TrafficCalibration == nil || !trafficCalibrationMatches(*got) {
		t.Fatalf("agent overwrote calibration: %+v", got)
	}
	// Unrelated edits retain calibration; switching billing clears it.
	saved, err = s.SaveAdminTraffic(stale, nil, nil, false)
	if err != nil || saved.TrafficCalibration == nil {
		t.Fatal("unrelated edit cleared calibration", err)
	}
	mode = "in"
	saved, err = s.SaveAdminTraffic(saved, &mode, nil, false)
	if err != nil || saved.TrafficCalibration != nil {
		t.Fatal("mode switch retained old calibration", err)
	}
	// Explicit zero is a valid calibration and is distinct from not supplied.
	used = 0
	saved, err = s.SaveAdminTraffic(saved, nil, &used, false)
	if err != nil || saved.TrafficCalibration == nil {
		t.Fatal("zero calibration rejected", err)
	}
	// A new cycle expires it permanently, even if an old snapshot later returns.
	m.TrafficCycleStart, m.TrafficCycleEnd = "2026-09-18", "2026-10-18"
	m.MonthlyNetInBytes, m.MonthlyNetOutBytes = 2, 3
	if err := s.UpsertFromAgent(m); err != nil {
		t.Fatal(err)
	}
	got, _ = s.Get(m.ID)
	if got.TrafficCalibration != nil {
		t.Fatal("calibration leaked into new cycle")
	}
}

func TestTrafficCalibrationValidationAndClear(t *testing.T) {
	s := newTestStore(t)
	m := SystemMetric{ID: "vm", TrafficSource: "interface"}
	if err := s.Upsert(m); err != nil {
		t.Fatal(err)
	}
	used := uint64(100)
	if _, err := s.SaveAdminTraffic(m, nil, &used, false); !errors.Is(err, errTrafficSettings) {
		t.Fatal("accepted unavailable monthly counters", err)
	}
	mode := "invalid"
	if _, err := s.SaveAdminTraffic(m, &mode, nil, false); !errors.Is(err, errTrafficSettings) {
		t.Fatal("accepted invalid mode", err)
	}
	m.TrafficSource, m.TrafficCycleStart, m.TrafficCycleEnd = "vnstat", "2026-08-18", "2026-09-18"
	m.TrafficResetDay, m.MonthlyNetInBytes, m.MonthlyNetOutBytes = 18, 10, 20
	if err := s.UpsertFromAgent(m); err != nil {
		t.Fatal(err)
	}
	saved, err := s.SaveAdminTraffic(m, nil, &used, false)
	if err != nil {
		t.Fatal(err)
	}
	saved, err = s.SaveAdminTraffic(saved, nil, nil, true)
	if err != nil || saved.TrafficCalibration != nil {
		t.Fatal("clear failed", err)
	}
	saved, err = s.SaveAdminTraffic(saved, nil, &used, false)
	if err != nil {
		t.Fatal(err)
	}
	m.MonthlyNetInBytes = 0
	if err := s.UpsertFromAgent(m); err != nil {
		t.Fatal(err)
	}
	got, _ := s.Get(m.ID)
	if got.TrafficCalibration != nil {
		t.Fatal("reset counters retained stale calibration")
	}
}
