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
	Target    recorderTarget `json:"target"`
	ExpiresAt time.Time      `json:"expires_at"`
	InUse     bool           `json:"in_use"`
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
	record := tokenRecord{Target: target, ExpiresAt: s.now().Add(recorderLinkTTL)}
	value, err := json.Marshal(record)
	if err != nil {
		return "", err
	}
	if err = s.backend.setWithExpiry(tokenKey(token), value, recorderLinkTTL); err != nil {
		return "", err
	}
	return token, nil
}

// claim atomically reserves a token for one send request. Failed sends release
// the reservation so the user can retry; successful sends permanently redeem
// it with complete.
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

func (s *tokenStore) release(claim *tokenClaim) {
	if claim == nil {
		return
	}
	record := claim.record
	record.InUse = false
	value, err := json.Marshal(record)
	remaining := record.ExpiresAt.Sub(s.now())
	if err == nil && remaining > 0 {
		_, _ = s.backend.compareAndSet(claim.key, claim.claimedValue, value, remaining)
	} else if remaining <= 0 {
		_, _ = s.backend.compareAndDelete(claim.key, claim.claimedValue)
	}
}

func (s *tokenStore) complete(claim *tokenClaim) {
	if claim != nil {
		_, _ = s.backend.compareAndDelete(claim.key, claim.claimedValue)
	}
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
