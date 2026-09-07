package main

import (
	"encoding/json"
	"errors"
	"fmt"

	bolt "go.etcd.io/bbolt"
)

// Only the current cycle's reference is stored, not a history of usage.
type TrafficCalibration struct {
	UsedBytes  uint64 `json:"used_bytes"`
	BaseIn     uint64 `json:"base_in"`
	BaseOut    uint64 `json:"base_out"`
	CycleStart string `json:"cycle_start"`
	CycleEnd   string `json:"cycle_end"`
	ResetDay   int    `json:"reset_day"`
	Mode       string `json:"mode"`
}

var errTrafficSettings = errors.New("invalid traffic settings")

// Patch background metadata without overwriting traffic settings/counters
// saved while a worker was using an older snapshot.
func (s *Store) patchMetric(id string, patch func(*SystemMetric)) error {
	return s.db.Update(func(tx *bolt.Tx) error {
		bucket := tx.Bucket([]byte(bucketName))
		if bucket == nil {
			return errors.New("bucket not found")
		}
		raw := bucket.Get([]byte(id))
		if raw == nil {
			return nil
		}
		var metric SystemMetric
		if err := json.Unmarshal(raw, &metric); err != nil {
			return err
		}
		patch(&metric)
		raw, err := json.Marshal(metric)
		if err != nil {
			return err
		}
		return bucket.Put([]byte(id), raw)
	})
}

func billingMode(mode string) string {
	if mode == "in" || mode == "out" {
		return mode
	}
	return "sum"
}

func trafficCalibrationMatches(m SystemMetric) bool {
	c := m.TrafficCalibration
	if c == nil {
		return true
	}
	return c.Mode == billingMode(m.TrafficBillingMode) && c.CycleStart == m.TrafficCycleStart &&
		c.CycleEnd == m.TrafficCycleEnd && c.ResetDay == m.TrafficResetDay &&
		(c.Mode == "out" || m.MonthlyNetInBytes >= c.BaseIn) &&
		(c.Mode == "in" || m.MonthlyNetOutBytes >= c.BaseOut)
}

// Save the baseline and admin fields atomically against the latest counters.
// A metrics push arriving while the edit modal is open is not overwritten.
func (s *Store) SaveAdminTraffic(metric SystemMetric, mode *string, used *uint64, clear bool) (SystemMetric, error) {
	if mode != nil && *mode != "sum" && *mode != "in" && *mode != "out" {
		return metric, fmt.Errorf("%w: choose sum, in or out", errTrafficSettings)
	}
	if used != nil && (clear || *used > 9007199254740991) {
		return metric, fmt.Errorf("%w: invalid calibration amount", errTrafficSettings)
	}
	err := s.db.Update(func(tx *bolt.Tx) error {
		bucket := tx.Bucket([]byte(bucketName))
		if bucket == nil {
			return errors.New("bucket not found")
		}
		if raw := bucket.Get([]byte(metric.ID)); raw != nil {
			var current SystemMetric
			if err := json.Unmarshal(raw, &current); err != nil {
				return err
			}
			// Keep traffic settings from the latest record unless explicitly changed.
			metric.TrafficBillingMode = current.TrafficBillingMode
			metric.TrafficCalibration = current.TrafficCalibration
			mergeAdminOwned(&current, &metric)
			metric = current
		}
		if mode != nil {
			if billingMode(metric.TrafficBillingMode) != *mode {
				metric.TrafficCalibration = nil
			}
			metric.TrafficBillingMode = *mode
		}
		if clear {
			metric.TrafficCalibration = nil
		}
		if used != nil {
			if metric.TrafficSource != "vnstat" || metric.TrafficCycleStart == "" || metric.TrafficCycleEnd == "" {
				return fmt.Errorf("%w: monthly data is not ready; wait for vnStat before calibrating", errTrafficSettings)
			}
			metric.TrafficCalibration = &TrafficCalibration{UsedBytes: *used,
				BaseIn: metric.MonthlyNetInBytes, BaseOut: metric.MonthlyNetOutBytes,
				CycleStart: metric.TrafficCycleStart, CycleEnd: metric.TrafficCycleEnd,
				ResetDay: metric.TrafficResetDay, Mode: billingMode(metric.TrafficBillingMode)}
		}
		raw, err := json.Marshal(metric)
		if err != nil {
			return err
		}
		return bucket.Put([]byte(metric.ID), raw)
	})
	return metric, err
}
