package main

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"
)

const recorderLinkTTL = 20 * time.Minute

var (
	errInvalidToken = errors.New("invalid or expired recorder token")
	errTokenInUse   = errors.New("recorder token is already in use")
)

type recorderTarget struct {
	UserID    string `json:"user_id"`
	ChannelID string `json:"channel_id"`
	TeamID    string `json:"team_id"`
	RootID    string `json:"root_id,omitempty"`
}

type tokenRecord struct {
	Target        recorderTarget `json:"target"`
	ExpiresAt     time.Time      `json:"expires_at"`
	PendingPostID string         `json:"pending_post_id"`
	FileID        string         `json:"file_id,omitempty"`
	AudioSHA256   string         `json:"audio_sha256,omitempty"`
	DurationMS    int64          `json:"duration_ms,omitempty"`
	Peaks         []float64      `json:"peaks,omitempty"`
	Language      string         `json:"language,omitempty"`
	InUse         bool           `json:"in_use"`
}

type tokenClaim struct {
	key          string
	claimedValue []byte
	record       tokenRecord
}

type tokenKV interface {
	setWithExpiry(key string, value []byte, expiresIn time.Duration) error
	get(key string) ([]byte, error)
	compareAndSet(key string, oldValue, newValue []byte, expiresIn time.Duration) (bool, error)
	compareAndDelete(key string, oldValue []byte) (bool, error)
}

// tokenStore deliberately keys records by a SHA-256 digest. The bearer token
// appears only in the link fragment and in the browser's memory; the plugin
// never persists its usable form. Mattermost's KV compare-and-set operations
// make a claim atomic across a multi-node Mattermost installation.
type tokenStore struct {
	backend tokenKV
	now     func() time.Time
}

func newTokenStore(backend tokenKV) *tokenStore {
	if backend == nil {
		backend = newMemoryTokenKV()
	}
	return &tokenStore{backend: backend, now: time.Now}
}

func (s *tokenStore) issue(target recorderTarget) (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}

	token := base64.RawURLEncoding.EncodeToString(raw)
	now := s.now()
	pendingDigest := sha256.Sum256(append([]byte("pending-post:"), raw...))
	record := tokenRecord{
		Target:        target,
		ExpiresAt:     now.Add(recorderLinkTTL),
		PendingPostID: hex.EncodeToString(pendingDigest[:13]) + ":" + fmt.Sprint(now.UnixMilli()),
	}
	value, err := json.Marshal(record)
	if err != nil {
		return "", err
	}
	if err = s.backend.setWithExpiry(tokenKey(token), value, recorderLinkTTL); err != nil {
		return "", err
	}
	return token, nil
}

// claim atomically reserves a token for one send request. Handled failures
// before CreatePost try to release the reservation so the user can retry. A
// process failure, a later KV failure, or any CreatePost attempt can leave the
// token reserved until expiry, preserving one-time semantics at the cost of
// retry availability.
func (s *tokenStore) claim(token string) (*tokenClaim, error) {
	if len(token) != 43 {
		return nil, errInvalidToken
	}

	key := tokenKey(token)
	value, err := s.backend.get(key)
	if err != nil {
		return nil, fmt.Errorf("read recorder token: %w", err)
	}
	if len(value) == 0 {
		return nil, errInvalidToken
	}

	var record tokenRecord
	now := s.now()
	if err = json.Unmarshal(value, &record); err != nil || !record.ExpiresAt.After(now) {
		_, _ = s.backend.compareAndDelete(key, value)
		return nil, errInvalidToken
	}
	if record.InUse {
		return nil, errTokenInUse
	}
	// Tokens issued by an older plugin version do not have a pending post ID.
	// Derive one from the stored token hash so retries remain stable after an
	// upgrade without exposing the bearer token itself.
	if record.PendingPostID == "" {
		pendingDigest := sha256.Sum256([]byte(key))
		record.PendingPostID = hex.EncodeToString(pendingDigest[:13]) + ":" + fmt.Sprint(record.ExpiresAt.Add(-recorderLinkTTL).UnixMilli())
	}

	record.InUse = true
	claimedValue, err := json.Marshal(record)
	if err != nil {
		return nil, err
	}
	swapped, err := s.backend.compareAndSet(key, value, claimedValue, record.ExpiresAt.Sub(now))
	if err != nil {
		return nil, fmt.Errorf("reserve recorder token: %w", err)
	}
	if !swapped {
		return nil, errTokenInUse
	}

	return &tokenClaim{key: key, claimedValue: claimedValue, record: record}, nil
}

// attachFile saves the uploaded file and its immutable post metadata on the
// claimed token. The claim must not be released after CreatePost is attempted,
// because an error from that call can still mean the post was stored.
func (s *tokenStore) attachFile(claim *tokenClaim, fileID, audioSHA256 string, durationMS int64, peaks []float64, language string) error {
	if claim == nil || fileID == "" || audioSHA256 == "" || durationMS <= 0 || len(peaks) == 0 {
		return fmt.Errorf("invalid recorder token file state")
	}
	if claim.record.FileID != "" {
		if claim.record.FileID == fileID {
			return nil
		}
		return fmt.Errorf("recorder token already has a different file")
	}

	record := claim.record
	record.FileID = fileID
	record.AudioSHA256 = audioSHA256
	record.DurationMS = durationMS
	record.Peaks = append([]float64(nil), peaks...)
	record.Language = language
	value, err := json.Marshal(record)
	if err != nil {
		return fmt.Errorf("encode recorder token file state: %w", err)
	}
	remaining := record.ExpiresAt.Sub(s.now())
	if remaining <= 0 {
		return errInvalidToken
	}
	swapped, err := s.backend.compareAndSet(claim.key, claim.claimedValue, value, remaining)
	if err != nil {
		return fmt.Errorf("save recorder token file state: %w", err)
	}
	if !swapped {
		return fmt.Errorf("save recorder token file state: token state changed")
	}

	claim.claimedValue = value
	claim.record = record
	return nil
}

func (s *tokenStore) release(claim *tokenClaim) error {
	if claim == nil {
		return nil
	}
	record := claim.record
	record.InUse = false
	value, err := json.Marshal(record)
	if err != nil {
		return fmt.Errorf("encode released recorder token: %w", err)
	}
	remaining := record.ExpiresAt.Sub(s.now())
	if remaining > 0 {
		swapped, swapErr := s.backend.compareAndSet(claim.key, claim.claimedValue, value, remaining)
		if swapErr != nil {
			return fmt.Errorf("release recorder token: %w", swapErr)
		}
		if !swapped {
			return fmt.Errorf("release recorder token: token state changed")
		}
		return nil
	}

	deleted, deleteErr := s.backend.compareAndDelete(claim.key, claim.claimedValue)
	if deleteErr != nil {
		return fmt.Errorf("delete expired recorder token: %w", deleteErr)
	}
	if !deleted {
		return fmt.Errorf("delete expired recorder token: token state changed")
	}
	return nil
}

func (s *tokenStore) complete(claim *tokenClaim) error {
	if claim == nil {
		return nil
	}
	deleted, err := s.backend.compareAndDelete(claim.key, claim.claimedValue)
	if err != nil {
		return fmt.Errorf("complete recorder token: %w", err)
	}
	if !deleted {
		return fmt.Errorf("complete recorder token: token state changed")
	}
	return nil
}

func tokenKey(token string) string {
	digest := sha256.Sum256([]byte(token))
	return "mobile-token:" + hex.EncodeToString(digest[:])
}

type memoryTokenKV struct {
	mu     sync.Mutex
	values map[string][]byte
}

func newMemoryTokenKV() *memoryTokenKV {
	return &memoryTokenKV{values: make(map[string][]byte)}
}

func (m *memoryTokenKV) setWithExpiry(key string, value []byte, _ time.Duration) error {
	m.mu.Lock()
	m.values[key] = bytes.Clone(value)
	m.mu.Unlock()
	return nil
}

func (m *memoryTokenKV) get(key string) ([]byte, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return bytes.Clone(m.values[key]), nil
}

func (m *memoryTokenKV) compareAndSet(key string, oldValue, newValue []byte, _ time.Duration) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !bytes.Equal(m.values[key], oldValue) {
		return false, nil
	}
	m.values[key] = bytes.Clone(newValue)
	return true, nil
}

func (m *memoryTokenKV) compareAndDelete(key string, oldValue []byte) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !bytes.Equal(m.values[key], oldValue) {
		return false, nil
	}
	delete(m.values, key)
	return true, nil
}
