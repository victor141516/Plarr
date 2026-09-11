package media

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestResolveContainsPaths(t *testing.T) {
	root := t.TempDir()
	inside := filepath.Join(root, "Movies", "Film.mkv")
	os.MkdirAll(filepath.Dir(inside), 0o755)
	os.WriteFile(inside, []byte("mock"), 0o644)
	r := Resolver{Root: root}
	path, rel, err := r.ResolveID(Encode("Movies/Film.mkv"))
	if err != nil || path != inside || rel != "Movies/Film.mkv" {
		t.Fatalf("resolve: %s %s %v", path, rel, err)
	}
	for _, bad := range []string{"../outside.mkv", "C:/Windows/file.mkv", "/etc/passwd", `Movies\\Film.mkv`} {
		if _, _, err = r.Resolve(bad); err == nil {
			t.Errorf("accepted unsafe path %q", bad)
		}
	}
}
func TestRejectsSymlinkEscape(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink creation requires privileges on Windows")
	}
	root := t.TempDir()
	outside := filepath.Join(t.TempDir(), "outside.mkv")
	os.WriteFile(outside, []byte("mock"), 0o644)
	link := filepath.Join(root, "link.mkv")
	if err := os.Symlink(outside, link); err != nil {
		t.Skip(err)
	}
	if _, _, err := (Resolver{Root: root}).Resolve("link.mkv"); err == nil {
		t.Fatal("accepted escaping symlink")
	}
}
