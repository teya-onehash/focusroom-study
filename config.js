// Publishable browser credentials. Row-level security protects private data.
export const SUPABASE_URL = "https://fhexyiexginuzriwmfol.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_3j_r9z4Js-4RJrbU8JQmTA_B47lCS21";

// Add short-lived TURN credentials here when a relay service is connected.
// The built-in STUN entries cover many ordinary home and mobile networks.
export const WEBRTC_ICE_SERVERS = [
  { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }
];

// Optional Supabase Edge Function that returns short-lived { iceServers: [] }.
// Keep permanent TURN secrets in Edge Function secrets, never in this file.
export const WEBRTC_TURN_FUNCTION = "";

// Add Stripe-hosted Checkout or Payment Link URLs after the Stripe account is connected.
// Stripe Checkout can show Apple Pay automatically on supported Apple devices.
export const CHECKOUT_URLS = {
  basic_month: "",
  premium_month: "",
  premium_year: "",
  buddy_month: "",
};
