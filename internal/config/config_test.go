package config

import "testing"

func TestPreviewCPUPercentage(t *testing.T) {
	t.Setenv("PLARR_PREVIEW_CPU_PERCENT", "12.5")
	if got := percentage("PLARR_PREVIEW_CPU_PERCENT", 15); got != 12.5 {
		t.Fatalf("preview percentage = %v, want 12.5", got)
	}

	t.Setenv("PLARR_PREVIEW_CPU_PERCENT", "200")
	if got := percentage("PLARR_PREVIEW_CPU_PERCENT", 15); got != 15 {
		t.Fatalf("invalid preview percentage = %v, want fallback 15", got)
	}
}
