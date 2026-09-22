//go:build unix

package transcode

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"syscall"
	"time"
)

func configureProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		if cmd.Process == nil {
			return os.ErrProcessDone
		}
		err := syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		if errors.Is(err, syscall.ESRCH) {
			return os.ErrProcessDone
		}
		return err
	}
	cmd.WaitDelay = 2 * time.Second
}

func throttleProcessGroup(ctx context.Context, pid int, activeTime, idleTime time.Duration) {
	if activeTime <= 0 || idleTime <= 0 {
		return
	}
	go func() {
		for {
			activeTimer := time.NewTimer(activeTime)
			select {
			case <-ctx.Done():
				activeTimer.Stop()
				_ = syscall.Kill(-pid, syscall.SIGCONT)
				return
			case <-activeTimer.C:
			}
			if err := syscall.Kill(-pid, syscall.SIGSTOP); err != nil {
				return
			}

			idleTimer := time.NewTimer(idleTime)
			select {
			case <-ctx.Done():
				idleTimer.Stop()
				_ = syscall.Kill(-pid, syscall.SIGCONT)
				return
			case <-idleTimer.C:
			}
			if err := syscall.Kill(-pid, syscall.SIGCONT); err != nil {
				return
			}
		}
	}()
}
