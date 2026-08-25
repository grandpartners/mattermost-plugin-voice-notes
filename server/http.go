package main

import (
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"
)

const (
	maxMobileUploadBytes = 32 << 20
	maxRecordingMS       = 300_000
)

//go:embed mobile/index.html mobile/app.js mobile/styles.css
var mobileAssets embed.FS

type mobilePayload struct {
	audio      []byte
	extension  string
	durationMS int64
	peaks      []float64
	language   string
}

func (p *Plugin) ServeHTTP(_ *plugin.Context, w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/plugins/"+pluginID)
	if path == "/mobile" && (r.Method == http.MethodGet || r.Method == http.MethodHead) {
		http.Redirect(w, r, r.URL.Path+"/", http.StatusTemporaryRedirect)
		return
	}

	switch path {
	case "/mobile/":
		p.serveMobileAsset(w, r, "mobile/index.html", "text/html; charset=utf-8")
	case "/mobile/app.js":
		p.serveMobileAsset(w, r, "mobile/app.js", "text/javascript; charset=utf-8")
	case "/mobile/styles.css":
		p.serveMobileAsset(w, r, "mobile/styles.css", "text/css; charset=utf-8")
	case "/mobile/send":
		p.handleMobileSend(w, r)
	default:
		http.NotFound(w, r)
	}
}

func (p *Plugin) serveMobileAsset(w http.ResponseWriter, r *http.Request, name, contentType string) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	data, err := mobileAssets.ReadFile(name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	setMobileSecurityHeaders(w.Header())
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		_, _ = w.Write(data)
	}
}

func setMobileSecurityHeaders(header http.Header) {
	header.Set("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self' blob:; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
	header.Set("Permissions-Policy", "microphone=(self), camera=(), geolocation=()")
	header.Set("Referrer-Policy", "no-referrer")
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("X-Frame-Options", "DENY")
	header.Set("X-Robots-Tag", "noindex, nofollow")
}

func (p *Plugin) handleMobileSend(w http.ResponseWriter, r *http.Request) {
	setMobileSecurityHeaders(w.Header())
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	token := bearerToken(r.Header.Get("Authorization"))
	api, tokens := p.runtime()
	claim, err := tokens.claim(token)
	if errors.Is(err, errTokenInUse) {
		writeJSONError(w, http.StatusConflict, "this recorder link is already sending a message")
		return
	}
	if errors.Is(err, errInvalidToken) {
		writeJSONError(w, http.StatusUnauthorized, "this recorder link is invalid, expired, or already used")
		return
	}
	if err != nil {
		if api != nil {
			api.LogWarn("Could not claim mobile voice recorder token", "error", err.Error())
		}
		writeJSONError(w, http.StatusServiceUnavailable, "the voice recorder is temporarily unavailable")
		return
	}

	completed := false
	defer func() {
		if !completed {
			if releaseErr := tokens.release(claim); releaseErr != nil && api != nil {
				api.LogWarn("Could not release mobile voice recorder token", "pending_post_id", claim.record.PendingPostID, "error", releaseErr.Error())
			}
		}
	}()
	target := claim.record.Target

	r.Body = http.MaxBytesReader(w, r.Body, maxMobileUploadBytes+1_048_576)
	payload, status, err := parseMobilePayload(r)
	if err != nil {
		writeJSONError(w, status, err.Error())
		return
	}

	if api == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "the voice recorder is temporarily unavailable")
		return
	}
	user, appErr := api.GetUser(target.UserID)
	if appErr != nil || user == nil || user.DeleteAt != 0 {
		writeJSONError(w, http.StatusForbidden, "the Mattermost user for this recorder link is no longer active")
		return
	}
	if !hasRecorderPermissions(api, target.UserID, target.ChannelID) {
		writeJSONError(w, http.StatusForbidden, "you no longer have permission to post files in this channel")
		return
	}
	if target.RootID != "" {
		root, appErr := api.GetPost(target.RootID)
		if appErr != nil || root == nil || root.ChannelId != target.ChannelID || root.DeleteAt != 0 {
			writeJSONError(w, http.StatusConflict, "the original thread is no longer available")
			return
		}
	}

	fileID := claim.record.FileID
	if fileID == "" {
		filename := fmt.Sprintf("voice-note-%d.%s", time.Now().UnixMilli(), payload.extension)
		fileInfo, appErr := api.UploadFile(payload.audio, target.ChannelID, filename)
		if appErr != nil || fileInfo == nil {
			writeJSONError(w, http.StatusBadGateway, "Mattermost could not store the recording")
			return
		}
		fileID = fileInfo.Id
		if err = tokens.attachFile(claim, fileID); err != nil {
			api.LogWarn(
				"Could not save uploaded mobile voice note on its recorder token; Mattermost orphan-file cleanup may remove the file",
				"file_id", fileID,
				"pending_post_id", claim.record.PendingPostID,
				"error", err.Error(),
			)
			writeJSONError(w, http.StatusServiceUnavailable, "the recording was stored but could not be prepared for sending; please try again")
			return
		}
	}

	post := &model.Post{
		UserId:        target.UserID,
		ChannelId:     target.ChannelID,
		RootId:        target.RootID,
		Type:          "custom_voice",
		Message:       localizedPostMessage(payload.language, payload.durationMS),
		FileIds:       model.StringArray{fileID},
		PendingPostId: claim.record.PendingPostID,
		Props: model.StringInterface{
			"voice_message": true,
			"fileId":        fileID,
			"duration":      payload.durationMS,
			"peaks":         payload.peaks,
		},
	}
	created, appErr := api.CreatePost(post)
	if appErr != nil || created == nil {
		api.LogWarn(
			"Could not create a post for an uploaded mobile voice note; Mattermost orphan-file cleanup may remove the file",
			"file_id", fileID,
			"pending_post_id", claim.record.PendingPostID,
			"error", fmt.Sprint(appErr),
		)
		writeJSONError(w, http.StatusBadGateway, "Mattermost could not create the voice message")
		return
	}

	completed = true
	if err = tokens.complete(claim); err != nil {
		api.LogWarn("Could not permanently redeem mobile voice recorder token", "pending_post_id", claim.record.PendingPostID, "post_id", created.Id, "error", err.Error())
	}
	returnURL := "mattermost://"
	if siteURL, siteErr := configuredSiteURL(api.GetConfig()); siteErr == nil {
		if parsed, parseErr := url.Parse(siteURL); parseErr == nil {
			parsed.Scheme = "mattermost"
			returnURL = parsed.String()
		}
	}
	writeJSON(w, http.StatusCreated, map[string]string{
		"post_id":    created.Id,
		"return_url": returnURL,
	})
}

func parseMobilePayload(r *http.Request) (mobilePayload, int, error) {
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return mobilePayload{}, http.StatusRequestEntityTooLarge, fmt.Errorf("the recording is too large")
		}
		return mobilePayload{}, http.StatusBadRequest, fmt.Errorf("the recording upload is invalid or too large")
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}

	file, header, err := r.FormFile("audio")
	if err != nil {
		return mobilePayload{}, http.StatusBadRequest, fmt.Errorf("the recording is missing")
	}
	defer file.Close()
	if header.Size <= 0 || header.Size > maxMobileUploadBytes {
		return mobilePayload{}, http.StatusRequestEntityTooLarge, fmt.Errorf("the recording is empty or too large")
	}

	mediaType, _, err := mime.ParseMediaType(header.Header.Get("Content-Type"))
	if err != nil {
		return mobilePayload{}, http.StatusUnsupportedMediaType, fmt.Errorf("the recording format is not supported")
	}
	extension := ""
	switch strings.ToLower(mediaType) {
	case "audio/mp4", "audio/x-m4a", "audio/m4a":
		extension = "m4a"
	case "audio/webm":
		extension = "webm"
	default:
		return mobilePayload{}, http.StatusUnsupportedMediaType, fmt.Errorf("use an M4A or WebM recording")
	}

	audio, err := io.ReadAll(io.LimitReader(file, maxMobileUploadBytes+1))
	if err != nil || len(audio) == 0 {
		return mobilePayload{}, http.StatusBadRequest, fmt.Errorf("the recording could not be read")
	}
	if len(audio) > maxMobileUploadBytes {
		return mobilePayload{}, http.StatusRequestEntityTooLarge, fmt.Errorf("the recording is too large")
	}
	if !hasAudioContainerSignature(audio, extension) {
		return mobilePayload{}, http.StatusUnsupportedMediaType, fmt.Errorf("the recording is not a valid M4A or WebM file")
	}

	durationMS, err := strconv.ParseInt(r.FormValue("duration_ms"), 10, 64)
	if err != nil || durationMS <= 0 || durationMS > maxRecordingMS+1000 {
		return mobilePayload{}, http.StatusBadRequest, fmt.Errorf("the recording duration is invalid")
	}

	var peaks []float64
	if err := json.Unmarshal([]byte(r.FormValue("peaks")), &peaks); err != nil || len(peaks) < 5 || len(peaks) > 256 {
		return mobilePayload{}, http.StatusBadRequest, fmt.Errorf("the recording waveform is invalid")
	}
	for _, peak := range peaks {
		if peak < 0 || peak > 1 {
			return mobilePayload{}, http.StatusBadRequest, fmt.Errorf("the recording waveform is invalid")
		}
	}

	return mobilePayload{
		audio:      audio,
		extension:  extension,
		durationMS: durationMS,
		peaks:      peaks,
		language:   r.FormValue("language"),
	}, http.StatusOK, nil
}

func hasAudioContainerSignature(data []byte, extension string) bool {
	switch extension {
	case "webm":
		return len(data) >= 4 && data[0] == 0x1a && data[1] == 0x45 && data[2] == 0xdf && data[3] == 0xa3
	case "m4a":
		return len(data) >= 12 && string(data[4:8]) == "ftyp"
	default:
		return false
	}
}

func bearerToken(header string) string {
	const prefix = "Bearer "
	if !strings.HasPrefix(header, prefix) {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(header, prefix))
}

func localizedPostMessage(language string, durationMS int64) string {
	duration := fmt.Sprintf("%d:%02d", durationMS/60_000, (durationMS/1000)%60)
	switch strings.ToLower(strings.Split(language, "-")[0]) {
	case "ru":
		return "🎤 Голосовое сообщение (" + duration + ")"
	case "es":
		return "🎤 Mensaje de voz (" + duration + ")"
	default:
		return "🎤 Voice message (" + duration + ")"
	}
}

func writeJSONError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"message": message})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
