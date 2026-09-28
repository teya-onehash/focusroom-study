// Publishable browser credentials. Row-level security protects private data.
export const SUPABASE_URL = "https://fhexyiexginuzriwmfol.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_3j_r9z4Js-4RJrbU8JQmTA_B47lCS21";

// Public STUN fallback. Short-lived TURN credentials are appended at runtime
// by WEBRTC_TURN_FUNCTION and must never be hardcoded in this public file.
export const WEBRTC_ICE_SERVERS = [
  { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }
];

// Optional Supabase Edge Function that returns short-lived { iceServers: [] }.
// Keep permanent TURN secrets in Edge Function secrets, never in this file.
export const WEBRTC_TURN_FUNCTION = "";
