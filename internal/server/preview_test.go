package server

import "testing"

func TestPreviewBucketPreservesMillisecondPrecision(t *testing.T) {
	tests := map[string]float64{"0": 0, "0.9994": 0.999, "10": 10, "67.2346": 67.235}
	for input, want := range tests {
		got, err := previewBucket(input)
		if err != nil || got != want {
			t.Fatalf("previewBucket(%q) = %f, %v; want %f", input, got, err, want)
		}
	}
}

func TestPreviewBucketRejectsInvalidTimes(t *testing.T) {
	for _, input := range []string{"", "-1", "NaN", "Inf", "604801"} {
		if _, err := previewBucket(input); err == nil {
			t.Fatalf("previewBucket(%q) accepted an invalid time", input)
		}
	}
}
