package media

import (
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

var supported = map[string]bool{".mp4": true, ".avi": true, ".mov": true, ".wmv": true, ".webm": true, ".flv": true, ".m4v": true, ".mkv": true, ".vob": true, ".ts": true, ".3gp": true, ".asf": true, ".divx": true}

type Resolver struct{ Root string }

func Encode(relative string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(filepath.ToSlash(relative)))
}
func Decode(id string) (string, error) {
	b, err := base64.RawURLEncoding.DecodeString(id)
	if err != nil || len(b) == 0 {
		return "", errors.New("invalid media identifier")
	}
	return string(b), nil
}
func (r Resolver) ResolveID(id string) (string, string, error) {
	relative, err := Decode(id)
	if err != nil {
		return "", "", err
	}
	return r.Resolve(relative)
}
func (r Resolver) Resolve(relative string) (string, string, error) {
	if strings.ContainsRune(relative, '\x00') || strings.Contains(relative, "\\") {
		return "", "", errors.New("invalid media path")
	}
	if len(relative) >= 2 && ((relative[0] >= 'A' && relative[0] <= 'Z') || (relative[0] >= 'a' && relative[0] <= 'z')) && relative[1] == ':' {
		return "", "", errors.New("drive-qualified media paths are forbidden")
	}
	if filepath.IsAbs(relative) || filepath.VolumeName(relative) != "" {
		return "", "", errors.New("absolute media paths are forbidden")
	}
	cleanSlash := filepath.ToSlash(filepath.Clean(filepath.FromSlash(relative)))
	if cleanSlash == "." || cleanSlash == ".." || strings.HasPrefix(cleanSlash, "../") {
		return "", "", errors.New("media path escapes the configured root")
	}
	joined := filepath.Join(r.Root, filepath.FromSlash(cleanSlash))
	info, err := os.Stat(joined)
	if err != nil {
		return "", "", err
	}
	if info.IsDir() {
		return "", "", errors.New("media path is a directory")
	}
	real, err := filepath.EvalSymlinks(joined)
	if err != nil {
		return "", "", err
	}
	rel, err := filepath.Rel(r.Root, real)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", "", errors.New("media symlink escapes the configured root")
	}
	if !supported[strings.ToLower(filepath.Ext(real))] {
		return "", "", errors.New("unsupported media file")
	}
	return real, filepath.ToSlash(rel), nil
}
