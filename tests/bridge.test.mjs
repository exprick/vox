import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { authenticateRequest, authConfig, publicAuthConfig } from '../src/bridge/auth.mjs';
import { listRecordings, saveRecording } from '../src/bridge/recordings.mjs';
import {
  realtimeInputNoiseReductionConfig,
  normalizeSubtitleTargetLanguage,
  realtimeSessionConfig,
  realtimeTurnDetectionConfig,
} from '../src/bridge/voice.mjs';

test('auth can be explicitly disabled for local development', async (t) => {
  t.after(withEnv({
    VOX_AUTH_REQUIRED: '0',
    SUPABASE_URL: '',
    SUPABASE_ANON_KEY: '',
    VOX_ALLOWED_EMAILS: '',
    VOX_ALLOWED_DOMAINS: '',
  }));
  const user = await authenticateRequest({ headers: {} });
  assert.equal(user.email, 'dev@local.vox');
  assert.equal(user.provider, 'dev');
  assert.equal(user.safetyIdentifier.length, 64);
});

test('public auth config exposes only browser-safe fields', (t) => {
  t.after(withEnv({
    VOX_AUTH_REQUIRED: '1',
    SUPABASE_URL: 'https://example.supabase.co/',
    SUPABASE_ANON_KEY: 'anon-public-key',
    VOX_ALLOWED_EMAILS: 'rick@exp.game',
    VOX_ALLOWED_DOMAINS: '',
  }));
  const cfg = publicAuthConfig();
  assert.equal(cfg.required, true);
  assert.equal(cfg.configured, true);
  assert.equal(cfg.supabaseUrl, 'https://example.supabase.co');
  assert.equal(cfg.supabaseAnonKey, 'anon-public-key');
  assert.equal(cfg.allowlistConfigured, true);
  assert.deepEqual(Object.keys(cfg).sort(), [
    'allowlistConfigured',
    'configured',
    'provider',
    'required',
    'supabaseAnonKey',
    'supabaseUrl',
  ]);
  assert.equal(Object.hasOwn(cfg, 'allowedEmails'), false);
  assert.equal(Object.hasOwn(cfg, 'allowedDomains'), false);
  assert.deepEqual(authConfig().allowedEmails, ['rick@exp.game']);
});

test('realtime session config follows OpenAI voice-agent defaults', () => {
  const { session, model, voice } = realtimeSessionConfig({
    instructions: 'Test instructions',
    clientResponseCreate: true,
    warn: () => {},
  }, {});

  assert.equal(model, 'gpt-realtime-2');
  assert.equal(voice, 'marin');
  assert.equal(session.type, 'realtime');
  assert.deepEqual(session.output_modalities, ['audio']);
  assert.deepEqual(session.reasoning, { effort: 'low' });
  assert.deepEqual(session.audio.input.format, { type: 'audio/pcm', rate: 24000 });
  assert.deepEqual(session.audio.input.noise_reduction, { type: 'far_field' });
  assert.deepEqual(session.audio.output.format, { type: 'audio/pcm', rate: 24000 });
  assert.equal(session.audio.input.transcription.model, 'gpt-realtime-whisper');
  assert.deepEqual(session.audio.input.turn_detection, {
    type: 'semantic_vad',
    eagerness: 'low',
    create_response: false,
    interrupt_response: false,
  });
});

test('manual realtime input turns disable server-side turn detection', () => {
  const { session } = realtimeSessionConfig({
    instructions: 'Test instructions',
    clientResponseCreate: true,
    manualInputTurns: true,
    warn: () => {},
  }, {});

  assert.equal(session.audio.input.turn_detection, null);
});

test('realtime session config keeps explicit deployment overrides bounded', () => {
  const warnings = [];
  const { session, model, voice } = realtimeSessionConfig({
    instructions: 'Test instructions',
    warn: (message) => warnings.push(message),
  }, {
    VOX_REALTIME_MODEL: 'gpt-realtime-2',
    VOX_REALTIME_VOICE: 'cedar',
    VOX_REALTIME_REASONING_EFFORT: 'medium',
    VOX_TRANSCRIPTION_MODEL: 'gpt-4o-mini-transcribe',
    VOX_TRANSCRIPTION_LANGUAGE: 'en',
    VOX_INPUT_NOISE_REDUCTION: 'near_field',
    VOX_VAD_EAGERNESS: 'high',
  });

  assert.equal(model, 'gpt-realtime-2');
  assert.equal(voice, 'cedar');
  assert.equal(session.reasoning.effort, 'medium');
  assert.equal(session.audio.input.transcription.model, 'gpt-4o-mini-transcribe');
  assert.equal(session.audio.input.transcription.language, 'en');
  assert.deepEqual(session.audio.input.noise_reduction, { type: 'near_field' });
  assert.equal(session.audio.input.turn_detection.eagerness, 'high');
  assert.deepEqual(warnings, []);

  const fallback = realtimeSessionConfig({
    instructions: 'Test instructions',
    warn: (message) => warnings.push(message),
  }, {
    VOX_REALTIME_REASONING_EFFORT: 'maximum',
    VOX_VAD_EAGERNESS: 'fastest',
  }).session;
  assert.equal(fallback.reasoning.effort, 'low');
  assert.equal(fallback.audio.input.turn_detection.eagerness, 'low');
  assert.equal(warnings.length, 2);
  assert.ok(warnings.some((message) => message.includes('VOX_REALTIME_REASONING_EFFORT')));
  assert.ok(warnings.some((message) => message.includes('VOX_VAD_EAGERNESS')));

  const legacy = realtimeSessionConfig({
    instructions: 'Test instructions',
    warn: (message) => warnings.push(message),
  }, {
    VOX_REALTIME_MODEL: 'gpt-realtime-1.5',
    VOX_REALTIME_REASONING_EFFORT: 'xhigh',
  });
  assert.equal(legacy.model, 'gpt-realtime-1.5');
  assert.equal(legacy.session.reasoning, undefined);
  assert.equal(warnings.length, 3);
  assert.ok(warnings.some((message) => message.includes('does not support Realtime reasoning')));
});

test('realtime turn detection defaults let language learners pause', () => {
  const cfg = realtimeTurnDetectionConfig({}, { warn: () => {}, defaultCreateResponse: false });
  assert.equal(cfg.type, 'semantic_vad');
  assert.equal(cfg.eagerness, 'low');
  assert.equal(cfg.create_response, false);
  assert.equal(cfg.interrupt_response, false);

  const compatibilityCfg = realtimeTurnDetectionConfig({}, { warn: () => {} });
  assert.equal(compatibilityCfg.create_response, true);
});

test('realtime input noise reduction defaults to speakerphone-safe far-field filtering', () => {
  assert.deepEqual(realtimeInputNoiseReductionConfig({}, { warn: () => {} }), { type: 'far_field' });
  assert.deepEqual(realtimeInputNoiseReductionConfig({
    VOX_INPUT_NOISE_REDUCTION: 'near_field',
  }, { warn: () => {} }), { type: 'near_field' });
  assert.equal(realtimeInputNoiseReductionConfig({
    VOX_INPUT_NOISE_REDUCTION: 'off',
  }, { warn: () => {} }), null);

  const warnings = [];
  assert.deepEqual(realtimeInputNoiseReductionConfig({
    VOX_INPUT_NOISE_REDUCTION: 'studio',
  }, { warn: (message) => warnings.push(message) }), { type: 'far_field' });
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes('VOX_INPUT_NOISE_REDUCTION'));
});

test('realtime turn detection env overrides are bounded and explicit', () => {
  assert.deepEqual(realtimeTurnDetectionConfig({
    VOX_VAD_TYPE: 'server_vad',
    VOX_VAD_THRESHOLD: '0.72',
    VOX_VAD_PREFIX_PADDING_MS: '650',
    VOX_VAD_SILENCE_DURATION_MS: '1200',
    VOX_VAD_CREATE_RESPONSE: 'false',
    VOX_VAD_INTERRUPT_RESPONSE: ' true ',
  }, { warn: () => {} }), {
    type: 'server_vad',
    threshold: 0.72,
    prefix_padding_ms: 650,
    silence_duration_ms: 1200,
    create_response: false,
    interrupt_response: true,
  });

  const warnings = [];
  const fallback = realtimeTurnDetectionConfig({
    VOX_VAD_TYPE: 'server_vad',
    VOX_VAD_THRESHOLD: '1.5',
    VOX_VAD_PREFIX_PADDING_MS: '500.9',
    VOX_VAD_SILENCE_DURATION_MS: '50',
    VOX_VAD_INTERRUPT_RESPONSE: 'maybe',
  }, { warn: (message) => warnings.push(message) });
  assert.equal(fallback.threshold, 0.5);
  assert.equal(fallback.prefix_padding_ms, 300);
  assert.equal(fallback.silence_duration_ms, 500);
  assert.equal(fallback.interrupt_response, false);
  assert.equal(warnings.length, 4);
  assert.ok(warnings.some((message) => message.includes('VOX_VAD_THRESHOLD')));
  assert.ok(warnings.some((message) => message.includes('VOX_VAD_PREFIX_PADDING_MS')));
  assert.ok(warnings.some((message) => message.includes('VOX_VAD_SILENCE_DURATION_MS')));
  assert.ok(warnings.some((message) => message.includes('VOX_VAD_INTERRUPT_RESPONSE')));

  const blankFallback = realtimeTurnDetectionConfig({
    VOX_VAD_TYPE: 'server_vad',
    VOX_VAD_THRESHOLD: '',
    VOX_VAD_PREFIX_PADDING_MS: ' ',
  }, { warn: (message) => warnings.push(message) });
  assert.equal(blankFallback.threshold, 0.5);
  assert.equal(blankFallback.prefix_padding_ms, 300);

  const semanticWarnings = [];
  const semanticFallback = realtimeTurnDetectionConfig({
    VOX_VAD_TYPE: 'legacy_vad',
    VOX_VAD_EAGERNESS: 'fast',
  }, { warn: (message) => semanticWarnings.push(message) });
  assert.equal(semanticFallback.type, 'semantic_vad');
  assert.equal(semanticFallback.eagerness, 'low');
  assert.equal(semanticWarnings.length, 2);
  assert.ok(semanticWarnings.some((message) => message.includes('VOX_VAD_TYPE')));
  assert.ok(semanticWarnings.some((message) => message.includes('VOX_VAD_EAGERNESS')));
});

test('subtitle target language is normalized to the supported Chinese caption mode', () => {
  assert.equal(normalizeSubtitleTargetLanguage(), 'Simplified Chinese');
  assert.equal(normalizeSubtitleTargetLanguage('zh-Hans'), 'Simplified Chinese');
  assert.equal(normalizeSubtitleTargetLanguage('zh_CN'), 'Simplified Chinese');
  assert.equal(normalizeSubtitleTargetLanguage('简体中文'), 'Simplified Chinese');
  assert.throws(() => normalizeSubtitleTargetLanguage('French'), /unsupported subtitle target language/);
});

test('Vox system prompt is conversation-first bilingual coaching, not forced drill practice', async () => {
  const prompt = await fs.readFile(new URL('../data/system_prompt.txt', import.meta.url), 'utf8');
  const voiceSource = await fs.readFile(new URL('../src/bridge/voice.mjs', import.meta.url), 'utf8');
  const truthfile = await fs.readFile(new URL('../TRUTHFILE.md', import.meta.url), 'utf8');
  const truthfileWeb = await fs.readFile(new URL('../web/tf/index.html', import.meta.url), 'utf8');

  for (const text of [prompt, voiceSource]) {
    assert.match(text, /Chat first; coach inside the chat/);
    assert.match(text, /Default to a natural Chinese-English mix/);
    assert.match(text, /Treat the learner's topic as the real topic/);
    assert.match(text, /do not force an immediate English retry/i);
    assert.match(text, /use the relevant tool instead of turning it into an English exercise/i);
    assert.doesNotMatch(text, /guide them back to English practice/i);
    assert.doesNotMatch(text, /Direct practice replies/i);
  }
  assert.match(truthfile, /most of the session is real chat/);
  assert.match(truthfile, /practice as a short in-conversation intervention/);
  assert.match(truthfileWeb, /会聊天的英语外教/);
  assert.match(truthfileWeb, /先聊天、再顺手教/);
});

test('web voice course waits for learner speech before starting a realtime response', async () => {
  const html = await fs.readFile(new URL('../web/voice-course/index.html', import.meta.url), 'utf8');
  const onOpenStart = html.indexOf('state.dc.onopen');
  const nextHandlerStart = html.indexOf('state.dc.onmessage', onOpenStart);
  assert.notEqual(onOpenStart, -1, 'data channel open handler should exist');
  assert.notEqual(nextHandlerStart, -1, 'data channel message handler should follow open handler');
  const onOpenHandler = html.slice(onOpenStart, nextHandlerStart);
  assert.equal(onOpenHandler.includes('response.create'), false);
  assert.equal(html.includes('Start the session with one short friendly greeting'), false);
});

test('web voice course requests and records browser audio processing for speaker echo control', async () => {
  const html = await fs.readFile(new URL('../web/voice-course/index.html', import.meta.url), 'utf8');
  assert.match(html, /const MIC_AUDIO_CONSTRAINTS = \[/);
  assert.match(html, /echoCancellation:\s*\{\s*ideal:\s*"all"\s*\}/);
  assert.match(html, /noiseSuppression:\s*\{\s*ideal:\s*true\s*\}/);
  assert.match(html, /autoGainControl:\s*\{\s*ideal:\s*true\s*\}/);
  assert.match(html, /async function getVoxMicrophoneStream\(\)/);
  assert.match(html, /navigator\.mediaDevices\.getUserMedia\(\{ audio: MIC_AUDIO_CONSTRAINTS\[index\] \}\)/);
  assert.match(html, /function recordMicAudioSettings\(stream\)/);
  assert.match(html, /track\.getSettings\(\)/);
  assert.match(html, /vox\.mic_audio_processing/);
  assert.doesNotMatch(html, /deviceId/);
  assert.doesNotMatch(html, /groupId/);
});

test('web voice course uses push-to-talk manual input turns for speaker echo control', async () => {
  const html = await fs.readFile(new URL('../web/voice-course/index.html', import.meta.url), 'utf8');
  const serverSource = await fs.readFile(new URL('../src/bridge/server.mjs', import.meta.url), 'utf8');
  const voiceSource = await fs.readFile(new URL('../src/bridge/voice.mjs', import.meta.url), 'utf8');

  assert.match(serverSource, /manualInputTurns:\s*body\?\.manual_input_turns === true/);
  assert.match(voiceSource, /manualInputTurns:\s*opts\.manualInputTurns === true/);
  assert.match(voiceSource, /turn_detection:\s*manualInputTurns \? null/);
  assert.match(voiceSource, /vox_manual_input_turns/);
  assert.match(html, /manual_input_turns:\s*true/);
  assert.match(html, /state\.manualInputTurns = tokenPayload\.vox_manual_input_turns === true/);
  assert.match(html, /function beginManualInputTurn\(\)/);
  assert.match(html, /type:\s*"input_audio_buffer\.clear"/);
  assert.match(html, /function finishManualInputTurn\(\)/);
  assert.match(html, /type:\s*"input_audio_buffer\.commit"/);
  assert.match(html, /function setMicrophoneOpen\(open/);
  assert.match(html, /track\.enabled = open/);
  assert.match(html, /ASSISTANT_PLAYBACK_COOLDOWN_MS/);
  assert.match(html, /return "Start speaking"/);
  assert.match(html, /return "Send"/);
  assert.match(html, /id="endCallButton"/);
});

test('iOS native voice uses continuous listening with local speaker echo control', async () => {
  const swift = await fs.readFile(new URL('../ios/Sources/RealtimeClientWebRTC.swift', import.meta.url), 'utf8');
  const pollClient = await fs.readFile(new URL('../ios/Sources/PollClient.swift', import.meta.url), 'utf8');
  const runtimeConfig = await fs.readFile(new URL('../ios/Sources/VoxRuntimeConfig.swift', import.meta.url), 'utf8');
  const app = await fs.readFile(new URL('../ios/Sources/VoxApp.swift', import.meta.url), 'utf8');

  assert.match(swift, /let requestedManualInputTurns = false/);
  assert.match(swift, /let requestedClientResponseCreate = false/);
  assert.match(swift, /"client_response_create":false,"manual_input_turns":false/);
  assert.match(swift, /serverCreatesResponses = \(json\?\["vox_server_creates_responses"\] as\? Bool\) \?\? !requestedClientResponseCreate/);
  assert.match(swift, /manualInputTurns = \(json\?\["vox_manual_input_turns"\] as\? Bool\) \?\? requestedManualInputTurns/);
  assert.match(swift, /track\.isEnabled = false/);
  assert.match(swift, /@Published var isMicrophoneOpen: Bool = false/);
  assert.match(swift, /@Published var isListeningPaused: Bool = false/);
  assert.match(swift, /private func syncContinuousListeningGate\(reason: String\)/);
  assert.match(swift, /!manualInputTurns[\s\S]*!isListeningPaused[\s\S]*!assistantOutputActive[\s\S]*!responseActive/);
  assert.match(swift, /func beginManualInputTurn\(\) -> Bool/);
  assert.match(swift, /sendDataChannelJSON\(\["type": "input_audio_buffer\.clear"\]\)/);
  assert.match(swift, /setMicrophoneOpen\(true, reason: "manual_turn_start"\)/);
  assert.match(swift, /func finishManualInputTurn\(\) -> Bool/);
  assert.match(swift, /setMicrophoneOpen\(false, reason: "manual_turn_send"\)[\s\S]*input_audio_buffer\.commit/);
  assert.match(swift, /private func requestResponseCreate\(\)[\s\S]*setMicrophoneOpen\(false, reason: "response_create"\)/);
  assert.match(swift, /case "response\.created":[\s\S]*setMicrophoneOpen\(false, reason: "assistant_response"\)/);
  assert.match(swift, /emptyLearnerCommit[\s\S]*&& !manualInputTurns/);
  assert.match(swift, /private func setMicrophoneOpen\(_ open: Bool, reason: String\)[\s\S]*audioTrack\?\.isEnabled = open/);
  assert.match(swift, /func pauseListening\(\)/);
  assert.match(swift, /func resumeListening\(\)/);

  assert.match(pollClient, /case "begin_manual_input_turn"/);
  assert.match(pollClient, /case "finish_manual_input_turn"/);
  assert.match(pollClient, /case "cancel_manual_input_turn"/);
  assert.match(pollClient, /case "pause_listening"/);
  assert.match(pollClient, /case "resume_listening"/);
  assert.match(pollClient, /case "set_bridge_base"/);
  assert.match(runtimeConfig, /VOX_BRIDGE_BASE/);
  assert.match(runtimeConfig, /static func applyDeepLink/);
  assert.match(app, /VoxRuntimeConfig\.applyDeepLink\(ctx\.url\)/);
});

test('iOS keeps requested voice mode when a legacy bridge omits optional echo flags', async () => {
  const swift = await fs.readFile(new URL('../ios/Sources/RealtimeClientWebRTC.swift', import.meta.url), 'utf8');

  assert.match(swift, /let requestedManualInputTurns = false/);
  assert.match(swift, /let requestedClientResponseCreate = false/);
  assert.match(swift, /"manual_input_turns":false/);
  assert.match(swift, /manualInputTurns = \(json\?\["vox_manual_input_turns"\] as\? Bool\) \?\? requestedManualInputTurns/);
  assert.match(swift, /serverCreatesResponses = \(json\?\["vox_server_creates_responses"\] as\? Bool\) \?\? !requestedClientResponseCreate/);
  assert.match(swift, /Older bridges may accept the request body but omit the manual-turn/);
});

test('iOS native transcript keeps scrollable conversation history', async () => {
  const swift = await fs.readFile(new URL('../ios/Sources/RealtimeClientWebRTC.swift', import.meta.url), 'utf8');
  const voiceView = await fs.readFile(new URL('../ios/Sources/VoiceCallView.swift', import.meta.url), 'utf8');

  assert.match(swift, /struct TranscriptTurn: Identifiable, Equatable/);
  assert.match(swift, /@Published var transcriptTurns: \[TranscriptTurn\] = \[\]/);
  assert.match(swift, /appendTranscriptTurn\(role: \.user, text: transcript\)/);
  assert.match(swift, /private func updateAssistantDraft\(_ text: String\)/);
  assert.match(swift, /private func finalizeAssistantDraft\(_ text: String\)/);
  assert.match(swift, /if transcriptTurns\.count > 80/);
  assert.match(swift, /"transcriptTurns": transcriptTurns\.suffix\(12\)\.map/);
  assert.match(swift, /"role": turn\.role\.rawValue/);
  assert.match(swift, /"isCurrent": turn\.isCurrent/);
  assert.match(voiceView, /client\.transcriptTurns\.map/);
  assert.doesNotMatch(voiceView, /let user = client\.lastUserUtterance/);
  assert.doesNotMatch(voiceView, /let assistant = client\.lastAssistantText/);
});

test('iOS native transcript keeps user turn before the assistant answer when events arrive out of order', async () => {
  const swift = await fs.readFile(new URL('../ios/Sources/RealtimeClientWebRTC.swift', import.meta.url), 'utf8');

  const commitCase = swift.slice(swift.indexOf('case "input_audio_buffer.committed"'), swift.indexOf('case "conversation.item.input_audio_transcription.completed"'));
  assert.match(commitCase, /markPendingUserTranscriptOrder\(\)/);
  assert.match(swift, /private var pendingUserTranscriptBeforeAssistant: Bool = false/);
  assert.match(swift, /private var pendingUserTranscriptInsertionIndex: Int\?/);
  assert.match(swift, /private var pendingUserTranscriptTimestamp: TimeInterval\?/);
  assert.match(swift, /private var pendingUserTranscriptGeneration: Int = 0/);
  assert.match(swift, /private func markPendingUserTranscriptOrder\(\)[\s\S]*pendingUserTranscriptBeforeAssistant = true[\s\S]*pendingUserTranscriptInsertionIndex = transcriptTurns\.count[\s\S]*pendingUserTranscriptTimestamp = Date\(\)\.timeIntervalSince1970/);
  assert.match(swift, /private func clearPendingUserTranscriptOrder\(\)[\s\S]*pendingUserTranscriptBeforeAssistant = false[\s\S]*pendingUserTranscriptInsertionIndex = nil[\s\S]*pendingUserTranscriptTimestamp = nil/);

  const transcriptionCase = swift.slice(swift.indexOf('case "conversation.item.input_audio_transcription.completed"'), swift.indexOf('case "response.output_item.done"'));
  assert.match(transcriptionCase, /appendTranscriptTurn\(role: \.user, text: transcript\)[\s\S]*clearPendingUserTranscriptOrder\(\)/);
  assert.match(transcriptionCase, /shouldIgnoreInputTranscript\(transcript\)[\s\S]*clearPendingUserTranscriptOrder\(\)[\s\S]*return/);

  const appendTurn = swift.slice(swift.indexOf('private func appendTranscriptTurn'), swift.indexOf('private func updateAssistantDraft'));
  assert.match(appendTurn, /let timestamp = \(role == \.user \? pendingUserTranscriptTimestamp : nil\) \?\? Date\(\)\.timeIntervalSince1970/);
  assert.match(appendTurn, /role == \.user && pendingUserTranscriptBeforeAssistant/);
  assert.match(appendTurn, /pendingUserTranscriptInsertionIndex/);
  assert.match(appendTurn, /min\(insertionIndex, transcriptTurns\.count\)/);
  assert.match(appendTurn, /transcriptTurns\.insert\(turn, at: index\)/);
  assert.doesNotMatch(appendTurn, /lastIndex\(where: \{ \$0\.role == \.assistant \}\)/);
  assert.match(appendTurn, /transcriptTurns\.append\(turn\)/);
});

test('web transcript uses the audio commit position instead of the previous assistant as the user-turn anchor', async () => {
  const html = await fs.readFile(new URL('../web/voice-course/index.html', import.meta.url), 'utf8');

  const commitCase = html.slice(html.indexOf('case "input_audio_buffer.committed"'), html.indexOf('case "conversation.item.input_audio_transcription.completed"'));
  assert.match(commitCase, /markPendingUserTranscriptOrder\(\)/);
  assert.match(html, /pendingUserTranscriptInsertionIndex:\s*null/);
  assert.match(html, /pendingUserTranscriptTs:\s*null/);
  assert.match(html, /function markPendingUserTranscriptOrder\(\)[\s\S]*state\.pendingUserTranscriptInsertionIndex = state\.turns\.length[\s\S]*state\.pendingUserTranscriptTs = Date\.now\(\)/);
  assert.match(html, /function clearPendingUserTranscriptOrder\(\)[\s\S]*state\.pendingUserTranscriptInsertionIndex = null[\s\S]*state\.pendingUserTranscriptTs = null/);

  const transcriptionCase = html.slice(html.indexOf('case "conversation.item.input_audio_transcription.completed"'), html.indexOf('case "response.output_item.done"'));
  assert.match(transcriptionCase, /addTurn\("user", transcript\)[\s\S]*clearPendingUserTranscriptOrder\(\)/);
  assert.match(transcriptionCase, /shouldIgnoreInputTranscript\(transcript\)[\s\S]*clearPendingUserTranscriptOrder\(\)[\s\S]*break/);

  const addTurn = html.slice(html.indexOf('function addTurn'), html.indexOf('function createTurn'));
  assert.match(addTurn, /role === "user" && Number\.isInteger\(state\.pendingUserTranscriptInsertionIndex\)/);
  assert.match(addTurn, /Number\.isFinite\(state\.pendingUserTranscriptTs\)[\s\S]*turn\.ts = state\.pendingUserTranscriptTs/);
  assert.match(addTurn, /state\.turns\.splice\(index, 0, turn\)/);
  assert.match(addTurn, /state\.assistantDraftIndex \+= 1/);
});

test('iOS native voice suppresses recoverable WebRTC empty-buffer errors', async () => {
  const swift = await fs.readFile(new URL('../ios/Sources/RealtimeClientWebRTC.swift', import.meta.url), 'utf8');

  assert.match(swift, /msg\.range\(of: "buffer too small", options: \.caseInsensitive\)/);
  assert.match(swift, /ignored recoverable empty input commit/);
  assert.match(swift, /lastError = nil[\s\S]*if state == \.error \{ state = \.connected \}/);
  assert.match(swift, /case \.failed:[\s\S]*self\.scheduleReconnect\(reason: "ice_failed"\)/);
});

test('iOS bridge config keeps temporary E2E bridge URLs out of persistent settings', async () => {
  const pollClient = await fs.readFile(new URL('../ios/Sources/PollClient.swift', import.meta.url), 'utf8');
  const runtimeConfig = await fs.readFile(new URL('../ios/Sources/VoxRuntimeConfig.swift', import.meta.url), 'utf8');
  const buildInstall = await fs.readFile(new URL('../scripts/build-install.sh', import.meta.url), 'utf8');

  const envIndex = runtimeConfig.indexOf('ProcessInfo.processInfo.environment["VOX_BRIDGE_BASE"]');
  const overrideIndex = runtimeConfig.indexOf('bridgeBaseOverride');
  const defaultsIndex = runtimeConfig.indexOf('UserDefaults.standard.string(forKey: bridgeBaseKey)');
  assert.ok(envIndex >= 0, 'runtime config should accept launch-time bridge override');
  assert.ok(overrideIndex >= 0, 'runtime config should keep a non-persistent in-memory override');
  assert.ok(defaultsIndex >= 0, 'runtime config should still support persistent bridge settings');
  assert.ok(envIndex < defaultsIndex, 'launch env should win over stale UserDefaults bridge URL');

  assert.match(runtimeConfig, /static func setBridgeBase\(_ value: String, persist: Bool = true\) -> Bool/);
  assert.match(runtimeConfig, /if persist \{[\s\S]*UserDefaults\.standard\.set\(trimmed, forKey: bridgeBaseKey\)[\s\S]*bridgeBaseOverride = nil[\s\S]*\} else \{[\s\S]*bridgeBaseOverride = trimmed/);
  assert.match(runtimeConfig, /let persistValue = comps\.queryItems\?\.[\s\S]*first\(where: \{ \$0\.name == "persist" \}/);
  assert.match(runtimeConfig, /!\["0", "false", "no"\]\.contains\(persistValue\)/);

  assert.match(pollClient, /case "set_bridge_base":[\s\S]*Self\.boolArg\(cmd\.args\?\["persist"\], defaultValue: true\)/);
  assert.match(pollClient, /VoxRuntimeConfig\.setBridgeBase\(value, persist: persist\)/);

  assert.match(buildInstall, /VOX_BRIDGE_PERSIST/);
  assert.match(buildInstall, /URLSearchParams\(\{ bridge: process\.env\.VOX_BRIDGE_BASE, persist: process\.env\.VOX_BRIDGE_PERSIST \}\)/);
  assert.match(buildInstall, /vox:\/\/config\?\$\{qs\}/);
});

test('iOS app mirrors canonical Vox Voice without legacy drill surfaces', async () => {
  const root = await fs.readFile(new URL('../ios/Sources/RootView.swift', import.meta.url), 'utf8');
  const voiceView = await fs.readFile(new URL('../ios/Sources/VoiceCallView.swift', import.meta.url), 'utf8');
  const pollClient = await fs.readFile(new URL('../ios/Sources/PollClient.swift', import.meta.url), 'utf8');
  const toolRegistry = await fs.readFile(new URL('../src/bridge/tools/index.mjs', import.meta.url), 'utf8');
  const voicePrompt = await fs.readFile(new URL('../src/bridge/voice.mjs', import.meta.url), 'utf8');
  const appState = await fs.readFile(new URL('../src/bridge/tools/app-state.mjs', import.meta.url), 'utf8');
  const readme = await fs.readFile(new URL('../README.md', import.meta.url), 'utf8');
  const agents = await fs.readFile(new URL('../AGENTS.md', import.meta.url), 'utf8');
  const truthfileWeb = await fs.readFile(new URL('../web/tf/index.html', import.meta.url), 'utf8');
  const scanned = [root, voiceView, pollClient, toolRegistry, voicePrompt, appState, readme, agents, truthfileWeb].join('\n');

  assert.match(root, /VoiceCallView\(\)/);
  assert.doesNotMatch(root, /TabView|DrillView|tabItem/);
  assert.match(root, /"surface": "voice"/);

  assert.match(voiceView, /return "Start"/);
  assert.match(voiceView, /return client\.isListeningPaused \? "Resume" : "Pause"/);
  assert.match(voiceView, /Vox speaking/);
  assert.match(voiceView, /Listening/);
  assert.doesNotMatch(voiceView, /return "Send"/);
  assert.doesNotMatch(voiceView, /return "End and save"/);
  assert.doesNotMatch(voiceView, /Talk|Wait/);

  assert.doesNotMatch(pollClient, /switch_tab|reload_drill|eval_artifact/);
  assert.doesNotMatch(toolRegistry, /generate_drill|develop_artifact|Tab 2|fill-in-the-blank/);
  assert.doesNotMatch(voicePrompt, /generate_drill|tab\/drill|drill/);
  assert.match(appState, /surface: 'unknown'/);
  assert.doesNotMatch(appState, /drill|tab:/);
  assert.doesNotMatch(scanned, /Teacher|Drill|generate_drill|reload_drill|develop_artifact|Tab 2/);
});

test('web root redirects to the canonical voice app URL without client-side redirect', async () => {
  const serverSource = await fs.readFile(new URL('../src/bridge/server.mjs', import.meta.url), 'utf8');
  assert.match(serverSource, /if \(pathname === '\/'\)/);
  assert.match(serverSource, /'Location': `\/voice-course\/\$\{url\.search\}`/);

  const rootHtml = await fs.readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(rootHtml, /http-equiv=["']refresh/i);
  assert.doesNotMatch(rootHtml, /location\.replace\(["']\/voice-course\/["']\)/);
});

test('static directory routes redirect to canonical slash URLs', async (t) => {
  const port = await freePort();
  const proc = startTestBridge(port);
  t.after(() => proc.kill('SIGTERM'));
  await waitForHealth(`http://127.0.0.1:${port}/health`);

  const configResp = await fetch(`http://127.0.0.1:${port}/api/config`);
  assert.equal(configResp.status, 200);
  const configPayload = await configResp.json();
  assert.deepEqual(configPayload.realtime.noise_reduction, { type: 'far_field' });

  const rootResp = await fetch(`http://127.0.0.1:${port}/?topic=a%20b`, { redirect: 'manual' });
  assert.equal(rootResp.status, 307);
  assert.equal(rootResp.headers.get('location'), '/voice-course/?topic=a%20b');

  for (const path of ['/tf', '/voice-course']) {
    const getResp = await fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'manual' });
    assert.equal(getResp.status, 308);
    assert.equal(getResp.headers.get('location'), `${path}/`);

    const headResp = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'HEAD', redirect: 'manual' });
    assert.equal(headResp.status, 308);
    assert.equal(headResp.headers.get('location'), `${path}/`);
  }

  const queryResp = await fetch(`http://127.0.0.1:${port}/voice-course?topic=a%20b`, { redirect: 'manual' });
  assert.equal(queryResp.status, 308);
  assert.equal(queryResp.headers.get('location'), '/voice-course/?topic=a%20b');

  const tfResp = await fetch(`http://127.0.0.1:${port}/tf/`);
  assert.equal(tfResp.status, 200);
  assert.match(tfResp.headers.get('content-type') || '', /^text\/html\b/);
  assert.match(await tfResp.text(), /Vox Truthfile/);
});

test('web voice course keeps Vox Chinese subtitles attached to assistant turns', async () => {
  const html = await fs.readFile(new URL('../web/voice-course/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="subtitleToggle"/);
  assert.match(html, /SUBTITLE_PREF_KEY\s*=\s*"vox\.showChineseSubtitles"/);
  assert.match(html, /function requestAssistantSubtitle\(turn\)/);
  assert.match(html, /if \(!state\.showChineseSubtitles\) return;/);
  assert.match(html, /subtitleBackfillRunning:\s*false/);
  assert.match(html, /async function requestMissingAssistantSubtitles\(\)/);
  assert.match(html, /SUBTITLE_REQUEST_TIMEOUT_MS\s*=\s*12000/);
  assert.match(html, /SUBTITLE_RETRY_AFTER_MS\s*=\s*15000/);
  assert.match(html, /SUBTITLE_MAX_TRIES\s*=\s*2/);
  assert.match(html, /fetch\("\/api\/translate"/);
  assert.match(html, /clearTimeout\(timeoutId\);\s*const payload = await resp\.json/);
  assert.match(html, /data-turn-id=/);
  assert.match(html, /data-subtitle-role="assistant"/);
  assert.match(html, /data-subtitle-status=/);
  assert.match(html, /zhRequestedAt/);
  assert.match(html, /zhAttempts/);
  assert.match(html, /function scheduleSubtitleRetry\(delayMs = 1000\)/);
  assert.match(html, /aborted && attempt < SUBTITLE_MAX_TRIES/);
  assert.match(html, /zhStatus = "error"/);
  assert.match(html, /中文字幕暂不可用/);
  assert.match(html, /turn\.role !== "assistant"/);
  assert.match(html, /RECORDING_HEADER_MAX_CHARS\s*=\s*6000/);
  assert.match(html, /function encodeJsonHeaderWithinLimit\(items, shrinkItem\)/);
  assert.match(html, /recordingTranscriptHeader\(\)[\s\S]*zh: String\(turn\.zh/);

  const serverSource = await fs.readFile(new URL('../src/bridge/server.mjs', import.meta.url), 'utf8');
  assert.match(serverSource, /POST \/api\/translate/);
  assert.match(serverSource, /translateSubtitleText/);
  assert.match(serverSource, /normalizeSubtitleTargetLanguage/);
  assert.match(serverSource, /sweepSubtitleTranslationHits/);
  assert.match(serverSource, /SUBTITLE_TRANSLATION_CACHE_TTL_MS/);
  assert.match(serverSource, /SUBTITLE_TRANSLATION_SWEEP_INTERVAL_MS/);
  assert.match(serverSource, /subtitleTranslationCacheKey\(text, targetLanguage, clientKey\)/);

  const voiceSource = await fs.readFile(new URL('../src/bridge/voice.mjs', import.meta.url), 'utf8');
  assert.match(voiceSource, /export async function translateSubtitleText/);
  assert.match(voiceSource, /export function normalizeSubtitleTargetLanguage/);
  assert.match(voiceSource, /\/v1\/responses/);
  assert.match(voiceSource, /SUBTITLE_TRANSLATION_TIMEOUT_MS/);
  assert.match(voiceSource, /signal: controller\.signal/);
});

test('realtime clients gate response.create through active-response state', async () => {
  const html = await fs.readFile(new URL('../web/voice-course/index.html', import.meta.url), 'utf8');
  assert.match(html, /responseActive:\s*false/);
  assert.match(html, /pendingResponseCreate:\s*false/);
  assert.match(html, /inputCommitDuringAssistantOutput:\s*false/);
  assert.match(html, /inputCommitEchoText:\s*""/);
  assert.match(html, /assistantEchoText:\s*""/);
  assert.match(html, /function deferResponseCreateForActiveResponse\(\)/);
  assert.match(html, /function scheduleInputCommitFallback\(\)/);
  assert.match(html, /function requestResponseCreate\(\)/);
  assert.match(html, /state\.dc\.onopen = \(\) => \{[\s\S]*flushPendingResponseCreate\(\);/);
  const webTranscriptionCase = html.slice(html.indexOf('case "conversation.item.input_audio_transcription.completed"'), html.indexOf('case "response.output_item.done"'));
  assert.match(webTranscriptionCase, /requestResponseCreate\(\);/);
  const webCommitCase = html.slice(html.indexOf('case "input_audio_buffer.committed"'), html.indexOf('case "conversation.item.input_audio_transcription.completed"'));
  assert.match(webCommitCase, /scheduleInputCommitFallback\(\);/);
  assert.match(webCommitCase, /inputCommitEchoText[\s\S]*currentAssistantEchoText\(\)/);
  const webRequestCreate = html.slice(html.indexOf('function requestResponseCreate()'), html.indexOf('function flushPendingResponseCreate()'));
  assert.match(webRequestCreate, /state\.pendingResponseCreate = true;[\s\S]*return;/);
  assert.match(webRequestCreate, /state\.responseActive = true;[\s\S]*sendEvent\(\{ type: "response\.create" \}\);/);
  const webErrorCase = html.slice(html.indexOf('case "error"'), html.indexOf('default:', html.indexOf('case "error"')));
  assert.match(webErrorCase, /active response in progress[\s\S]*deferResponseCreateForActiveResponse\(\);/);
  assert.match(webErrorCase, /settleAssistantDraft\(\);/);
  assert.match(webErrorCase, /resumePending[\s\S]*setTimeout\(requestResponseCreate, 250\)/);
  assert.match(html, /response\.audio\.delta[\s\S]*return;/);
  const webFunctionCall = html.slice(html.indexOf('async function handleFunctionCall'), html.indexOf('async function callBridgeTool'));
  assert.match(webFunctionCall, /requestResponseCreate\(\);/);
  assert.equal(webFunctionCall.includes('sendEvent({ type: "response.create" });'), false);

  const swift = await fs.readFile(new URL('../ios/Sources/RealtimeClientWebRTC.swift', import.meta.url), 'utf8');
  assert.match(swift, /private var responseActive: Bool = false/);
  assert.match(swift, /private var pendingResponseCreate: Bool = false/);
  assert.match(swift, /private var inputCommitFallbackScheduled: Bool = false/);
  assert.match(swift, /private var inputCommitDuringAssistantOutput: Bool = false/);
  assert.match(swift, /private var inputCommitEchoText: String = ""/);
  assert.match(swift, /private var assistantEchoText: String = ""/);
  assert.match(swift, /private func deferResponseCreateForActiveResponse\(\)/);
  assert.match(swift, /private func scheduleInputCommitFallback\(\)/);
  assert.match(swift, /private func requestResponseCreate\(\)/);
  const swiftTranscriptionCase = swift.slice(swift.indexOf('case "conversation.item.input_audio_transcription.completed"'), swift.indexOf('case "response.output_item.done"'));
  assert.match(swiftTranscriptionCase, /requestResponseCreate\(\)/);
  const swiftCommitCase = swift.slice(swift.indexOf('case "input_audio_buffer.committed"'), swift.indexOf('case "conversation.item.input_audio_transcription.completed"'));
  assert.match(swiftCommitCase, /scheduleInputCommitFallback\(\)/);
  assert.match(swiftCommitCase, /inputCommitEchoText[\s\S]*currentAssistantEchoText\(\)/);
  const swiftRequestCreate = swift.slice(swift.indexOf('private func requestResponseCreate()'), swift.indexOf('private func completeResponse()'));
  assert.match(swiftRequestCreate, /pendingResponseCreate = true[\s\S]*return/);
  assert.match(swiftRequestCreate, /responseActive = true[\s\S]*sendDataChannelJSON\(\["type": "response\.create"\]\)/);
  assert.match(swift, /if isOpen, self\.pendingResponseCreate, !self\.responseActive \{[\s\S]*self\.requestResponseCreate\(\)/);
  const swiftErrorCase = swift.slice(swift.indexOf('case "error"'), swift.indexOf('default:', swift.indexOf('case "error"')));
  assert.match(swiftErrorCase, /active response in progress[\s\S]*deferResponseCreateForActiveResponse\(\)/);
  assert.match(swiftErrorCase, /settleAssistantBuffer\(\)/);
  assert.match(swiftErrorCase, /resumePending[\s\S]*asyncAfter\(deadline: \.now\(\) \+ 0\.25\)/);
  const swiftFunctionCall = swift.slice(swift.indexOf('private func sendFunctionCallOutput'), swift.indexOf('// MARK: - external triggers'));
  assert.match(swiftFunctionCall, /requestResponseCreate\(\)/);
  assert.equal(swiftFunctionCall.includes('sendDataChannelJSON(["type": "response.create"])'), false);
});

test('realtime clients suppress assistant echo transcripts before creating user turns', async () => {
  const html = await fs.readFile(new URL('../web/voice-course/index.html', import.meta.url), 'utf8');
  assert.match(html, /function shouldIgnoreInputTranscript\(transcript\)/);
  assert.match(html, /state\.assistantOutputActive[\s\S]*state\.inputCommitDuringAssistantOutput/);
  assert.match(html, /function currentAssistantEchoText\(\)/);
  assert.match(html, /function rememberAssistantEchoText\(\)/);
  assert.match(html, /function isShortSpeechArtifact\(value\)/);
  assert.doesNotMatch(html, /function isAssistantEchoGuardActive\(\)/);
  assert.match(html, /function hasCompactSpeechScript\(value\)/);
  assert.match(html, /Script=Thai/);
  assert.match(html, /Script=Arabic/);
  assert.match(html, /Script=Devanagari/);
  const webResponseCreated = html.slice(html.indexOf('case "response.created"'), html.indexOf('case "input_audio_buffer.speech_started"'));
  assert.match(webResponseCreated, /lastAssistantText = ""/);
  assert.match(webResponseCreated, /assistantEchoText = ""/);
  assert.doesNotMatch(html, /function isLikelyEchoFragment\(value\)/);
  assert.match(html, /vox\.input_ignored/);
  assert.match(html, /X-Vox-Events/);
  assert.match(html, /vox_server_creates_responses/);

  const swift = await fs.readFile(new URL('../ios/Sources/RealtimeClientWebRTC.swift', import.meta.url), 'utf8');
  assert.match(swift, /private func shouldIgnoreInputTranscript\(_ transcript: String\) -> Bool/);
  assert.match(swift, /assistantOutputActive \|\| inputCommitDuringAssistantOutput/);
  assert.match(swift, /private func currentAssistantEchoText\(\) -> String/);
  assert.match(swift, /private func rememberAssistantEchoText\(\)/);
  assert.match(swift, /private func isShortSpeechArtifact\(_ value: String\) -> Bool/);
  assert.doesNotMatch(swift, /private func isAssistantEchoGuardActive\(\) -> Bool/);
  assert.match(swift, /private func containsCompactSpeechScript/);
  assert.match(swift, /0x0E00\.\.\.0x0E7F/);
  assert.match(swift, /0x0600\.\.\.0x06FF/);
  assert.match(swift, /0x0900\.\.\.0x097F/);
  const swiftResponseCreated = swift.slice(swift.indexOf('case "response.created"'), swift.indexOf('case "response.audio_transcript.delta"'));
  assert.match(swiftResponseCreated, /lastAssistantText = ""/);
  assert.match(swiftResponseCreated, /assistantEchoText = ""/);
  assert.doesNotMatch(swift, /private func isLikelyEchoFragment\(_ value: String\) -> Bool/);
  assert.match(swift, /ignored input transcript as assistant echo/);
  assert.match(swift, /vox_server_creates_responses/);

  const voiceSource = await fs.readFile(new URL('../src/bridge/voice.mjs', import.meta.url), 'utf8');
  assert.match(voiceSource, /vox_server_creates_responses/);
  assert.doesNotMatch(voiceSource, /vox_turn_detection:\s*session\.audio\.input\.turn_detection/);
});

test('web assistant echo guard only suppresses transcripts committed during assistant output', async () => {
  const html = await fs.readFile(new URL('../web/voice-course/index.html', import.meta.url), 'utf8');
  const assistantText = "Hi there! How's it going? What would you like to practice today?";

  assert.equal(runWebEchoGuard(html, {
    inputCommitDuringAssistantOutput: true,
    inputCommitEchoText: assistantText,
  }, 'Hi there!'), true);

  assert.equal(runWebEchoGuard(html, {
    assistantOutputActive: true,
    assistantEchoText: 'I want to practice ordering food at a restaurant.',
    lastAssistantText: 'I want to practice ordering food at a restaurant.',
  }, 'I want'), false);

  assert.equal(runWebEchoGuard(html, {
    inputCommitDuringAssistantOutput: true,
    inputCommitEchoText: "Let's practice ordering food at a restaurant.",
  }, "Let's practice ordering food at a restaurant uh"), true);

  assert.equal(runWebEchoGuard(html, {
    assistantEchoText: assistantText,
    lastAssistantText: assistantText,
  }, 'Hi there!'), false);

  assert.equal(runWebEchoGuard(html, {
    assistantEchoText: assistantText,
    lastAssistantText: assistantText,
  }, "How's it feel?"), false);

  assert.equal(runWebEchoGuard(html, {
    assistantEchoText: 'Go ahead.',
    lastAssistantText: 'Go ahead.',
  }, "Go ahead, let's try ordering food"), false);

  assert.equal(runWebEchoGuard(html, {
    assistantEchoText: assistantText,
    lastAssistantText: assistantText,
  }, 'Hi there!'), false);

  assert.doesNotMatch(html, /assistant\.includes\(input\)/);
  assert.doesNotMatch(html, /assistant\.endsWith\(input\)/);
  const swift = await fs.readFile(new URL('../ios/Sources/RealtimeClientWebRTC.swift', import.meta.url), 'utf8');
  assert.doesNotMatch(swift, /assistant\.contains\(input\)/);
  assert.doesNotMatch(swift, /assistant\.hasSuffix\(input\)/);
});

test('recordings save audio, metadata, transcripts, captions, and events without returning raw bytes in list output', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vox-recordings-test-'));
  t.after(withEnv({ VOX_RECORDINGS_DIR: dir }));
  const user = { id: 'u_123', email: 'rick@exp.game', provider: 'test' };
  const result = await saveRecording({
    bytes: Buffer.from('audio bytes'),
    mimeType: 'audio/webm',
    user,
    sessionId: 'session:one',
    startedAt: '2026-05-18T00:00:00.000Z',
    endedAt: '2026-05-18T00:00:01.000Z',
    durationMs: 1000,
    transcript: [
      { id: 'turn-1', role: 'user', text: 'hello', ts: 1000 },
      { id: 'turn-2', role: 'assistant', text: 'hi --> there\nfriend', zh: '你好，朋友。', ts: 1500 },
    ],
    events: [
      { type: 'conversation.item.input_audio_transcription.completed', text: 'hello', ts: 1000 },
      { type: '  ', text: 'dropped', ts: 2000 },
    ],
  });
  assert.equal(result.bytes, 11);
  assert.match(result.audio_file, /\.webm$/);
  assert.match(result.transcript_file, /\.transcript\.json$/);
  assert.match(result.captions_file, /\.vtt$/);
  assert.match(result.subtitles_file, /\.srt$/);
  assert.match(result.events_file, /\.events\.json$/);
  assert.equal(result.transcript_count, 2);
  assert.equal(result.realtime_events_count, 1);
  const recordingsSource = await fs.readFile(new URL('../src/bridge/recordings.mjs', import.meta.url), 'utf8');
  assert.match(recordingsSource, /writeError\.code !== 'EEXIST'/);
  assert.match(recordingsSource, /createdPaths\.push\(file\)/);

  const files = await fs.readdir(dir);
  assert.equal(files.filter((file) => file.endsWith('.webm')).length, 1);
  assert.equal(files.filter((file) => file.endsWith('.json')).length, 3);
  assert.equal(files.filter((file) => file.endsWith('.txt')).length, 1);
  assert.equal(files.filter((file) => file.endsWith('.vtt')).length, 1);
  assert.equal(files.filter((file) => file.endsWith('.srt')).length, 1);
  const transcriptText = await fs.readFile(path.join(dir, result.transcript_text_file), 'utf8');
  assert.match(transcriptText, /\[user\] hello/);
  assert.match(transcriptText, /\[assistant\.zh\] 你好，朋友。/);
  const captions = await fs.readFile(path.join(dir, result.captions_file), 'utf8');
  assert.match(captions, /^WEBVTT/);
  assert.match(captions, /assistant: hi -> there friend/);
  assert.match(captions, /你好，朋友。/);
  assert.doesNotMatch(captions, /hi --> there/);
  assert.match(recordingsSource, /transcriptSpanMs \+ 500/);
  const events = JSON.parse(await fs.readFile(path.join(dir, result.events_file), 'utf8'));
  assert.equal(events[0].type, 'conversation.item.input_audio_transcription.completed');

  const list = await listRecordings({ user, limit: 10 });
  assert.equal(list.length, 1);
  assert.equal(list[0].audio_file, result.audio_file);
  assert.equal(list[0].bytes, 11);
  assert.deepEqual(list[0].transcript, [
    { id: 'turn-1', role: 'user', text: 'hello', ts: 1000 },
    { id: 'turn-2', role: 'assistant', text: 'hi --> there\nfriend', zh: '你好，朋友。', ts: 1500 },
  ]);
  assert.equal(Object.hasOwn(list[0], 'audio_bytes'), false);
});

test('recordings use the correct file extension for mp3 uploads', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vox-recordings-mpeg-test-'));
  t.after(withEnv({ VOX_RECORDINGS_DIR: dir }));
  const user = { id: 'u_mp3', email: 'rick@exp.game', provider: 'test' };
  const result = await saveRecording({
    bytes: Buffer.from('mp3 bytes'),
    mimeType: 'audio/mpeg',
    user,
    sessionId: 'session-mp3',
  });
  assert.match(result.audio_file, /\.mp3$/);
});

test('empty recording duration is stored as null', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vox-recordings-duration-test-'));
  t.after(withEnv({ VOX_RECORDINGS_DIR: dir }));
  const user = { id: 'u_duration', email: 'rick@exp.game', provider: 'test' };
  const result = await saveRecording({
    bytes: Buffer.from('audio bytes'),
    mimeType: 'audio/webm',
    user,
    durationMs: '',
  });
  assert.equal(result.duration_ms, null);
});

test('recording listing filters by user before applying limit', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vox-recordings-list-test-'));
  t.after(withEnv({ VOX_RECORDINGS_DIR: dir }));

  await writeRecordingMetadata(dir, `${recordingUserPrefix('user-a')}2026-05-18T00-00-00-000Z-user-a.json`, 'user-a');
  for (let index = 0; index < 160; index += 1) {
    await writeRecordingMetadata(
      dir,
      `${recordingUserPrefix('user-b')}2026-05-18T00-01-${String(index).padStart(3, '0')}-000Z-user-b.json`,
      'user-b'
    );
  }

  const list = await listRecordings({ user: { id: 'user-a' }, limit: 1 });
  assert.equal(list.length, 1);
  assert.equal(list[0].user.id, 'user-a');
});

function withEnv(values) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value == null) delete process.env[key];
    else process.env[key] = String(value);
  }
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

function startTestBridge(port) {
  const projectRoot = fileURLToPath(new URL('..', import.meta.url));
  const proc = spawn(process.execPath, ['src/bridge/server.mjs'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      VOX_AUTH_REQUIRED: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  return proc;
}

async function waitForHealth(url) {
  const deadline = Date.now() + 10_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(url, { headers: { accept: 'application/json' } });
      const payload = await resp.json();
      if (payload.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`bridge did not become healthy: ${lastError?.message || 'timeout'}`);
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function writeRecordingMetadata(dir, file, userId) {
  await fs.writeFile(path.join(dir, file), JSON.stringify({
    id: file.replace(/\.json$/, ''),
    session_id: file,
    user: { id: userId, email: `${userId}@example.com`, provider: 'test' },
    mime_type: 'audio/webm',
    bytes: 1,
    audio_file: file.replace(/\.json$/, '.webm'),
    saved_at: '2026-05-18T00:00:00.000Z',
  }));
}

function recordingUserPrefix(userId) {
  const digest = crypto.createHash('sha256').update(`vox-recording-user:${userId}`).digest('hex').slice(0, 24);
  return `u-${digest}-`;
}

function runWebEchoGuard(html, statePatch, transcript) {
  const start = html.indexOf('function shouldIgnoreInputTranscript(transcript)');
  const end = html.indexOf('function updateAssistantDraft(delta)', start);
  assert.notEqual(start, -1, 'shouldIgnoreInputTranscript helper should exist');
  assert.notEqual(end, -1, 'updateAssistantDraft should follow echo helpers');
  const helperSource = html.slice(start, end);
  const sandbox = {
    result: null,
    state: {
      inputCommitEchoText: '',
      assistantDraft: '',
      assistantEchoText: '',
      lastAssistantText: '',
      assistantOutputActive: false,
      inputCommitDuringAssistantOutput: false,
      ...statePatch,
    },
  };
  vm.runInNewContext(`${helperSource}\nresult = shouldIgnoreInputTranscript(${JSON.stringify(transcript)});`, sandbox);
  return sandbox.result;
}
