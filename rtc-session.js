const FALLBACK_ICE_SERVERS = [
  { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }
];

function cloneDescription(description) {
  if (!description) return null;
  return { type: description.type, sdp: description.sdp };
}

function cloneCandidate(candidate) {
  if (!candidate) return null;
  return typeof candidate.toJSON === "function" ? candidate.toJSON() : candidate;
}

function flattenPresence(state) {
  const peers = new Map();
  Object.values(state || {}).forEach(function (entries) {
    (entries || []).forEach(function (entry) {
      if (entry && entry.client_id) peers.set(entry.client_id, entry);
    });
  });
  return peers;
}

export class RealtimeWebRTCSession {
  constructor(options) {
    this.supabase = options.supabase;
    this.authSession = options.authSession;
    this.topic = options.topic;
    this.clientId = options.clientId || crypto.randomUUID();
    this.localStream = options.localStream || new MediaStream();
    this.localPresence = Object.assign({}, options.presence || {}, { client_id: this.clientId });
    this.mediaKinds = options.mediaKinds || ["audio", "video"];
    this.maxPeers = Math.max(1, Number(options.maxPeers || 6));
    this.iceServers = options.iceServers && options.iceServers.length ? options.iceServers : FALLBACK_ICE_SERVERS;
    this.onParticipants = options.onParticipants || function () {};
    this.onRemoteStream = options.onRemoteStream || function () {};
    this.onPeerState = options.onPeerState || function () {};
    this.onEvent = options.onEvent || function () {};
    this.onStatus = options.onStatus || function () {};
    this.channel = null;
    this.peers = new Map();
    this.presence = new Map();
    this.allowedPeerIds = new Set();
    this.hasPresenceSync = false;
    this.started = false;
    this.stopping = false;
  }

  async start() {
    if (this.started) return;
    this.started = true;
    try {
      if (this.authSession && this.authSession.access_token) {
        await this.supabase.realtime.setAuth(this.authSession.access_token);
      } else {
        await this.supabase.realtime.setAuth();
      }

      // supabase-js reuses a channel object when the topic matches. A stale
      // joined channel cannot accept new Presence callbacks, so fully remove
      // it before wiring a fresh session during a retry or rapid rejoin.
      if (typeof this.supabase.getChannels === "function") {
        const realtimeTopic = "realtime:" + this.topic;
        const staleChannels = this.supabase.getChannels().filter(function (channel) {
          return channel && channel.topic === realtimeTopic;
        });
        for (const staleChannel of staleChannels) {
          await this.supabase.removeChannel(staleChannel);
        }
      }

      const self = this;
      this.channel = this.supabase.channel(this.topic, {
        config: {
          private: true,
          broadcast: { self: false, ack: true },
          presence: { key: this.clientId }
        }
      });

      this.channel
        .on("broadcast", { event: "webrtc" }, function (message) {
          self.handleSignal(message && (message.payload || message));
        })
        .on("broadcast", { event: "room-event" }, function (message) {
          const event = message && (message.payload || message);
          if (!event || event.from === self.clientId) return;
          self.onEvent(event.kind, event.payload || {}, event);
        })
        .on("presence", { event: "sync" }, function () {
          self.syncPresence();
        })
        .subscribe(async function (status, error) {
          self.onStatus(status, error || null);
          if (status === "SUBSCRIBED" && self.channel) {
            await self.channel.track(self.localPresence);
            await self.sendSignal("ready", null, { presence: self.localPresence });
          }
        });
    } catch (error) {
      const failedChannel = this.channel;
      this.channel = null;
      this.started = false;
      if (failedChannel) {
        try { await this.supabase.removeChannel(failedChannel); } catch (cleanupError) {}
      }
      throw error;
    }
  }

  syncPresence() {
    if (!this.channel || this.stopping) return;
    const all = flattenPresence(this.channel.presenceState());
    // Include our just-tracked metadata even if Realtime has not echoed it yet.
    all.set(this.clientId, this.localPresence);
    const completePresence = new Map(all);
    all.delete(this.clientId);
    this.presence = all;

    const seenUsers = new Set();
    const localUserId = this.localPresence.user_id;
    const identityFor = function (entry) {
      return (entry[1] && entry[1].user_id) || entry[0];
    };
    const canonical = Array.from(completePresence.entries())
      .sort(function (a, b) { return a[0].localeCompare(b[0]); })
      .filter(function (entry) {
        const identity = identityFor(entry);
        if (seenUsers.has(identity)) return false;
        seenUsers.add(identity);
        return true;
      });
    const localIdentity = localUserId || this.clientId;
    const canonicalLocal = canonical.find(function (entry) { return identityFor(entry) === localIdentity; });
    const isPrimaryTab = !canonicalLocal || canonicalLocal[0] === this.clientId;
    const everyone = canonical.filter(function (entry) { return identityFor(entry) !== localIdentity; });
    const groupSize = this.maxPeers + 1;
    const allIds = canonical.map(function (entry) { return entry[0]; }).sort();
    const ownIndex = allIds.indexOf(this.clientId);
    const groupStart = ownIndex < 0 ? -1 : Math.floor(ownIndex / groupSize) * groupSize;
    const groupIds = new Set(isPrimaryTab && groupStart >= 0 ? allIds.slice(groupStart, groupStart + groupSize) : []);
    groupIds.delete(this.clientId);
    const allowed = everyone.filter(function (entry) { return groupIds.has(entry[0]); });
    const allowedIds = new Set(allowed.map(function (entry) { return entry[0]; }));
    this.allowedPeerIds = allowedIds;
    this.hasPresenceSync = true;
    for (const peerId of this.peers.keys()) {
      if (!allowedIds.has(peerId)) this.removePeer(peerId);
    }

    this.onParticipants(everyone.map(function (entry) {
      return Object.assign({}, entry[1], { client_id: entry[0], stream_slot: allowedIds.has(entry[0]) });
    }));

    const self = this;
    allowed.forEach(function (entry) {
      const peerId = entry[0];
      self.ensurePeer(peerId, entry[1]);
      if (self.clientId < peerId) self.negotiate(peerId);
    });
  }

  ensurePeer(peerId, metadata) {
    if (!peerId || peerId === this.clientId) return null;
    if (this.peers.has(peerId)) {
      const existing = this.peers.get(peerId);
      existing.metadata = Object.assign({}, existing.metadata, metadata || {});
      return existing;
    }
    if (this.peers.size >= this.maxPeers) return null;

    const self = this;
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceCandidatePoolSize: 8,
      bundlePolicy: "max-bundle"
    });
    const peer = {
      id: peerId,
      pc: pc,
      metadata: metadata || {},
      makingOffer: false,
      ignoreOffer: false,
      polite: this.clientId > peerId,
      candidates: [],
      remoteStream: new MediaStream(),
      restartTimer: null
    };
    this.peers.set(peerId, peer);

    this.mediaKinds.forEach(function (kind) {
      const track = self.localStream.getTracks().find(function (item) { return item.kind === kind; });
      if (track) pc.addTrack(track, self.localStream);
      else pc.addTransceiver(kind, { direction: "sendrecv" });
    });

    pc.onicecandidate = function (event) {
      if (event.candidate) self.sendSignal("ice", peerId, { candidate: cloneCandidate(event.candidate) });
    };
    pc.ontrack = function (event) {
      const stream = event.streams && event.streams[0];
      if (stream) peer.remoteStream = stream;
      else if (!peer.remoteStream.getTracks().some(function (item) { return item.id === event.track.id; })) {
        peer.remoteStream.addTrack(event.track);
      }
      self.onRemoteStream(peerId, peer.remoteStream, peer.metadata, event.track);
    };
    pc.onconnectionstatechange = function () {
      const status = pc.connectionState;
      self.onPeerState(peerId, status, peer.metadata);
      clearTimeout(peer.restartTimer);
      if (status === "failed" || status === "disconnected") {
        peer.restartTimer = setTimeout(function () {
          if (!self.peers.has(peerId) || pc.connectionState === "connected") return;
          if (self.clientId < peerId) self.negotiate(peerId, true);
        }, status === "failed" ? 500 : 3500);
      }
      if (status === "closed") self.removePeer(peerId, false);
    };
    pc.onnegotiationneeded = function () {
      if (self.clientId < peerId) self.negotiate(peerId);
    };
    return peer;
  }

  async negotiate(peerId, iceRestart) {
    const peer = this.peers.get(peerId);
    if (!peer || peer.makingOffer || peer.pc.signalingState !== "stable") return;
    peer.makingOffer = true;
    try {
      const offer = await peer.pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
      if (peer.pc.signalingState !== "stable") return;
      await peer.pc.setLocalDescription(offer);
      await this.sendSignal("description", peerId, { description: cloneDescription(peer.pc.localDescription) });
    } catch (error) {
      this.onPeerState(peerId, "error", peer.metadata, error);
    } finally {
      peer.makingOffer = false;
    }
  }

  async handleSignal(signal) {
    if (!signal || signal.from === this.clientId || (signal.to && signal.to !== this.clientId)) return;
    const peerId = signal.from;
    if (this.hasPresenceSync && !this.allowedPeerIds.has(peerId)) return;
    const peer = this.ensurePeer(peerId, signal.presence || this.presence.get(peerId) || {});
    if (!peer) return;
    const pc = peer.pc;
    try {
      if (signal.kind === "ready") {
        if (this.clientId < peerId) await this.negotiate(peerId);
        return;
      }
      if (signal.kind === "description" && signal.description) {
        const description = signal.description;
        const collision = description.type === "offer" && (peer.makingOffer || pc.signalingState !== "stable");
        peer.ignoreOffer = !peer.polite && collision;
        if (peer.ignoreOffer) return;
        await pc.setRemoteDescription(description);
        await this.flushCandidates(peer);
        if (description.type === "offer") {
          await pc.setLocalDescription(await pc.createAnswer());
          await this.sendSignal("description", peerId, { description: cloneDescription(pc.localDescription) });
        }
        return;
      }
      if (signal.kind === "ice" && signal.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(signal.candidate);
        else peer.candidates.push(signal.candidate);
        return;
      }
      if (signal.kind === "leave") this.removePeer(peerId);
    } catch (error) {
      if (!peer.ignoreOffer) this.onPeerState(peerId, "error", peer.metadata, error);
    }
  }

  async flushCandidates(peer) {
    if (!peer.pc.remoteDescription) return;
    const candidates = peer.candidates.splice(0);
    for (const candidate of candidates) {
      try { await peer.pc.addIceCandidate(candidate); }
      catch (error) { /* Ignore candidates from an obsolete negotiation. */ }
    }
  }

  async sendSignal(kind, to, payload) {
    if (!this.channel) return false;
    const result = await this.channel.send({
      type: "broadcast",
      event: "webrtc",
      payload: Object.assign({ kind: kind, from: this.clientId, to: to || null }, payload || {})
    });
    return result === "ok";
  }

  async sendEvent(kind, payload) {
    if (!this.channel) return false;
    const result = await this.channel.send({
      type: "broadcast",
      event: "room-event",
      payload: { kind: kind, from: this.clientId, payload: payload || {} }
    });
    return result === "ok";
  }

  async updatePresence(patch) {
    this.localPresence = Object.assign({}, this.localPresence, patch || {}, { client_id: this.clientId });
    if (this.channel) await this.channel.track(this.localPresence);
  }

  async replaceTrack(kind, nextTrack) {
    const previous = this.localStream.getTracks().find(function (track) { return track.kind === kind; });
    if (previous && previous !== nextTrack) {
      this.localStream.removeTrack(previous);
      previous.stop();
    }
    if (nextTrack && !this.localStream.getTracks().includes(nextTrack)) this.localStream.addTrack(nextTrack);
    const jobs = [];
    this.peers.forEach(function (peer) {
      const transceiver = peer.pc.getTransceivers().find(function (item) {
        return (item.sender.track && item.sender.track.kind === kind) || (item.receiver.track && item.receiver.track.kind === kind);
      });
      if (transceiver) jobs.push(transceiver.sender.replaceTrack(nextTrack || null));
    });
    await Promise.all(jobs);
  }

  setTrackEnabled(kind, enabled) {
    this.localStream.getTracks().filter(function (track) { return track.kind === kind; }).forEach(function (track) {
      track.enabled = Boolean(enabled);
    });
  }

  removePeer(peerId, notify) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    clearTimeout(peer.restartTimer);
    peer.pc.ontrack = null;
    peer.pc.onicecandidate = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.onnegotiationneeded = null;
    peer.pc.close();
    this.peers.delete(peerId);
    if (notify !== false) this.onPeerState(peerId, "left", peer.metadata);
  }

  async stop(options) {
    if (this.stopping) return;
    this.stopping = true;
    const notify = !options || options.notify !== false;
    if (notify) await this.sendSignal("leave");
    if (this.channel) {
      try { await this.channel.untrack(); } catch (error) {}
      const channel = this.channel;
      this.channel = null;
      await this.supabase.removeChannel(channel);
    }
    Array.from(this.peers.keys()).forEach(this.removePeer.bind(this));
    this.presence.clear();
    this.allowedPeerIds.clear();
    this.hasPresenceSync = false;
    this.started = false;
    this.stopping = false;
  }
}

export function defaultIceServers(extraServers) {
  return Array.isArray(extraServers) && extraServers.length ? extraServers : FALLBACK_ICE_SERVERS;
}
