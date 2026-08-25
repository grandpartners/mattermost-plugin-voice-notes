package main

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"strings"
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
)

type fakeMattermostAPI struct {
	created *model.Post
	locale  string
}

func (f *fakeMattermostAPI) RegisterCommand(_ *model.Command) error { return nil }
func (f *fakeMattermostAPI) GetConfig() *model.Config {
	siteURL := "https://mattermost.example.com"
	return &model.Config{ServiceSettings: model.ServiceSettings{SiteURL: &siteURL}}
}
func (f *fakeMattermostAPI) GetUser(_ string) (*model.User, *model.AppError) {
	locale := f.locale
	if locale == "" {
		locale = "en"
	}
	return &model.User{Locale: locale}, nil
}
func (f *fakeMattermostAPI) HasPermissionToChannel(_, _ string, _ *model.Permission) bool {
	return true
}
func (f *fakeMattermostAPI) GetPost(_ string) (*model.Post, *model.AppError) { return nil, nil }
func (f *fakeMattermostAPI) UploadFile(data []byte, channelID, filename string) (*model.FileInfo, *model.AppError) {
	if len(data) == 0 || channelID == "" || !strings.HasSuffix(filename, ".webm") {
		return nil, model.NewAppError("test", "invalid upload", nil, "", http.StatusBadRequest)
	}
	return &model.FileInfo{Id: "abcdefghijklmnopqrstuvwxyz"}, nil
}
func (f *fakeMattermostAPI) CreatePost(post *model.Post) (*model.Post, *model.AppError) {
	f.created = post
	post.Id = "created-post-id"
	return post, nil
}
func (f *fakeMattermostAPI) KVSetWithExpiry(_ string, _ []byte, _ int64) *model.AppError {
	return nil
}
func (f *fakeMattermostAPI) KVSetWithOptions(_ string, _ []byte, _ model.PluginKVSetOptions) (bool, *model.AppError) {
	return true, nil
}
func (f *fakeMattermostAPI) KVGet(_ string) ([]byte, *model.AppError) { return nil, nil }
func (f *fakeMattermostAPI) KVCompareAndDelete(_ string, _ []byte) (bool, *model.AppError) {
	return true, nil
}

func TestServeMobileRecorder(t *testing.T) {
	p := &Plugin{}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/mobile/", nil)
	p.ServeHTTP(nil, recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	if !strings.Contains(recorder.Body.String(), "Voice Notes") {
		t.Fatal("recorder HTML was not served")
	}
	if got := recorder.Header().Get("Content-Security-Policy"); !strings.Contains(got, "frame-ancestors 'none'") {
		t.Fatalf("unexpected Content-Security-Policy: %q", got)
	}
}

func TestAudioContainerSignatures(t *testing.T) {
	if !hasAudioContainerSignature([]byte{0x1a, 0x45, 0xdf, 0xa3}, "webm") {
		t.Fatal("valid WebM signature rejected")
	}
	if !hasAudioContainerSignature([]byte{0, 0, 0, 20, 'f', 't', 'y', 'p', 'M', '4', 'A', ' '}, "m4a") {
		t.Fatal("valid M4A signature rejected")
	}
	if hasAudioContainerSignature([]byte("not audio"), "webm") {
		t.Fatal("invalid WebM signature accepted")
	}
}

func TestLocalizedPostMessage(t *testing.T) {
	tests := map[string]string{
		"en-US": "🎤 Voice message (1:05)",
		"ru":    "🎤 Голосовое сообщение (1:05)",
		"es-ES": "🎤 Mensaje de voz (1:05)",
	}
	for language, want := range tests {
		if got := localizedPostMessage(language, 65_000); got != want {
			t.Errorf("localizedPostMessage(%q) = %q, want %q", language, got, want)
		}
	}
}

func TestMobileSendCreatesPostAndRedeemsToken(t *testing.T) {
	api := &fakeMattermostAPI{}
	store := newTokenStore(nil)
	p := &Plugin{api: api, tokens: store}
	token, err := store.issue(recorderTarget{UserID: "user-id", ChannelID: "channel-id"})
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	request := newWebMUploadRequest(t, token)
	recorder := httptest.NewRecorder()
	p.ServeHTTP(nil, recorder, request)
	if recorder.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body: %s", recorder.Code, http.StatusCreated, recorder.Body.String())
	}
	if api.created == nil {
		t.Fatal("voice post was not created")
	}
	if api.created.UserId != "user-id" || api.created.ChannelId != "channel-id" || api.created.Type != "custom_voice" {
		t.Fatalf("unexpected post target: %#v", api.created)
	}
	if got := api.created.GetProps()["fileId"]; got != "abcdefghijklmnopqrstuvwxyz" {
		t.Fatalf("fileId prop = %#v", got)
	}

	replay := newWebMUploadRequest(t, token)
	replayRecorder := httptest.NewRecorder()
	p.ServeHTTP(nil, replayRecorder, replay)
	if replayRecorder.Code != http.StatusUnauthorized {
		t.Fatalf("replay status = %d, want %d", replayRecorder.Code, http.StatusUnauthorized)
	}
}

func newWebMUploadRequest(t *testing.T, token string) *http.Request {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", `form-data; name="audio"; filename="voice-note.webm"`)
	header.Set("Content-Type", "audio/webm; codecs=opus")
	file, err := writer.CreatePart(header)
	if err != nil {
		t.Fatalf("create audio part: %v", err)
	}
	_, _ = file.Write([]byte{0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02})
	_ = writer.WriteField("duration_ms", "4200")
	peaks, _ := json.Marshal([]float64{0.1, 0.2, 0.3, 0.4, 0.5})
	_ = writer.WriteField("peaks", string(peaks))
	_ = writer.WriteField("language", "ru")
	if err = writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	request := httptest.NewRequest(http.MethodPost, "/mobile/send", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("Authorization", "Bearer "+token)
	return request
}
