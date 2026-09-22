package transcode

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestPreviewCPULimitUsesAssignedContainerCapacity(t *testing.T) {
	if got := previewCPULimit(4, 15); got != 60 {
		t.Fatalf("preview CPU limit = %d, want 60", got)
	}
	if got := previewCPULimit(0.05, 15); got != 1 {
		t.Fatalf("minimum preview CPU limit = %d, want 1", got)
	}
}

func TestCgroupV2CPUCapacity(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cpu.max")
	if err := os.WriteFile(path, []byte("400000 100000\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	got, ok := cgroupV2CPUCapacity(path)
	if !ok || got != 4 {
		t.Fatalf("CPU capacity = %v, %v; want 4, true", got, ok)
	}
}

func TestCPUSetCapacityCountsRanges(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cpuset.cpus.effective")
	if err := os.WriteFile(path, []byte("0-2,5,8-9\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	got, ok := cpusetCPUCapacity(path)
	if !ok || got != 6 {
		t.Fatalf("CPU set capacity = %v, %v; want 6, true", got, ok)
	}
}

func TestPreviewCommandAppliesCPUAndIOBudget(t *testing.T) {
	manager := &Manager{
		FFmpeg: "ffmpeg",
		previewResources: previewResources{
			assignedCPUs:     4,
			limit:            60,
			limiterAvailable: true,
			nicePath:         "nice",
			ionicePath:       "ionice",
			tasksetPath:      "taskset",
			cpuList:          "0",
		},
	}
	cmd := manager.previewCommand(context.Background(), []string{"-i", "movie.mkv"})
	want := []string{
		"nice", "-n", "19", "ionice", "-c", "3", "taskset",
		"--cpu-list", "0", "ffmpeg", "-i", "movie.mkv",
	}
	if !slices.Equal(cmd.Args, want) {
		t.Fatalf("preview command = %q, want %q", cmd.Args, want)
	}
}
