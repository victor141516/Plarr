package transcode

import (
	"bytes"
	"context"
	"fmt"
	"math"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"
)

type previewResources struct {
	assignedCPUs     float64
	limit            int
	limiterAvailable bool
	nicePath         string
	ionicePath       string
	tasksetPath      string
	cpuList          string
	activeTime       time.Duration
	idleTime         time.Duration
}

func detectPreviewResources(percent float64) previewResources {
	assigned := assignedCPUCapacity()
	limit := previewCPULimit(assigned, percent)
	nicePath, niceErr := exec.LookPath("nice")
	ionicePath, ioniceErr := exec.LookPath("ionice")
	tasksetPath, tasksetErr := exec.LookPath("taskset")
	workerCPUs := int(math.Ceil(float64(limit) / 100))
	allowedCPUs := allowedCPUIDs()
	if workerCPUs > len(allowedCPUs) {
		workerCPUs = len(allowedCPUs)
	}
	cpuList := formatCPUList(allowedCPUs[:workerCPUs])
	dutyCycle := float64(limit) / float64(workerCPUs*100)
	cycle := 100 * time.Millisecond
	activeTime := time.Duration(dutyCycle * float64(cycle))
	return previewResources{
		assignedCPUs:     assigned,
		limit:            limit,
		limiterAvailable: runtime.GOOS == "linux" && niceErr == nil && ioniceErr == nil && tasksetErr == nil && cpuList != "",
		nicePath:         nicePath,
		ionicePath:       ionicePath,
		tasksetPath:      tasksetPath,
		cpuList:          cpuList,
		activeTime:       activeTime,
		idleTime:         cycle - activeTime,
	}
}

func previewCPULimit(assignedCPUs, percent float64) int {
	limit := int(math.Floor(assignedCPUs * percent))
	if limit < 1 {
		return 1
	}
	return limit
}

func assignedCPUCapacity() float64 {
	capacity := float64(runtime.NumCPU())
	if value, ok := cgroupV2CPUCapacity("/sys/fs/cgroup/cpu.max"); ok && value < capacity {
		capacity = value
	} else if value, ok := cgroupV1CPUCapacity("/sys/fs/cgroup/cpu/cpu.cfs_quota_us", "/sys/fs/cgroup/cpu/cpu.cfs_period_us"); ok && value < capacity {
		capacity = value
	}
	if value, ok := cpusetCPUCapacity("/sys/fs/cgroup/cpuset.cpus.effective"); ok && value < capacity {
		capacity = value
	}
	if capacity <= 0 {
		return 1
	}
	return capacity
}

func cgroupV2CPUCapacity(path string) (float64, bool) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return 0, false
	}
	parts := strings.Fields(string(raw))
	if len(parts) != 2 || parts[0] == "max" {
		return 0, false
	}
	quota, quotaErr := strconv.ParseFloat(parts[0], 64)
	period, periodErr := strconv.ParseFloat(parts[1], 64)
	if quotaErr != nil || periodErr != nil || quota <= 0 || period <= 0 {
		return 0, false
	}
	return quota / period, true
}

func cgroupV1CPUCapacity(quotaPath, periodPath string) (float64, bool) {
	quotaRaw, quotaErr := os.ReadFile(quotaPath)
	periodRaw, periodErr := os.ReadFile(periodPath)
	if quotaErr != nil || periodErr != nil {
		return 0, false
	}
	quota, quotaErr := strconv.ParseFloat(strings.TrimSpace(string(quotaRaw)), 64)
	period, periodErr := strconv.ParseFloat(strings.TrimSpace(string(periodRaw)), 64)
	if quotaErr != nil || periodErr != nil || quota <= 0 || period <= 0 {
		return 0, false
	}
	return quota / period, true
}

func cpusetCPUCapacity(path string) (float64, bool) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return 0, false
	}
	count := 0
	for _, part := range strings.Split(strings.TrimSpace(string(raw)), ",") {
		bounds := strings.Split(strings.TrimSpace(part), "-")
		if len(bounds) == 0 || len(bounds) > 2 || bounds[0] == "" {
			return 0, false
		}
		start, startErr := strconv.Atoi(bounds[0])
		end := start
		if len(bounds) == 2 {
			var endErr error
			end, endErr = strconv.Atoi(bounds[1])
			if endErr != nil {
				return 0, false
			}
		}
		if startErr != nil || end < start {
			return 0, false
		}
		count += end - start + 1
	}
	return float64(count), count > 0
}

func allowedCPUIDs() []int {
	raw, err := os.ReadFile("/proc/self/status")
	if err == nil {
		for _, line := range strings.Split(string(raw), "\n") {
			if strings.HasPrefix(line, "Cpus_allowed_list:") {
				if cpus, ok := parseCPUList(strings.TrimSpace(strings.TrimPrefix(line, "Cpus_allowed_list:"))); ok {
					return cpus
				}
			}
		}
	}
	result := make([]int, max(1, runtime.NumCPU()))
	for index := range result {
		result[index] = index
	}
	return result
}

func parseCPUList(raw string) ([]int, bool) {
	result := []int{}
	for _, part := range strings.Split(strings.TrimSpace(raw), ",") {
		bounds := strings.Split(strings.TrimSpace(part), "-")
		if len(bounds) == 0 || len(bounds) > 2 || bounds[0] == "" {
			return nil, false
		}
		start, startErr := strconv.Atoi(bounds[0])
		end := start
		if len(bounds) == 2 {
			var endErr error
			end, endErr = strconv.Atoi(bounds[1])
			if endErr != nil {
				return nil, false
			}
		}
		if startErr != nil || end < start {
			return nil, false
		}
		for cpu := start; cpu <= end; cpu++ {
			result = append(result, cpu)
		}
	}
	return result, len(result) > 0
}

func formatCPUList(cpus []int) string {
	parts := make([]string, len(cpus))
	for index, cpu := range cpus {
		parts[index] = strconv.Itoa(cpu)
	}
	return strings.Join(parts, ",")
}

func (m *Manager) previewCommand(ctx context.Context, args []string) *exec.Cmd {
	if !m.previewResources.limiterAvailable {
		cmd := exec.CommandContext(ctx, m.FFmpeg, args...)
		configureProcessGroup(cmd)
		return cmd
	}
	commandArgs := []string{"-n", "19", m.previewResources.ionicePath, "-c", "3", m.previewResources.tasksetPath, "--cpu-list", m.previewResources.cpuList, m.FFmpeg}
	commandArgs = append(commandArgs, args...)
	cmd := exec.CommandContext(ctx, m.previewResources.nicePath, commandArgs...)
	configureProcessGroup(cmd)
	return cmd
}

func (m *Manager) runPreview(ctx context.Context, args []string) error {
	cmd := m.previewCommand(ctx, args)
	var output bytes.Buffer
	cmd.Stdout = &output
	cmd.Stderr = &output
	stopThrottle, err := m.startPreviewCommand(ctx, cmd)
	if err != nil {
		return err
	}
	defer stopThrottle()
	if err := cmd.Wait(); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return fmt.Errorf("FFmpeg preview failed: %w: %s", err, strings.TrimSpace(output.String()))
	}
	return nil
}

func (m *Manager) startPreviewCommand(ctx context.Context, cmd *exec.Cmd) (context.CancelFunc, error) {
	if err := cmd.Start(); err != nil {
		return func() {}, err
	}
	throttleContext, stopThrottle := context.WithCancel(ctx)
	if m.previewResources.limiterAvailable {
		throttleProcessGroup(throttleContext, cmd.Process.Pid, m.previewResources.activeTime, m.previewResources.idleTime)
	}
	return stopThrottle, nil
}
