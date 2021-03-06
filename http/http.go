package http

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/mpolden/nadapi/nad"
)

// Server represents an API server.
type Server struct {
	client    *nad.Client
	StaticDir string
}

// State represents a response from the state API.
type State struct {
	Power    *bool  `json:"power,omitempty"`
	SpeakerA *bool  `json:"speakerA,omitempty"`
	SpeakerB *bool  `json:"speakerB,omitempty"`
	Mute     *bool  `json:"mute,omitempty"`
	Source   string `json:"source,omitempty"`
	Model    string `json:"model,omitempty"`
	Volume   string `json:"volume,omitempty"`
}

// AmpValue represents a value that will be sent to the amplifier.
type AmpValue struct {
	Value string `json:"value"`
}

// UnmarshalJSON implements the json.Unmarshaler interface. Both string and boolean are accepted for the "value" field.
func (av *AmpValue) UnmarshalJSON(data []byte) error {
	var err error
	var s struct{ Value string }
	if err = json.Unmarshal(data, &s); err == nil {
		av.Value = s.Value
		return nil
	}
	var b struct{ Value bool }
	if err = json.Unmarshal(data, &b); err == nil {
		if b.Value {
			av.Value = "on"
		} else {
			av.Value = "off"
		}
		return nil
	}
	return err
}

// Error represents an error in the API, which is returned to the user.
type Error struct {
	err     error
	Status  int    `json:"status"`
	Message string `json:"message"`
}

func isOn(s string) bool { return strings.ToLower(s) == "on" }

func (s *Server) queryStateString(variable string) (string, *Error) {
	reply, err := s.client.SendCmd(nad.Cmd{Variable: variable, Operator: "?"})
	if err != nil {
		return "", &Error{
			err:     err,
			Status:  http.StatusInternalServerError,
			Message: fmt.Sprintf("Failed to get %s state from amplifier", variable),
		}
	}
	return reply.Value, nil
}

func (s *Server) queryStateBool(variable string) (bool, *Error) {
	state, err := s.queryStateString(variable)
	if err != nil {
		return false, err
	}
	return isOn(state), nil
}

func (s *Server) queryState(variable string) (State, *Error) {
	state := State{}
	switch variable {
	case "power":
		on, err := s.queryStateBool("Power")
		if err != nil {
			return State{}, err
		}
		state.Power = &on
	case "mute":
		on, err := s.queryStateBool("Mute")
		if err != nil {
			return State{}, err
		}
		state.Mute = &on
	case "speakera":
		on, err := s.queryStateBool("SpeakerA")
		if err != nil {
			return State{}, err
		}
		state.SpeakerA = &on
	case "speakerb":
		on, err := s.queryStateBool("SpeakerB")
		if err != nil {
			return State{}, err
		}
		state.SpeakerB = &on
	case "source":
		source, err := s.queryStateString("Source")
		if err != nil {
			return State{}, err
		}
		state.Source = source
	case "model":
		model, err := s.queryStateString("Model")
		if err != nil {
			return State{}, err
		}
		state.Model = model
	default:
		return State{}, &Error{
			Status:  http.StatusBadRequest,
			Message: fmt.Sprintf("Invalid command: %s?", variable),
		}
	}
	return state, nil
}

func (s *Server) modifyState(variable string, value AmpValue) (State, *Error) {
	cmd := nad.Cmd{Variable: variable, Operator: "=", Value: value.Value}
	switch value.Value {
	case "+", "-", "?":
		cmd.Operator = value.Value
		cmd.Value = ""
	}
	if !cmd.Valid() || value.Value == "?" {
		return State{}, &Error{
			Status:  http.StatusBadRequest,
			Message: fmt.Sprintf("Invalid command: %s%s%s", cmd.Variable, cmd.Operator, cmd.Value),
		}
	}
	reply, err := s.client.SendCmd(cmd)
	if err != nil {
		return State{}, &Error{
			err:     err,
			Status:  http.StatusInternalServerError,
			Message: fmt.Sprintf("Could not send command to amplifier: %s", err),
		}
	}
	state := State{}
	switch strings.ToLower(reply.Variable) {
	case "power":
		on := isOn(reply.Value)
		state.Power = &on
	case "mute":
		on := isOn(reply.Value)
		state.Mute = &on
	case "speakera":
		on := isOn(reply.Value)
		state.SpeakerA = &on
	case "speakerb":
		on := isOn(reply.Value)
		state.SpeakerB = &on
	case "source":
		state.Source = reply.Value
	case "model":
		state.Model = reply.Value
	case "volume":
		state.Volume = reply.Operator
	}
	return state, nil
}

// StateHandler handles requests that query or modify the amplifiers state.
func (s *Server) StateHandler(w http.ResponseWriter, r *http.Request) (interface{}, *Error) {
	variable := strings.ToLower(filepath.Base(r.URL.Path))
	if variable == "state" {
		return s.NotFoundHandler(w, r)
	}
	if r.Method == http.MethodGet {
		return s.queryState(variable)
	}
	if r.Method == http.MethodPatch {
		defer r.Body.Close()
		dec := json.NewDecoder(r.Body)
		var av AmpValue
		if err := dec.Decode(&av); err != nil {
			return nil, &Error{Status: http.StatusBadRequest, Message: "Malformed JSON"}
		}
		return s.modifyState(variable, av)
	}
	return nil, &Error{
		Status:  http.StatusBadRequest,
		Message: fmt.Sprintf("Invalid request method %s, must be %s or %s", r.Method, http.MethodGet, http.MethodPatch),
	}
}

// NotFoundHandler handles requests to invalid routes.
func (s *Server) NotFoundHandler(w http.ResponseWriter, req *http.Request) (interface{}, *Error) {
	return nil, &Error{
		Status:  http.StatusNotFound,
		Message: "Not found",
	}
}

// New returns an new API using client to communicate with an amplifier.
func New(client *nad.Client) *Server {
	return &Server{client: client}
}

type appHandler func(http.ResponseWriter, *http.Request) (interface{}, *Error)

func (fn appHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	data, e := fn(w, r)
	if e != nil { // e is *Error, not os.Error.
		if e.err != nil {
			log.Print(e.err)
		}
		out, err := json.Marshal(e)
		if err != nil {
			panic(err)
		}
		w.WriteHeader(e.Status)
		w.Write(out)
	} else {
		out, err := json.Marshal(data)
		if err != nil {
			panic(err)
		}
		w.Write(out)
	}
}

func requestFilter(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Content-Type", "application/json")
		}
		next.ServeHTTP(w, r)
	})
}

// Handler returns a handler for the API.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/api/v1/state/", appHandler(s.StateHandler))
	// Return 404 in JSON for all unknown requests under /api/
	mux.Handle("/api/", appHandler(s.NotFoundHandler))
	if s.StaticDir != "" {
		fs := http.FileServer(http.Dir(s.StaticDir))
		mux.Handle("/", fs)
	}
	return requestFilter(mux)
}

// ListenAndServe listens on the TCP network address addr and serves the API.
func (s *Server) ListenAndServe(addr string) error {
	return http.ListenAndServe(addr, s.Handler())
}
