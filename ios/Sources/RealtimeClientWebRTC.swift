import AVFoundation
import Foundation
import WebRTC

/// WebRTC-based client for OpenAI Realtime API. This is the production path.
///
/// Why WebRTC vs raw WebSocket: OpenAI's official guidance (platform.openai.com/
/// docs/guides/realtime-webrtc) recommends WebRTC for browser/mobile clients —
/// the iOS WebRTC framework handles audio capture, AEC (Google AEC3), AGC,
/// noise suppression, jitter buffering, and codec negotiation. The raw-WS path
/// requires reimplementing all of that and produces self-interrupting feedback
/// loops on speakerphone (which we hit on 2026-04-26).
///
/// Reference: PallavAg/VoiceModeWebRTCSwift (2024), m1guelpf/swift-realtime-openai.
@MainActor
final class RealtimeClientWebRTC: NSObject, ObservableObject {
    enum ConnectionState: String {
        case idle, connecting, connected, error, closed
    }

    enum MicPermission: String {
        case undetermined, denied, granted
    }

    struct TranscriptTurn: Identifiable, Equatable {
        enum Role: String {
            case user
            case assistant
        }

        let id: String
        let role: Role
        var text: String
        var isCurrent: Bool
        let ts: TimeInterval
    }

    // Mirrors the WS-based RealtimeClient's @Published surface so VoiceCallView
    // and PollClient.state can read either implementation interchangeably.
    @Published var state: ConnectionState = .idle { didSet { reportState(reason: "state_change") } }
    @Published var lastError: String? { didSet { reportState(reason: "error") } }
    @Published var lastUserUtterance: String = "" { didSet { reportState(reason: "user_transcript") } }
    @Published var lastAssistantText: String = "" { didSet { reportState(reason: "assistant_text") } }
    @Published var isAssistantSpeaking: Bool = false { didSet { reportState(reason: "speaking") } }
    @Published var micPermission: MicPermission = .undetermined
    @Published var dataChannelOpen: Bool = false
    @Published var iceConnectionState: String = "new"
    @Published var manualInputTurns: Bool = false { didSet { reportState(reason: "manual_input_turns") } }
    @Published var isMicrophoneOpen: Bool = false { didSet { reportState(reason: "mic_gate") } }
    @Published var assistantPlaybackCoolingDown: Bool = false { didSet { reportState(reason: "playback_cooldown") } }
    @Published var isListeningPaused: Bool = false { didSet { reportState(reason: "listening_paused") } }
    @Published var transcriptTurns: [TranscriptTurn] = []
    @Published var transcriptSaveStatus: String = ""

    private var bridgeBase: String { VoxRuntimeConfig.bridgeBase }

    /// Single shared factory — RTCPeerConnectionFactory is heavy and meant to
    /// outlive individual peer connections.
    private static let factory: RTCPeerConnectionFactory = {
        RTCInitializeSSL()
        return RTCPeerConnectionFactory()
    }()

    private var peerConnection: RTCPeerConnection?
    private var dataChannel: RTCDataChannel?
    private var audioTrack: RTCAudioTrack?
    private var assistantBuffer: String = ""
    private var responseActive: Bool = false
    private var pendingResponseCreate: Bool = false
    private var responseWatchdogGeneration: Int = 0
    private var inputCommitFallbackGeneration: Int = 0
    private var inputCommitFallbackScheduled: Bool = false
    private var inputCommitFallbackResponded: Bool = false
    private var inputCommitDuringAssistantOutput: Bool = false
    private var inputCommitEchoText: String = ""
    private var assistantOutputActive: Bool = false
    private var assistantEchoText: String = ""
    private var serverCreatesResponses: Bool = false
    private var manualInputTurnActive: Bool = false
    private var activeAssistantTurnId: String?
    private var pendingUserTranscriptBeforeAssistant: Bool = false
    private var pendingUserTranscriptInsertionIndex: Int?
    private var pendingUserTranscriptTimestamp: TimeInterval?
    private var pendingUserTranscriptGeneration: Int = 0
    private var assistantPlaybackCooldownGeneration: Int = 0
    private let assistantPlaybackCooldownMs: Int = 2200
    private let assistantEchoGuardMs: Int = 5000
    private var assistantEchoGuardUntil: TimeInterval = 0
    private var reconnectGeneration: Int = 0
    private var sessionId: String = UUID().uuidString
    private var sessionStartedAt: Date?
    private var sessionEvents: [[String: Any]] = []
    private var transcriptSavedForSessionId: String?
    private var transcriptSaveInFlight: Bool = false

    /// Bumped on disconnect / new connect attempt. Lets a connect() resumed
    /// from suspension see that the user has moved on, and abort instead of
    /// resurrecting a closed session. Codex review caught this race.
    private var connectGeneration: Int = 0
    /// True from the moment disconnect() is entered until the next connect()
    /// starts. Used to suppress ICE .closed → .error transitions that fire
    /// as a side-effect of intentional peerConnection.close().
    private var disconnecting: Bool = false

    override init() {
        super.init()
        refreshMicPermission()
    }

    // MARK: - public

    func connect() async {
        guard state == .idle || state == .closed || state == .error else { return }
        log("connect: starting")

        connectGeneration &+= 1
        let myGen = connectGeneration
        disconnecting = false
        isListeningPaused = false
        beginSessionTranscriptCapture()

        if !(await ensureMicPermission()) {
            lastError = "Microphone access denied. Open Settings → Vox → Microphone to enable."
            state = .error
            return
        }
        // disconnect() may have run while we awaited the permission prompt.
        guard myGen == connectGeneration else { log("connect aborted: superseded after permission prompt"); return }

        state = .connecting
        lastError = nil

        do {
            configureAudioSession()
            let token = try await fetchEphemeralKey()
            guard myGen == connectGeneration else { log("connect aborted: superseded after fetchEphemeralKey"); return }
            try await setupPeerConnection(ephemeralKey: token)
            guard myGen == connectGeneration else {
                log("connect aborted: superseded after setupPeerConnection — tearing down")
                cleanup()
                return
            }
        } catch {
            log("connect failed: \(error.localizedDescription)")
            lastError = error.localizedDescription
            state = .error
            cleanup()
        }
    }

    func disconnect() {
        disconnect(saveTranscript: true)
    }

    private func disconnect(saveTranscript: Bool) {
        log("disconnect")
        if saveTranscript {
            queueSessionTranscriptSave(reason: "disconnect")
        }
        // Bump generation FIRST so any in-flight connect() suspended on an
        // await sees myGen != current and aborts on resume. Without this, a
        // user-initiated disconnect mid-connect can be undone by the older
        // task installing a new peerConnection.
        connectGeneration &+= 1
        disconnecting = true
        cleanup()
        state = .closed
    }

    func restartConversationSession() async {
        log("restart conversation session")
        queueSessionTranscriptSave(reason: "restart")
        disconnect(saveTranscript: false)
        transcriptTurns = []
        lastUserUtterance = ""
        lastAssistantText = ""
        lastError = nil
        await connect()
    }

    func ensureMicPermission() async -> Bool {
        switch AVAudioApplication.shared.recordPermission {
        case .granted: micPermission = .granted; return true
        case .denied: micPermission = .denied; return false
        case .undetermined:
            let granted = await AVAudioApplication.requestRecordPermission()
            micPermission = granted ? .granted : .denied
            return granted
        @unknown default:
            micPermission = .denied; return false
        }
    }

    func snapshot() -> [String: Any] {
        let route = AVAudioSession.sharedInstance().currentRoute
        let inDesc = route.inputs.map { "\($0.portType.rawValue):\($0.portName)" }.joined(separator: ",")
        let outDesc = route.outputs.map { "\($0.portType.rawValue):\($0.portName)" }.joined(separator: ",")
        return [
            "transport": "webrtc",
            "state": state.rawValue,
            "lastError": lastError ?? "",
            "lastUserUtterance": lastUserUtterance,
            "lastAssistantText": lastAssistantText,
            "isAssistantSpeaking": isAssistantSpeaking,
            "ts": Date().timeIntervalSince1970,
            "micPermission": micPermission.rawValue,
            "audioRouteIn": inDesc,
            "audioRouteOut": outDesc,
            "dataChannelOpen": dataChannelOpen,
            "iceConnectionState": iceConnectionState,
            "manualInputTurns": manualInputTurns,
            "isMicrophoneOpen": isMicrophoneOpen,
            "assistantPlaybackCoolingDown": assistantPlaybackCoolingDown,
            "isListeningPaused": isListeningPaused,
            "transcriptTurnCount": transcriptTurns.count,
            "transcriptSaveStatus": transcriptSaveStatus,
            "transcriptTurns": transcriptTurns.suffix(12).map { turn in
                [
                    "role": turn.role.rawValue,
                    "text": turn.text,
                    "isCurrent": turn.isCurrent,
                    "ts": turn.ts,
                ] as [String: Any]
            },
        ]
    }

    // MARK: - WebRTC setup

    private func configureAudioSession() {
        // .videoChat enables Voice Processing IO (AEC + AGC + noise suppression).
        // .defaultToSpeaker is honored at category level but VPIO overrides it
        // and routes to the earpiece (Receiver) — unless we explicitly call
        // overrideOutputAudioPort(.speaker) AFTER setActive. Without the
        // override the assistant audio plays through the receiver and the user
        // can't hear it across the table.
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, options: [.defaultToSpeaker, .allowBluetooth])
            try session.setMode(.videoChat)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
            try session.overrideOutputAudioPort(.speaker)
            log("audio session: cat=\(session.category.rawValue) mode=\(session.mode.rawValue) routedToSpeaker=true")
        } catch {
            log("audio session config failed: \(error)")
        }
    }

    private func fetchEphemeralKey() async throws -> String {
        let requestedManualInputTurns = false
        let requestedClientResponseCreate = false
        var req = URLRequest(url: URL(string: "\(bridgeBase)/voice/session")!)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = #"{"client_response_create":false,"manual_input_turns":false}"#.data(using: .utf8)
        req.timeoutInterval = 10
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, http.statusCode == 200 else {
            throw NSError(domain: "Vox", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "bridge /voice/session HTTP \((resp as? HTTPURLResponse)?.statusCode ?? -1)",
            ])
        }
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        serverCreatesResponses = (json?["vox_server_creates_responses"] as? Bool) ?? !requestedClientResponseCreate
        // Older bridges may accept the request body but omit the manual-turn
        // echo flag. Keep the iOS interaction in the mode it requested unless
        // the bridge explicitly reports otherwise.
        manualInputTurns = (json?["vox_manual_input_turns"] as? Bool) ?? requestedManualInputTurns
        let directValue = json?["value"] as? String
        let secret = json?["client_secret"] as? [String: Any]
        let nestedValue = secret?["value"] as? String
        guard let value = directValue ?? nestedValue else {
            throw NSError(domain: "Vox", code: 2, userInfo: [
                NSLocalizedDescriptionKey: "client_secret missing in bridge response",
            ])
        }
        return value
    }

    private func setupPeerConnection(ephemeralKey: String) async throws {
        let config = RTCConfiguration()
        config.sdpSemantics = .unifiedPlan
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)

        guard let pc = Self.factory.peerConnection(with: config, constraints: constraints, delegate: self) else {
            throw NSError(domain: "Vox", code: 3, userInfo: [
                NSLocalizedDescriptionKey: "failed to create RTCPeerConnection",
            ])
        }
        self.peerConnection = pc

        // Local audio track with AEC + AGC + noise suppression — these flags map
        // to libwebrtc's AEC3 + AGC1 + NS pipeline. Standard reference settings.
        let audioConstraints = RTCMediaConstraints(
            mandatoryConstraints: [
                "googEchoCancellation": "true",
                "googAutoGainControl": "true",
                "googNoiseSuppression": "true",
                "googHighpassFilter": "true",
            ],
            optionalConstraints: nil
        )
        let audioSource = Self.factory.audioSource(with: audioConstraints)
        let track = Self.factory.audioTrack(with: audioSource, trackId: "vox-mic")
        track.isEnabled = false
        pc.add(track, streamIds: ["vox-stream"])
        self.audioTrack = track
        isMicrophoneOpen = false

        // Data channel for OpenAI events. Must be created BEFORE offer so it
        // gets included in SDP.
        let dcConfig = RTCDataChannelConfiguration()
        if let dc = pc.dataChannel(forLabel: "oai-events", configuration: dcConfig) {
            dc.delegate = self
            self.dataChannel = dc
        }

        // Create + post offer.
        let offerConstraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        let offer: RTCSessionDescription = try await withCheckedThrowingContinuation { cont in
            pc.offer(for: offerConstraints) { sdp, err in
                if let err { cont.resume(throwing: err); return }
                guard let sdp else {
                    cont.resume(throwing: NSError(domain: "Vox", code: 4, userInfo: [
                        NSLocalizedDescriptionKey: "no SDP from offer",
                    ]))
                    return
                }
                cont.resume(returning: sdp)
            }
        }
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            pc.setLocalDescription(offer) { err in
                if let err { cont.resume(throwing: err) } else { cont.resume() }
            }
        }

        let answerSdp = try await postOffer(sdp: offer.sdp, ephemeralKey: ephemeralKey)
        let answer = RTCSessionDescription(type: .answer, sdp: answerSdp)
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            pc.setRemoteDescription(answer) { err in
                if let err { cont.resume(throwing: err) } else { cont.resume() }
            }
        }
        log("setRemoteDescription ok — waiting for ICE/data channel")
    }

    private func postOffer(sdp: String, ephemeralKey: String) async throws -> String {
        let url = URL(string: "https://api.openai.com/v1/realtime/calls")!
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/sdp", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(ephemeralKey)", forHTTPHeaderField: "Authorization")
        req.httpBody = sdp.data(using: .utf8)
        req.timeoutInterval = 15
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let code = (resp as? HTTPURLResponse)?.statusCode ?? -1
            let body = String(data: data, encoding: .utf8) ?? ""
            throw NSError(domain: "Vox", code: 5, userInfo: [
                NSLocalizedDescriptionKey: "OpenAI SDP exchange HTTP \(code): \(body.prefix(200))",
            ])
        }
        guard let answer = String(data: data, encoding: .utf8) else {
            throw NSError(domain: "Vox", code: 6, userInfo: [
                NSLocalizedDescriptionKey: "OpenAI SDP answer not utf8",
            ])
        }
        return answer
    }

    private func cleanup() {
        peerConnection?.close()
        peerConnection = nil
        dataChannel = nil
        audioTrack = nil
        dataChannelOpen = false
        responseActive = false
        pendingResponseCreate = false
        responseWatchdogGeneration += 1
        inputCommitFallbackGeneration += 1
        inputCommitFallbackScheduled = false
        inputCommitFallbackResponded = false
        inputCommitDuringAssistantOutput = false
        inputCommitEchoText = ""
        assistantBuffer = ""
        assistantOutputActive = false
        assistantEchoText = ""
        assistantEchoGuardUntil = 0
        lastAssistantText = ""
        serverCreatesResponses = false
        manualInputTurns = false
        manualInputTurnActive = false
        isListeningPaused = false
        activeAssistantTurnId = nil
        clearPendingUserTranscriptOrder()
        assistantPlaybackCooldownGeneration += 1
        assistantPlaybackCoolingDown = false
        setMicrophoneOpen(false, reason: "cleanup")
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    // MARK: - data channel events

    private func handleDataChannelMessage(_ data: Data) {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else { return }
        recordRealtimeEvent(json, type: type)

        switch type {
        case "response.created":
            responseActive = true
            assistantOutputActive = true
            isAssistantSpeaking = true
            lastError = nil
            clearAssistantPlaybackCooldown()
            setMicrophoneOpen(false, reason: "assistant_response")
            if !inputCommitDuringAssistantOutput {
                inputCommitEchoText = ""
            }
            assistantBuffer = ""
            assistantEchoText = ""
            lastAssistantText = ""
            activeAssistantTurnId = nil
            startResponseWatchdog()
        case "response.audio_transcript.delta", "response.output_audio_transcript.delta":
            if let delta = json["delta"] as? String {
                assistantBuffer += delta
                assistantEchoText = assistantBuffer
                lastAssistantText = assistantBuffer
                updateAssistantDraft(assistantBuffer)
            }
        case "response.audio_transcript.done", "response.output_audio_transcript.done":
            // Final assistant text — push to bridge so get_app_state can see it.
            assistantEchoText = assistantBuffer
            finalizeAssistantDraft(assistantBuffer)
            rememberAssistantEchoText()
            postTranscriptToBridge(role: "assistant", text: assistantBuffer)
        case "response.audio.done", "response.output_audio.done", "response.done":
            assistantOutputActive = false
            rememberAssistantEchoText()
            if type == "response.done" {
                completeResponse()
            }
            isAssistantSpeaking = false
            startAssistantPlaybackCooldown()
        case "input_audio_buffer.committed":
            inputCommitDuringAssistantOutput = assistantOutputActive
            inputCommitEchoText = inputCommitDuringAssistantOutput ? currentAssistantEchoText() : ""
            markPendingUserTranscriptOrder()
            scheduleInputCommitFallback()
        case "conversation.item.input_audio_transcription.completed":
            let transcript = (json["transcript"] as? String) ?? ""
            let fallbackAlreadyResponded = inputCommitFallbackResponded
            clearInputCommitFallback()
            inputCommitFallbackResponded = false
            if shouldIgnoreInputTranscript(transcript) {
                if fallbackAlreadyResponded {
                    pendingResponseCreate = false
                }
                let emptyLearnerCommit = transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !inputCommitDuringAssistantOutput
                inputCommitDuringAssistantOutput = false
                inputCommitEchoText = ""
                if emptyLearnerCommit && !fallbackAlreadyResponded && !serverCreatesResponses && !manualInputTurns {
                    requestResponseCreate()
                }
                if !transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    log("ignored input transcript as assistant echo: \(transcript.prefix(80))")
                }
                clearPendingUserTranscriptOrder()
                return
            }
            lastUserUtterance = transcript
            appendTranscriptTurn(role: .user, text: transcript)
            clearPendingUserTranscriptOrder()
            lastError = nil
            postTranscriptToBridge(role: "user", text: transcript)
            inputCommitDuringAssistantOutput = false
            inputCommitEchoText = ""
            if !fallbackAlreadyResponded && !serverCreatesResponses {
                requestResponseCreate()
            }
        case "response.output_item.done":
            // Function-calling: when the model decides to call a tool the item
            // arrives here with type=function_call. Run the tool against the
            // bridge and post the output back via conversation.item.create.
            if let item = json["item"] as? [String: Any],
               let itemType = item["type"] as? String,
               itemType == "function_call",
               let name = item["name"] as? String,
               let callId = item["call_id"] as? String {
                let argsString = (item["arguments"] as? String) ?? "{}"
                Task { await self.handleFunctionCall(name: name, callId: callId, argsString: argsString) }
            }
        case "error":
            if let err = json["error"] as? [String: Any], let msg = err["message"] as? String {
                if msg.range(of: "buffer too small", options: .caseInsensitive) != nil {
                    log("ignored recoverable empty input commit: \(msg)")
                    lastError = nil
                    if state == .error { state = .connected }
                    return
                }
                if msg.range(of: "active response in progress", options: .caseInsensitive) != nil {
                    log("deferred response.create while active response in progress")
                    deferResponseCreateForActiveResponse()
                    return
                }
                if responseActive || assistantOutputActive {
                    let resumePending = pendingResponseCreate
                    assistantOutputActive = false
                    settleAssistantBuffer()
                    responseActive = false
                    pendingResponseCreate = false
                    responseWatchdogGeneration += 1
                    if resumePending {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
                            self?.requestResponseCreate()
                        }
                    }
                }
                lastError = msg
                log("server error: \(msg)")
            }
        default:
            break
        }
    }

    // MARK: - tools (function calling)

    private func handleFunctionCall(name: String, callId: String, argsString: String) async {
        log("function_call → \(name) call_id=\(callId)")
        let started = Date()
        var output = "tool returned no output"
        do {
            let body: [String: Any] = ["name": name, "arguments": argsString, "call_id": callId]
            var req = URLRequest(url: URL(string: "\(bridgeBase)/tool/call")!)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
            req.timeoutInterval = 30
            let (data, _) = try await URLSession.shared.data(for: req)
            if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
               let s = json["output"] as? String {
                output = s
            } else {
                output = String(data: data, encoding: .utf8) ?? "(non-utf8 tool response)"
            }
        } catch {
            output = "tool error: \(error.localizedDescription)"
            log("function_call \(name) error: \(error.localizedDescription)")
        }
        let elapsed = Int(Date().timeIntervalSince(started) * 1000)
        log("function_call ← \(name) \(elapsed)ms output.len=\(output.count)")
        sendFunctionCallOutput(callId: callId, output: output)
    }

    private func sendFunctionCallOutput(callId: String, output: String) {
        sendDataChannelJSON([
            "type": "conversation.item.create",
            "item": [
                "type": "function_call_output",
                "call_id": callId,
                "output": output,
            ],
        ])
        // Tell the model to continue (it now has a tool result to react to).
        requestResponseCreate()
    }

    // MARK: - external triggers (bridge → iPhone push patterns)

    /// Bridge calls this via PollClient `inject_realtime_message` after an
    /// async tool (codex) finishes. We push a user-style message into the
    /// conversation and request a response so the model voice-reports it.
    ///
    /// If a response is already in progress (model is mid-turn), enqueue the
    /// item and defer `response.create` until `response.done`; otherwise OpenAI
    /// returns "Conversation already has an active response in progress".
    func injectUserMessage(_ text: String) {
        log("injectUserMessage len=\(text.count) speaking=\(isAssistantSpeaking)")
        sendDataChannelJSON([
            "type": "conversation.item.create",
            "item": [
                "type": "message",
                "role": "user",
                "content": [["type": "input_text", "text": text]],
            ],
        ])
        requestResponseCreate()
    }

    func pauseListening() {
        isListeningPaused = true
        if manualInputTurns {
            cancelManualInputTurn()
        } else {
            setMicrophoneOpen(false, reason: "pause")
        }
    }

    func resumeListening() {
        guard state == .connected else { return }
        isListeningPaused = false
        syncContinuousListeningGate(reason: "resume")
    }

    func canBeginManualInputTurn() -> Bool {
        manualInputTurns &&
            state == .connected &&
            dataChannel?.readyState == .open &&
            !responseActive &&
            !assistantOutputActive &&
            !pendingResponseCreate &&
            !assistantPlaybackCoolingDown
    }

    @discardableResult
    func beginManualInputTurn() -> Bool {
        guard canBeginManualInputTurn() else {
            log("beginManualInputTurn refused")
            return false
        }
        clearInputCommitFallback()
        inputCommitFallbackResponded = false
        inputCommitDuringAssistantOutput = false
        inputCommitEchoText = ""
        sendDataChannelJSON(["type": "input_audio_buffer.clear"])
        manualInputTurnActive = true
        setMicrophoneOpen(true, reason: "manual_turn_start")
        return true
    }

    @discardableResult
    func finishManualInputTurn() -> Bool {
        guard manualInputTurns, manualInputTurnActive, isMicrophoneOpen else {
            log("finishManualInputTurn refused")
            return false
        }
        manualInputTurnActive = false
        setMicrophoneOpen(false, reason: "manual_turn_send")
        clearInputCommitFallback()
        inputCommitFallbackResponded = false
        sendDataChannelJSON(["type": "input_audio_buffer.commit"])
        return true
    }

    func cancelManualInputTurn() {
        guard manualInputTurnActive || isMicrophoneOpen else { return }
        manualInputTurnActive = false
        setMicrophoneOpen(false, reason: "manual_turn_cancel")
        sendDataChannelJSON(["type": "input_audio_buffer.clear"])
        clearInputCommitFallback()
    }

    /// Bridge calls this via PollClient `update_session_instructions` after
    /// update_system_prompt tool runs. Live session config swap, no reconnect.
    func updateSessionInstructions(_ instructions: String) {
        log("updateSessionInstructions len=\(instructions.count)")
        sendDataChannelJSON([
            "type": "session.update",
            "session": ["instructions": instructions],
        ])
    }

    private func sendDataChannelJSON(_ obj: [String: Any]) {
        guard let dc = dataChannel else { log("sendDataChannelJSON: no data channel"); return }
        guard let data = try? JSONSerialization.data(withJSONObject: obj) else { return }
        let buf = RTCDataBuffer(data: data, isBinary: false)
        dc.sendData(buf)
    }

    private func requestResponseCreate() {
        if isMicrophoneOpen {
            setMicrophoneOpen(false, reason: "response_create")
        }
        guard dataChannel?.readyState == .open else {
            pendingResponseCreate = true
            return
        }
        if responseActive {
            pendingResponseCreate = true
            return
        }
        pendingResponseCreate = false
        clearInputCommitFallback()
        responseActive = true
        startResponseWatchdog()
        sendDataChannelJSON(["type": "response.create"])
    }

    private func syncContinuousListeningGate(reason: String) {
        guard !manualInputTurns else { return }
        let shouldOpen = state == .connected &&
            !isListeningPaused &&
            dataChannel?.readyState == .open &&
            !assistantOutputActive &&
            !responseActive &&
            !assistantPlaybackCoolingDown
        setMicrophoneOpen(shouldOpen, reason: reason)
    }

    private func setMicrophoneOpen(_ open: Bool, reason: String) {
        audioTrack?.isEnabled = open
        isMicrophoneOpen = open && audioTrack != nil
        log("mic gate: \(isMicrophoneOpen ? "open" : "closed") reason=\(reason)")
    }

    private func startAssistantPlaybackCooldown() {
        guard state == .connected else { return }
        extendAssistantEchoGuard()
        assistantPlaybackCooldownGeneration += 1
        let generation = assistantPlaybackCooldownGeneration
        assistantPlaybackCoolingDown = true
        setMicrophoneOpen(false, reason: "playback_cooldown")
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(assistantPlaybackCooldownMs)) { [weak self] in
            guard let self else { return }
            guard self.assistantPlaybackCooldownGeneration == generation else { return }
            self.assistantPlaybackCoolingDown = false
            self.syncContinuousListeningGate(reason: "playback_cooldown_done")
        }
    }

    private func clearAssistantPlaybackCooldown() {
        assistantPlaybackCooldownGeneration += 1
        assistantPlaybackCoolingDown = false
        syncContinuousListeningGate(reason: "clear_playback_cooldown")
    }

    private func completeResponse() {
        responseActive = false
        responseWatchdogGeneration += 1
        if pendingResponseCreate {
            requestResponseCreate()
        } else {
            syncContinuousListeningGate(reason: "response_done")
        }
    }

    private func deferResponseCreateForActiveResponse() {
        responseActive = true
        pendingResponseCreate = true
        startResponseWatchdog()
    }

    private func scheduleReconnect(reason: String) {
        guard !disconnecting else { return }
        reconnectGeneration += 1
        let generation = reconnectGeneration
        log("schedule reconnect: \(reason)")
        lastError = nil
        disconnecting = true
        cleanup()
        disconnecting = false
        state = .closed
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in
            guard let self else { return }
            guard self.reconnectGeneration == generation else { return }
            Task { await self.connect() }
        }
    }

    private func startResponseWatchdog() {
        responseWatchdogGeneration += 1
        let generation = responseWatchdogGeneration
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in
            guard let self else { return }
            guard self.responseActive, self.responseWatchdogGeneration == generation else { return }
            self.responseActive = false
            self.assistantOutputActive = false
            self.rememberAssistantEchoText()
            self.log("response watchdog: response.done timeout")
            if self.pendingResponseCreate {
                self.requestResponseCreate()
            }
        }
    }

    private func scheduleInputCommitFallback() {
        inputCommitFallbackResponded = false
        inputCommitFallbackGeneration += 1
        inputCommitFallbackScheduled = true
        if serverCreatesResponses {
            inputCommitFallbackScheduled = false
            return
        }
        let generation = inputCommitFallbackGeneration
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.8) { [weak self] in
            guard let self else { return }
            guard self.inputCommitFallbackGeneration == generation,
                  self.inputCommitFallbackScheduled,
                  self.dataChannel?.readyState == .open else { return }
            self.inputCommitFallbackScheduled = false
            if self.inputCommitDuringAssistantOutput { return }
            if self.assistantOutputActive || self.responseActive {
                self.inputCommitFallbackResponded = true
                self.pendingResponseCreate = true
                return
            }
            self.inputCommitFallbackResponded = true
            self.requestResponseCreate()
        }
    }

    private func clearInputCommitFallback() {
        inputCommitFallbackGeneration += 1
        inputCommitFallbackScheduled = false
    }

    private func markPendingUserTranscriptOrder() {
        pendingUserTranscriptBeforeAssistant = true
        pendingUserTranscriptInsertionIndex = transcriptTurns.count
        pendingUserTranscriptTimestamp = Date().timeIntervalSince1970
        pendingUserTranscriptGeneration += 1
        let generation = pendingUserTranscriptGeneration
        DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in
            guard let self else { return }
            guard self.pendingUserTranscriptGeneration == generation else { return }
            self.pendingUserTranscriptBeforeAssistant = false
            self.pendingUserTranscriptInsertionIndex = nil
            self.pendingUserTranscriptTimestamp = nil
        }
    }

    private func clearPendingUserTranscriptOrder() {
        pendingUserTranscriptGeneration += 1
        pendingUserTranscriptBeforeAssistant = false
        pendingUserTranscriptInsertionIndex = nil
        pendingUserTranscriptTimestamp = nil
    }

    private func settleAssistantBuffer() {
        if !assistantBuffer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            finalizeAssistantDraft(assistantBuffer)
            postTranscriptToBridge(role: "assistant", text: assistantBuffer)
            lastAssistantText = assistantBuffer
            assistantEchoText = assistantBuffer
            rememberAssistantEchoText()
        }
        assistantBuffer = ""
        isAssistantSpeaking = false
    }

    private func shouldIgnoreInputTranscript(_ transcript: String) -> Bool {
        let text = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return true }
        let echoWindowActive = assistantOutputActive ||
            inputCommitDuringAssistantOutput ||
            Date().timeIntervalSince1970 <= assistantEchoGuardUntil
        if echoWindowActive && isLikelyAssistantEcho(text, currentAssistantEchoText()) { return true }
        return false
    }

    private func extendAssistantEchoGuard() {
        assistantEchoGuardUntil = Date().timeIntervalSince1970 + Double(assistantEchoGuardMs) / 1000
    }

    private func isLikelyAssistantEcho(_ inputValue: String, _ assistantValue: String) -> Bool {
        let input = normalizeSpeechText(inputValue)
        let assistant = normalizeSpeechText(assistantValue)
        if input.isEmpty || assistant.isEmpty { return false }
        let minLength = containsCompactSpeechScript(input) ? 5 : 8
        if input.count < minLength { return false }
        let assistantLength = containsCompactSpeechScript(assistant) ? 8 : 24
        return assistant == input ||
            assistant.hasPrefix(input) ||
            (assistant.count >= assistantLength && hasOrderedSpeechTokenMatch(input, assistant)) ||
            (assistant.count >= assistantLength &&
                input.hasPrefix(assistant) &&
                isShortSpeechArtifact(String(input.dropFirst(assistant.count))))
    }

    private func hasOrderedSpeechTokenMatch(_ input: String, _ assistant: String) -> Bool {
        let inputTokens = input.split(separator: " ").map(String.init)
        let assistantTokens = assistant.split(separator: " ").map(String.init)
        if inputTokens.count < 3 || assistantTokens.count < inputTokens.count { return false }
        var cursor = 0
        for token in assistantTokens {
            if token == inputTokens[cursor] {
                cursor += 1
                if cursor == inputTokens.count { return true }
            }
        }
        return false
    }

    private func isShortSpeechArtifact(_ value: String) -> Bool {
        let artifact = normalizeSpeechText(value)
        if artifact.isEmpty { return true }
        return artifact.count <= 8 && artifact.split(separator: " ").count <= 2
    }

    private func currentAssistantEchoText() -> String {
        if !inputCommitEchoText.isEmpty { return inputCommitEchoText }
        if !assistantBuffer.isEmpty { return assistantBuffer }
        if !assistantEchoText.isEmpty { return assistantEchoText }
        return lastAssistantText
    }

    private func rememberAssistantEchoText() {
        let text = currentAssistantEchoText().trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        assistantEchoText = text
    }

    private func appendTranscriptTurn(role: TranscriptTurn.Role, text: String, isCurrent: Bool = false) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let timestamp = (role == .user ? pendingUserTranscriptTimestamp : nil) ?? Date().timeIntervalSince1970
        let turn = TranscriptTurn(
            id: "\(role.rawValue)-\(Int(timestamp * 1000))-\(transcriptTurns.count)",
            role: role,
            text: trimmed,
            isCurrent: isCurrent,
            ts: timestamp
        )
        if role == .user && pendingUserTranscriptBeforeAssistant,
           let insertionIndex = pendingUserTranscriptInsertionIndex {
            let index = max(0, min(insertionIndex, transcriptTurns.count))
            transcriptTurns.insert(turn, at: index)
        } else {
            transcriptTurns.append(turn)
        }
        if transcriptTurns.count > 80 {
            transcriptTurns = Array(transcriptTurns.suffix(80))
        }
    }

    private func updateAssistantDraft(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        if let id = activeAssistantTurnId,
           let index = transcriptTurns.firstIndex(where: { $0.id == id }) {
            transcriptTurns[index].text = trimmed
            transcriptTurns[index].isCurrent = true
            return
        }
        let id = "assistant-\(Int(Date().timeIntervalSince1970 * 1000))-\(transcriptTurns.count)"
        activeAssistantTurnId = id
        transcriptTurns.append(.init(
            id: id,
            role: .assistant,
            text: trimmed,
            isCurrent: true,
            ts: Date().timeIntervalSince1970
        ))
        if transcriptTurns.count > 80 {
            transcriptTurns = Array(transcriptTurns.suffix(80))
        }
    }

    private func finalizeAssistantDraft(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            activeAssistantTurnId = nil
            return
        }
        updateAssistantDraft(trimmed)
        if let id = activeAssistantTurnId,
           let index = transcriptTurns.firstIndex(where: { $0.id == id }) {
            transcriptTurns[index].isCurrent = false
        }
        activeAssistantTurnId = nil
    }

    private func containsCompactSpeechScript(_ value: String) -> Bool {
        for scalar in value.unicodeScalars {
            let codepoint = Int(scalar.value)
            if (0x3400...0x4DBF).contains(codepoint) ||
                (0x4E00...0x9FFF).contains(codepoint) ||
                (0xF900...0xFAFF).contains(codepoint) ||
                (0x20000...0x2A6DF).contains(codepoint) ||
                (0x2A700...0x2B73F).contains(codepoint) ||
                (0x2B740...0x2B81F).contains(codepoint) ||
                (0x2B820...0x2CEAF).contains(codepoint) ||
                (0x1100...0x11FF).contains(codepoint) ||
                (0x3130...0x318F).contains(codepoint) ||
                (0xA960...0xA97F).contains(codepoint) ||
                (0xD7B0...0xD7FF).contains(codepoint) ||
                (0x3040...0x30FF).contains(codepoint) ||
                (0xAC00...0xD7AF).contains(codepoint) ||
                (0x0E00...0x0E7F).contains(codepoint) ||
                (0x0E80...0x0EFF).contains(codepoint) ||
                (0x1000...0x109F).contains(codepoint) ||
                (0x1780...0x17FF).contains(codepoint) ||
                (0x0590...0x05FF).contains(codepoint) ||
                (0x0600...0x06FF).contains(codepoint) ||
                (0x0750...0x077F).contains(codepoint) ||
                (0x08A0...0x08FF).contains(codepoint) ||
                (0xFB50...0xFDFF).contains(codepoint) ||
                (0xFE70...0xFEFF).contains(codepoint) ||
                (0x0900...0x097F).contains(codepoint) ||
                (0x0980...0x09FF).contains(codepoint) ||
                (0x0A00...0x0A7F).contains(codepoint) ||
                (0x0A80...0x0AFF).contains(codepoint) ||
                (0x0B00...0x0B7F).contains(codepoint) ||
                (0x0B80...0x0BFF).contains(codepoint) ||
                (0x0C00...0x0C7F).contains(codepoint) ||
                (0x0C80...0x0CFF).contains(codepoint) ||
                (0x0D00...0x0D7F).contains(codepoint) ||
                (0x0D80...0x0DFF).contains(codepoint) {
                return true
            }
        }
        return false
    }

    private func normalizeSpeechText(_ value: String) -> String {
        var normalized = ""
        for scalar in value.lowercased().unicodeScalars {
            if CharacterSet.alphanumerics.contains(scalar) || CharacterSet.whitespacesAndNewlines.contains(scalar) {
                normalized.unicodeScalars.append(scalar)
            } else {
                normalized.append(" ")
            }
        }
        return normalized.split(separator: " ").joined(separator: " ")
    }

    private func postTranscriptToBridge(role: String, text: String) {
        guard !text.isEmpty else { return }
        let body: [String: Any] = [
            "transcript_append": [["role": role, "text": text, "ts": Int(Date().timeIntervalSince1970 * 1000)]],
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: body),
              let url = URL(string: "\(bridgeBase)/test/app-state") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = data
        URLSession.shared.dataTask(with: req).resume()
    }

    private func beginSessionTranscriptCapture() {
        sessionId = UUID().uuidString
        sessionStartedAt = Date()
        sessionEvents = []
        transcriptSavedForSessionId = nil
        transcriptSaveInFlight = false
        transcriptSaveStatus = "Transcript saves when you end."
    }

    private func queueSessionTranscriptSave(reason: String) {
        guard !transcriptSaveInFlight else { return }
        guard transcriptSavedForSessionId != sessionId else { return }
        guard let data = sessionTranscriptPayload(reason: reason) else {
            if !transcriptTurns.isEmpty {
                transcriptSaveStatus = "Transcript save failed."
            }
            return
        }
        transcriptSaveInFlight = true
        transcriptSaveStatus = "Saving transcript..."
        let savedSessionId = sessionId
        Task { [weak self] in
            await self?.postSessionTranscript(data, savedSessionId: savedSessionId)
        }
    }

    private func sessionTranscriptPayload(reason: String) -> Data? {
        let turns = transcriptTurns
            .filter { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            .map { turn in
                [
                    "id": turn.id,
                    "role": turn.role.rawValue,
                    "text": turn.text,
                    "ts": Int(turn.ts * 1000),
                ] as [String: Any]
            }
        guard !turns.isEmpty else { return nil }
        let endedAt = Date()
        let startedAt = sessionStartedAt ?? endedAt
        let payload: [String: Any] = [
            "source": "ios",
            "reason": reason,
            "session_id": sessionId,
            "started_at": iso8601(startedAt),
            "ended_at": iso8601(endedAt),
            "duration_ms": Int(endedAt.timeIntervalSince(startedAt) * 1000),
            "transcript": turns,
            "events": sessionEvents,
        ]
        return try? JSONSerialization.data(withJSONObject: payload)
    }

    private func postSessionTranscript(_ data: Data, savedSessionId: String) async {
        defer { transcriptSaveInFlight = false }
        guard let url = URL(string: "\(bridgeBase)/api/session-transcript") else {
            transcriptSaveStatus = "Transcript save failed."
            return
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = data
        do {
            let (_, resp) = try await URLSession.shared.data(for: req)
            guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                let code = (resp as? HTTPURLResponse)?.statusCode ?? -1
                log("transcript save failed: HTTP \(code)")
                transcriptSaveStatus = "Transcript save failed."
                return
            }
            transcriptSavedForSessionId = savedSessionId
            transcriptSaveStatus = sessionId == savedSessionId ? "Transcript saved." : "Previous transcript saved."
        } catch {
            log("transcript save failed: \(error.localizedDescription)")
            transcriptSaveStatus = "Transcript save failed."
        }
    }

    private func recordRealtimeEvent(_ event: [String: Any], type: String) {
        if type == "response.audio.delta" || type == "response.output_audio.delta" { return }
        var entry: [String: Any] = [
            "type": String(type.prefix(96)),
            "ts": Int(Date().timeIntervalSince1970 * 1000),
        ]
        if let text = event["transcript"] as? String ?? event["text"] as? String ?? event["delta"] as? String,
           !text.isEmpty {
            entry["text"] = String(text.prefix(1000))
        }
        if let error = event["error"] as? [String: Any],
           let message = error["message"] as? String,
           !message.isEmpty {
            entry["message"] = String(message.prefix(1000))
        } else if let message = event["message"] as? String, !message.isEmpty {
            entry["message"] = String(message.prefix(1000))
        }
        sessionEvents.append(entry)
        if sessionEvents.count > 300 {
            sessionEvents = Array(sessionEvents.suffix(300))
        }
    }

    private func iso8601(_ date: Date) -> String {
        ISO8601DateFormatter().string(from: date)
    }

    // MARK: - permission + diagnostics

    private func refreshMicPermission() {
        switch AVAudioApplication.shared.recordPermission {
        case .granted: micPermission = .granted
        case .denied: micPermission = .denied
        case .undetermined: micPermission = .undetermined
        @unknown default: micPermission = .undetermined
        }
    }

    private func reportState(reason: String) {
        let body: [String: Any] = [
            "state": state.rawValue,
            "reason": reason,
            "user_transcript": lastUserUtterance,
            "assistant_transcript": lastAssistantText,
            "is_assistant_speaking": isAssistantSpeaking,
            "error": lastError ?? "",
            "ts": Date().timeIntervalSince1970,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: body),
              let url = URL(string: "\(bridgeBase)/test/state") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = data
        URLSession.shared.dataTask(with: req).resume()
    }

    private func log(_ msg: String) {
        let line = "[RealtimeClientWebRTC] \(msg)"
        print(line)
        guard let url = URL(string: "\(bridgeBase)/upload/log"),
              let body = try? JSONSerialization.data(withJSONObject: ["lines": [line]]) else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = body
        URLSession.shared.dataTask(with: req).resume()
    }
}

// MARK: - RTCPeerConnectionDelegate

extension RealtimeClientWebRTC: RTCPeerConnectionDelegate {
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCSignalingState) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    nonisolated func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}

    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {
        let label: String
        switch newState {
        case .new: label = "new"
        case .checking: label = "checking"
        case .connected: label = "connected"
        case .completed: label = "completed"
        case .failed: label = "failed"
        case .disconnected: label = "disconnected"
        case .closed: label = "closed"
        case .count: label = "count"
        @unknown default: label = "unknown"
        }
        Task { @MainActor in
            self.iceConnectionState = label
            self.log("ICE: \(label)")
            // If user just called disconnect(), peerConnection.close() will fire
            // a .closed callback as a side effect. Don't promote that to .error
            // — the state is already .closed and meant to stay there.
            if self.disconnecting { return }
            switch newState {
            case .connected, .completed:
                self.state = .connected
                self.lastError = nil
                self.syncContinuousListeningGate(reason: "ice_\(label)")
            case .failed:
                self.scheduleReconnect(reason: "ice_failed")
            case .closed:
                // Genuine remote-side close (not user-initiated): treat as closed.
                self.state = .closed
            case .disconnected:
                // Often transient — leave .connected and let WebRTC heal, only
                // demote if it stays disconnected. (No timer for now; observable.)
                break
            default: break
            }
        }
    }

    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {
        Task { @MainActor in
            self.dataChannel = dataChannel
            dataChannel.delegate = self
            self.log("remote-opened data channel: \(dataChannel.label)")
        }
    }
}

// MARK: - RTCDataChannelDelegate

extension RealtimeClientWebRTC: RTCDataChannelDelegate {
    nonisolated func dataChannelDidChangeState(_ dataChannel: RTCDataChannel) {
        let isOpen = dataChannel.readyState == .open
        Task { @MainActor in
            self.dataChannelOpen = isOpen
            self.log("data channel state: \(dataChannel.readyState.rawValue) open=\(isOpen)")
            if isOpen, self.pendingResponseCreate, !self.responseActive {
                self.requestResponseCreate()
            }
            self.syncContinuousListeningGate(reason: isOpen ? "data_channel_open" : "data_channel_closed")
        }
    }

    nonisolated func dataChannel(_ dataChannel: RTCDataChannel, didReceiveMessageWith buffer: RTCDataBuffer) {
        let data = buffer.data
        Task { @MainActor in self.handleDataChannelMessage(data) }
    }
}
