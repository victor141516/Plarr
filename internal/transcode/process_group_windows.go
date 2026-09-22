//go:build windows

package transcode

import (
	"context"
	"os/exec"
	"time"
)

func configureProcessGroup(_ *exec.Cmd) {}

func throttleProcessGroup(_ context.Context, _ int, _, _ time.Duration) {}
