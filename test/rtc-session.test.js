import assert from "node:assert/strict";
import test from "node:test";
import { RealtimeWebRTCSession } from "../rtc-session.js";

class FakeTrack {
  constructor(kind, id) { this.kind = kind; this.id = id; this.enabled = true; this.stopped = false; }
  stop() { this.stopped = true; }
}

class FakeMediaStream {
  constructor(tracks = []) { this.tracks = tracks.slice(); }
  getTracks() { return this.tracks.slice(); }
  getAudioTracks() { return this.tracks.filter((track) => track.kind === "audio"); }
  getVideoTracks() { return this.tracks.filter((track) => track.kind === "video"); }
  addTrack(track) { if (!this.tracks.includes(track)) this.tracks.push(track); }
  removeTrack(track) { this.tracks = this.tracks.filter((item) => item !== track); }
}

class FakePeerConnection {
  constructor() {
    this.connectionState = "new";
    this.signalingState = "stable";
    this.localDescription = null;
    this.remoteDescription = null;
    this.transceivers = [];
    this.candidates = [];
  }
  addTrack(track) {
    const sender = { track, replaceTrack:async (next) => { sender.track = next; } };
    const receiver = { track:new FakeTrack(track.kind, "remote-" + track.kind) };
    this.transceivers.push({ sender, receiver });
    return sender;
  }
  addTransceiver(kind) {
    const sender = { track:null, replaceTrack:async (next) => { sender.track = next; } };
    const receiver = { track:new FakeTrack(kind, "remote-" + kind) };
    const transceiver = { sender, receiver };
    this.transceivers.push(transceiver);
    return transceiver;
  }
  getTransceivers() { return this.transceivers; }
  getSenders() { return this.transceivers.map((item) => item.sender); }
  async createOffer(options) { return { type:"offer", sdp:options?.iceRestart ? "restart" : "offer" }; }
  async createAnswer() { return { type:"answer", sdp:"answer" }; }
  async setLocalDescription(description) { this.localDescription = description; this.signalingState = description.type === "offer" ? "have-local-offer" : "stable"; }
  async setRemoteDescription(description) { this.remoteDescription = description; this.signalingState = "stable"; }
  async addIceCandidate(candidate) { this.candidates.push(candidate); }
  close() { this.connectionState = "closed"; this.signalingState = "closed"; }
}

class FakeChannel {
  constructor(topic, options) { this.topic = topic; this.options = options; this.handlers = []; this.sent = []; this.tracked = []; this._presence = {}; this.subscribed = false; }
  on(type, filter, callback) {
    if (this.subscribed && (type === "presence" || type === "postgres_changes")) {
      throw new Error("cannot add `" + type + "` callbacks for " + this.topic + " after `subscribe()`.");
    }
    this.handlers.push({ type, event:filter.event, callback }); return this;
  }
  subscribe(callback) { this.subscribeCallback = callback; this.subscribed = true; queueMicrotask(() => callback("SUBSCRIBED")); return this; }
  async track(value) { this.tracked.push(value); return "ok"; }
  async untrack() { this.untracked = true; return "ok"; }
  async send(value) { this.sent.push(value); return "ok"; }
  presenceState() { return this._presence; }
  emit(type, event, payload) { this.handlers.filter((item) => item.type === type && item.event === event).forEach((item) => item.callback(payload)); }
}

function setup() {
  globalThis.MediaStream = FakeMediaStream;
  globalThis.RTCPeerConnection = FakePeerConnection;
  const channels = [];
  const supabase = {
    realtime:{ setAuth:async () => {} },
    channel(topic, options) {
      const realtimeTopic = "realtime:" + topic;
      const existing = channels.find((channel) => channel.topic === realtimeTopic && !channel.removed);
      if (existing) return existing;
      const channel = new FakeChannel(realtimeTopic, options); channels.push(channel); return channel;
    },
    getChannels() { return channels.filter((channel) => !channel.removed); },
    async removeChannel(channel) { channel.removed = true; channel.subscribed = false; }
  };
  return { supabase, channels };
}

test("opens an authorized private channel and publishes presence", async () => {
  const { supabase, channels } = setup();
  const session = new RealtimeWebRTCSession({ supabase, authSession:{ access_token:"token" }, topic:"study-room:public:room", clientId:"b", localStream:new FakeMediaStream(), presence:{ user_id:"user" } });
  await session.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(channels[0].options.config.private, true);
  assert.equal(channels[0].tracked[0].user_id, "user");
  assert.equal(channels[0].sent[0].payload.kind, "ready");
});

test("discovers a peer and sends a deterministic offer", async () => {
  const { supabase, channels } = setup();
  const session = new RealtimeWebRTCSession({ supabase, topic:"dm-call:1", clientId:"a", localStream:new FakeMediaStream([new FakeTrack("audio", "mic")]), maxPeers:1 });
  await session.start();
  await new Promise((resolve) => setImmediate(resolve));
  channels[0]._presence = { b:[{ client_id:"b", user_id:"other" }] };
  channels[0].emit("presence", "sync");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(session.peers.size, 1);
  assert.ok(channels[0].sent.some((message) => message.payload.kind === "description" && message.payload.to === "b"));
});

test("queues ICE until the remote description and then flushes it", async () => {
  const { supabase } = setup();
  const session = new RealtimeWebRTCSession({ supabase, topic:"dm-call:1", clientId:"z", localStream:new FakeMediaStream() });
  await session.start();
  await new Promise((resolve) => setImmediate(resolve));
  await session.handleSignal({ kind:"ice", from:"a", to:"z", candidate:{ candidate:"candidate" } });
  const peer = session.peers.get("a");
  assert.equal(peer.candidates.length, 1);
  await session.handleSignal({ kind:"description", from:"a", to:"z", description:{ type:"offer", sdp:"offer" } });
  assert.equal(peer.candidates.length, 0);
  assert.equal(peer.pc.candidates.length, 1);
});

test("replaces tracks without leaving the old device active and cleans up", async () => {
  const { supabase, channels } = setup();
  const oldTrack = new FakeTrack("video", "old");
  const session = new RealtimeWebRTCSession({ supabase, topic:"dm-call:1", clientId:"a", localStream:new FakeMediaStream([oldTrack]) });
  await session.start();
  await new Promise((resolve) => setImmediate(resolve));
  channels[0]._presence = { b:[{ client_id:"b" }] };
  channels[0].emit("presence", "sync");
  const nextTrack = new FakeTrack("video", "next");
  await session.replaceTrack("video", nextTrack);
  assert.equal(oldTrack.stopped, true);
  assert.equal(session.localStream.getVideoTracks()[0], nextTrack);
  assert.equal(session.peers.get("b").pc.getSenders().find((sender) => sender.track?.kind === "video").track, nextTrack);
  await session.stop();
  assert.equal(session.peers.size, 0);
  assert.equal(channels[0].untracked, true);
  assert.equal(channels[0].removed, true);
});

test("elects one tab per account and keeps stream pods symmetric", async () => {
  const { supabase, channels } = setup();
  const participants = [];
  const session = new RealtimeWebRTCSession({
    supabase,
    topic:"study-room:public:room",
    clientId:"b-tab",
    localStream:new FakeMediaStream(),
    presence:{ user_id:"same-user" },
    maxPeers:1,
    onParticipants:(value) => participants.push(value)
  });
  await session.start();
  await new Promise((resolve) => setImmediate(resolve));
  channels[0]._presence = {
    first:[{ client_id:"a-tab", user_id:"same-user" }],
    duplicate:[{ client_id:"b-tab", user_id:"same-user" }],
    other:[{ client_id:"c-tab", user_id:"other-user" }]
  };
  channels[0].emit("presence", "sync");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(session.peers.size, 0);
  assert.deepEqual(participants.at(-1).map((item) => [item.user_id, item.stream_slot]), [["other-user", false]]);
  await session.handleSignal({ kind:"ready", from:"c-tab", to:"b-tab" });
  assert.equal(session.peers.size, 0);
});

test("keeps the complete public-room roster while limiting only the media circle", async () => {
  const { supabase, channels } = setup();
  const participantUpdates = [];
  const session = new RealtimeWebRTCSession({
    supabase,
    topic:"study-room:public:open-room",
    clientId:"a",
    localStream:new FakeMediaStream(),
    presence:{ user_id:"user-a" },
    maxPeers:2,
    onParticipants:(value) => participantUpdates.push(value)
  });
  await session.start();
  await new Promise((resolve) => setImmediate(resolve));
  channels[0]._presence = {
    b:[{ client_id:"b", user_id:"user-b" }],
    c:[{ client_id:"c", user_id:"user-c" }],
    d:[{ client_id:"d", user_id:"user-d" }],
    e:[{ client_id:"e", user_id:"user-e" }]
  };
  channels[0].emit("presence", "sync");
  await new Promise((resolve) => setImmediate(resolve));

  const roster = participantUpdates.at(-1);
  assert.equal(roster.length, 4);
  assert.deepEqual(roster.map((person) => [person.user_id, person.stream_slot]), [
    ["user-b", true],
    ["user-c", true],
    ["user-d", false],
    ["user-e", false]
  ]);
  assert.equal(session.peers.size, 2);
});

test("replaces a stale subscribed channel before registering presence on rejoin", async () => {
  const { supabase, channels } = setup();
  const first = new RealtimeWebRTCSession({
    supabase,
    topic:"study-room:public:rejoin-room",
    clientId:"first-tab",
    localStream:new FakeMediaStream(),
    presence:{ user_id:"same-user" }
  });
  await first.start();
  await new Promise((resolve) => setImmediate(resolve));
  const staleChannel = channels[0];

  const replacement = new RealtimeWebRTCSession({
    supabase,
    topic:"study-room:public:rejoin-room",
    clientId:"replacement-tab",
    localStream:new FakeMediaStream(),
    presence:{ user_id:"same-user" }
  });
  await replacement.start();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(staleChannel.removed, true);
  assert.notEqual(replacement.channel, staleChannel);
  assert.equal(supabase.getChannels().length, 1);
});
