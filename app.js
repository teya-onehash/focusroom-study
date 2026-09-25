import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.1/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, CHECKOUT_URLS, WEBRTC_ICE_SERVERS, WEBRTC_TURN_FUNCTION } from "./config.js?v=20260925-2";
import { RealtimeWebRTCSession } from "./rtc-session.js?v=20260925-2";

// Public rooms never reject someone because the room is busy. WebRTC media is
// divided into small, deterministic circles so the open room can grow without
// forcing every phone to upload a separate stream to every other participant.
const PUBLIC_STREAM_CIRCLE_SIZE = 6;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const app = document.querySelector("#app");
const modalRoot = document.querySelector("#modalRoot");
const toastEl = document.querySelector("#toast");
const savedPreferences = (function () {
  try { return JSON.parse(localStorage.getItem("mellow-commons-study-preferences") || "{}"); }
  catch (error) { return {}; }
}());
const defaultPreferences = { defaultDuration:50, defaultRoom:"deep-focus", defaultCamera:false, defaultMicrophone:false, soundCues:true, compactMode:false };
const studyPreferences = Object.assign({}, defaultPreferences, savedPreferences);

const state = {
  session: null,
  user: null,
  profile: null,
  rooms: [],
  goals: [],
  sessions: [],
  subscription: null,
  allowance: { plan: "free", encouragements_remaining: 5, boosts_remaining: 0 },
  admin: null,
  adminStats: null,
  adminMembers: [],
  adminReports: [],
  adminRooms: [],
  adminSearch: "",
  encouragements: [],
  members: [],
  memberProfile: null,
  memberInsights: null,
  profileTab: "summary",
  profileReturnView: "encouragements",
  conversations: [],
  activeConversationId: null,
  messages: [],
  messageMedia: {},
  messageReactions: {},
  messageMenuId: null,
  messageEmojiOpen: false,
  messageDraft: "",
  dmChannel: null,
  dmCalls: [],
  pendingDmCalls: [],
  dmCallChannel: null,
  notifiedDmCalls: new Set(),
  activeDmCallId: null,
  pendingDmStart: null,
  socialCallPerson: null,
  socialCallMode: null,
  socialCallConnected: false,
  socialCallStartedAt: null,
  socialCallTimerId: null,
  socialMicMuted: false,
  socialVideoMuted: false,
  localCallStream: null,
  remoteCallStream: null,
  callFacingMode: "user",
  voiceRecorder: null,
  voiceStream: null,
  voiceChunks: [],
  voiceTimer: null,
  privateRooms: [],
  roomCounts: {},
  channels: [],
  communityChannels: [],
  activeChannelId: null,
  channelMessages: [],
  communityChannel: null,
  feedbackPosts: [],
  feedbackSort: "new",
  feedbackCategory: "all",
  feedbackSearch: "",
  buddyPosts: [],
  buddySearch: "",
  presenceChannel: null,
  view: "home",
  activeRoom: null,
  rtcSession: null,
  rtcClientId: null,
  roomParticipants: [],
  roomPeerStates: {},
  roomChat: [],
  roomChatOpen: false,
  roomPeopleOpen: false,
  roomEffectsOpen: false,
  roomEffect: localStorage.getItem("mellow-room-effect") || "natural",
  roomMirror: localStorage.getItem("mellow-room-mirror") !== "false",
  roomQuality: localStorage.getItem("mellow-room-quality") || "balanced",
  roomAudioOnly: false,
  roomConnectedAt: null,
  roomTimerId: null,
  previewStream: null,
  previewAudioContext: null,
  previewAnimation: null,
  pendingRoom: null,
  pendingPrivate: false,
  meetingFrame: localStorage.getItem("mellow-meeting-frame") || "none",
  meetingSticker: localStorage.getItem("mellow-meeting-sticker") || "",
  accountMenuOpen: false,
  chatMenuOpen: false,
  focusAllowance: { plan:"free", limit_minutes:240, used_seconds:0, remaining_seconds:14400, is_unlimited:false },
  focusVisitId: null,
  focusHeartbeat: null,
  focusHeartbeatBusy: false,
  leavingMeeting: false,
  joinDraft: { intention: "", duration: Number(studyPreferences.defaultDuration), camera: Boolean(studyPreferences.defaultCamera), microphone: Boolean(studyPreferences.defaultMicrophone) },
  preferences: studyPreferences,
  timerSeconds: 25 * 60,
  timerPreset: 25,
  timerRunning: false,
  timerId: null,
  ambient: "none",
  theme: document.documentElement.dataset.theme || "dark",
  audio: null,
  authMode: "signup",
  pendingVerificationEmail: "",
  mobileNav: false,
  navCollapsed: localStorage.getItem("mellow-nav-collapsed") === "true"
};

const blogs = [
  {
    id: "body-doubling",
    tag: "Focus science",
    title: "Why studying beside someone can make starting easier",
    excerpt: "Body doubling adds gentle social structure without turning focus into a competition.",
    body: "<p>Body doubling means doing your own work while another person is present and working too. You are not expected to collaborate. The value is the quiet sense that someone else has also chosen to begin.</p><h3>Make the room work for you</h3><p>Choose one clear task before you join. Keep your microphone muted, put distractions out of reach, and use the first minute to write a tiny finish line: one page, ten questions, or twenty-five focused minutes.</p><h3>Camera choice and comfort</h3><p>Your camera is always your choice. A desk view, virtual background, or camera-off session can still provide structure. Mellow Commons starts calls muted and with video off so you decide what to share.</p>"
  },
  {
    id: "fifty-ten",
    tag: "Study method",
    title: "Try the 50/10 rhythm for deeper sessions",
    excerpt: "A longer focus block can reduce the restart cost that comes with very short intervals.",
    body: "<p>The 50/10 rhythm is simple: focus for fifty minutes, then take ten minutes away from the task. It can suit revision, essays, problem sets, and other work that takes time to settle into.</p><h3>Prepare the block</h3><p>Decide what success looks like before starting. Close unrelated tabs, keep water nearby, and write distractions on paper instead of following them.</p><h3>Use the break</h3><p>Stand up, look away from the screen, and move. Avoid replacing studying with another demanding screen activity. When you return, choose the next concrete target.</p>"
  },
  {
    id: "calm-space",
    tag: "Wellbeing",
    title: "Build a calmer digital study space",
    excerpt: "Lighting, sound, and a small start ritual can make your study environment feel dependable.",
    body: "<p>A good ambience should support attention rather than demand it. Use low visual contrast, a single background sound, and only the tools needed for the current task.</p><h3>Create a start ritual</h3><p>Open your notes, set one goal, choose an ambience, and start the timer. Repeating the same short sequence helps your brain recognize that focus time is beginning.</p><h3>Protect your energy</h3><p>Long sessions are not automatically better. Stop when your planned block ends, record the progress, and take a real break. Consistency matters more than exhaustion.</p>"
  }
];

const prompts = [
  "What is the smallest useful thing you can finish in the next 25 minutes?",
  "Choose progress over perfect. What can you move forward today?",
  "Write one sentence describing what done looks like for this session.",
  "Clear one distraction, take one breath, and begin with the easiest step.",
  "Future you only needs present you to start."
];

function esc(value) {
  return String(value == null ? "" : value)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function initials(name) {
  return String(name || "S").split(/\s+/).slice(0, 2).map(function (part) { return part[0]; }).join("").toUpperCase();
}

function avatarUrl(path) {
  if (!path) return "";
  return supabase.storage.from("profile-avatars").getPublicUrl(path).data.publicUrl || "";
}

function avatarMarkup(person, extraClass) {
  const item = person || {};
  const url = avatarUrl(item.avatar_path);
  const frame = String(item.profile_frame || "none").replace(/[^a-z-]/g, "");
  const sticker = stickerGlyph(item.profile_sticker);
  const classes = "avatar frame-" + frame + (extraClass ? " " + extraClass : "") + (url ? " has-photo" : "");
  const color = esc(item.avatar_color || "#7c6cff");
  return '<span class="avatar-wrap"><span class="' + classes + '" style="background:' + color + '">' +
    (url ? '<img src="' + esc(url) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : initials(item.display_name)) +
    '</span>' + (sticker ? '<span class="avatar-sticker" aria-hidden="true">' + sticker + '</span>' : '') + '</span>';
}

function stickerGlyph(name) {
  return ({ moon:"☾", sprout:"🌱", sparkles:"✦", books:"📚", coffee:"☕", flower:"✿" })[name] || "";
}

function brandLogo() {
  return '<span class="brand-logo" aria-hidden="true"><svg viewBox="0 0 64 64" role="img"><defs><linearGradient id="mellowMark" x1="9" y1="8" x2="56" y2="58" gradientUnits="userSpaceOnUse"><stop stop-color="#a99cff"/><stop offset=".55" stop-color="#7461ef"/><stop offset="1" stop-color="#55d7ad"/></linearGradient></defs><rect x="3" y="3" width="58" height="58" rx="19" fill="url(#mellowMark)"/><path d="M14 43V28c0-8 4.8-13 12-13s12 5.2 12 13v15M26 43V30c0-8 4.8-13 12-13s12 5 12 13v13" fill="none" stroke="white" stroke-width="5.2" stroke-linecap="round"/><circle cx="32" cy="44" r="3.2" fill="#dfffee"/></svg></span>';
}

async function resolveIceServers() {
  if (!WEBRTC_TURN_FUNCTION) return WEBRTC_ICE_SERVERS;
  try {
    const response = await supabase.functions.invoke(WEBRTC_TURN_FUNCTION);
    const relays = response.data && Array.isArray(response.data.iceServers) ? response.data.iceServers : [];
    if (!response.error && relays.length) return WEBRTC_ICE_SERVERS.concat(relays);
  } catch (error) { /* Fall back to STUN and surface relay failures through connection state. */ }
  return WEBRTC_ICE_SERVERS;
}

const profileBanners = [
  ["midnight", "Midnight"], ["aurora", "Aurora"], ["cherry", "Cherry pop"],
  ["ocean", "Ocean"], ["sunset", "Sunset"], ["matcha", "Matcha"],
  ["notebook", "Notebook"], ["arcade", "Arcade"]
];

const achievementLevels = [
  [100, "Commons Legend", "✦"], [60, "Quiet Power", "◆"], [30, "Deep Roots", "❋"],
  [14, "Steady Glow", "☀"], [7, "Cozy Week", "☕"], [3, "Soft Start", "🌱"],
  [1, "First Light", "◌"]
];

function safeBanner(value) {
  const banner = String(value || "midnight");
  return profileBanners.some(function (item) { return item[0] === banner; }) ? banner : "midnight";
}

function showAchievementCelebration(days) {
  const badge = achievementLevels.find(function (item) { return item[0] === Number(days); });
  if (!badge) return;
  const confetti = Array.from({ length:18 }, function (_, index) { return '<i style="--i:' + index + '"></i>'; }).join("");
  showModal("Achievement unlocked", '<div class="achievement-celebration"><div class="celebration-confetti" aria-hidden="true">' + confetti + '</div><span class="celebration-badge">' + badge[2] + '</span><span class="eyebrow">' + badge[0] + ' day streak</span><h2>' + esc(badge[1]) + '</h2><p>This badge is earned from real completed focus days. Keep showing up at your own pace.</p><button class="btn btn-primary" data-close-modal>Nice ✦</button></div>');
}

function authReturnUrl() {
  return new URL(".", window.location.href).href.split("#")[0].split("?")[0];
}

function dailyTimeLabel() {
  if (!state.focusAllowance || state.focusAllowance.is_unlimited) return "Daily room time · unlimited";
  return "Daily room time · " + fmtMinutes(Math.max(0, Math.ceil(Number(state.focusAllowance.remaining_seconds || 0) / 60))) + " left";
}

function planLabel(plan) {
  const value = plan === "plus" ? "premium" : (plan || "free");
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function fmtMinutes(total) {
  const n = Number(total || 0);
  if (n < 60) return n + "m";
  return Math.floor(n / 60) + "h " + (n % 60) + "m";
}

function formatTimer() {
  const minutes = Math.floor(state.timerSeconds / 60).toString().padStart(2, "0");
  const seconds = (state.timerSeconds % 60).toString().padStart(2, "0");
  return minutes + ":" + seconds;
}

function showToast(message, error) {
  toastEl.textContent = message;
  toastEl.className = "toast show" + (error ? " error" : "");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(function () { toastEl.className = "toast"; }, 3600);
}

function closeModal() {
  stopDevicePreview();
  state.pendingRoom = null;
  state.pendingPrivate = false;
  state.pendingDmStart = null;
  modalRoot.innerHTML = "";
}

function showModal(title, content, large) {
  modalRoot.innerHTML = '<div class="modal-backdrop" data-close-modal><div class="modal' + (large ? ' modal-lg' : '') + '" role="dialog" aria-modal="true"><div class="modal-head"><h2>' + esc(title) + '</h2><button class="btn icon-btn" data-close-modal aria-label="Close">×</button></div>' + content + '</div></div>';
}

function baseBackground() {
  return '<div class="ambient-bg" aria-hidden="true"></div>';
}

function themeToggle() {
  const next = state.theme === "dark" ? "light" : "dark";
  return '<button class="btn btn-sm theme-toggle" data-theme-toggle aria-label="Switch to ' + next + ' mode" title="Switch to ' + next + ' mode"><span aria-hidden="true">' + (state.theme === "dark" ? "☀" : "☾") + '</span><span class="theme-label">' + (state.theme === "dark" ? "Light" : "Dark") + '</span></button>';
}

function setTheme(theme) {
  state.theme = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = state.theme;
  document.querySelector('meta[name="theme-color"]').setAttribute("content", state.theme === "light" ? "#f8f7fc" : "#090b13");
  localStorage.setItem("mellow-commons-theme", state.theme);
  renderApp();
}

function publicHeader() {
  return '<header class="topbar"><a class="brand" href="#" data-public-home aria-label="Mellow Commons home">' + brandLogo() + '<span>Mellow Commons</span></a><nav class="top-links"><a href="#rooms">Rooms</a><a href="#features">Features</a><a href="#pricing">Plans</a><a href="#journal">Journal</a>' + themeToggle() + '<button class="btn btn-sm" data-auth="login">Log in</button><button class="btn btn-primary btn-sm" data-auth="signup">Join free</button></nav></header>';
}

function roomCards(publicMode) {
  if (!state.rooms.length) return '<div class="skeleton"></div><div class="skeleton"></div>';
  return state.rooms.map(function (room) {
    const count = state.roomCounts[room.slug] || 0;
    return '<article class="card room-card"><div class="room-icon">' + esc(room.icon) + '</div><div><div class="room-title-line"><h3>' + esc(room.name) + '</h3><span class="room-mode">' + (room.slug === "study-cafe" ? "Social breaks" : "Quiet focus") + '</span></div><p>' + esc(room.description) + '</p><div class="room-live-row"><div class="live-dot"><span data-room-count="' + esc(room.slug) + '">' + count + '</span> connected now</div><span class="room-access">Open room · no join limit</span></div></div><button class="btn btn-sm ' + (publicMode ? '' : 'btn-primary') + '" data-join-room="' + esc(room.id) + '">' + (publicMode ? 'Preview' : 'Set up & join') + '</button></article>';
  }).join("");
}

function pricingCards() {
  const plans = [
    { key: "free", name: "Free", price: "$0", unit: "forever", note: "Start here", perks:["4 hours in public focus rooms each day","Timer, goals, history, and ambience","Text, image, and voice-note DMs","Up to 500 messages per day","Pin up to 4 study partners","30 encouragements per day"] },
    { key: "basic_month", name: "Basic", price: "$1.99", unit: "/ month", note: "More community", perks:["8 hours in public focus rooms each day","Up to 1,000 messages per day","60 encouragements per day","Pin up to 20 study partners","Full access to student channels","Everything in Free"] },
    { key: "premium_month", name: "Premium", price: "$6.99", unit: "/ month", note: "Private calls", popular:true, annual:true, perks:["Unlimited public focus-room time","Unlimited standard DMs*","Start private audio or video calls from DMs","Host invite-only rooms for up to 6 people","Pin up to 40 study partners","300 encouragements per day"] },
    { key: "buddy_month", name: "Buddy", price: "$12.99", unit: "/ month", note: "For two", perks:["Premium access for you and one friend","Unlimited focus-room time for both","Unlimited standard DMs*","Private audio and video calls","Separate private accounts and histories","One subscription manages both seats"] }
  ];
  return plans.map(function (plan) {
    return '<article class="card price-card' + (plan.popular ? ' popular' : '') + '">' +
      (plan.popular ? '<span class="popular-tag">Recommended</span>' : '') +
      '<span class="eyebrow">' + plan.note + '</span><h3>' + plan.name + '</h3><div class="price">' + plan.price + '<small>' + plan.unit + '</small></div>' +
      (plan.annual ? '<div class="annual-note"><strong>$5.83/month</strong> when billed yearly at $69.96</div>' : '') +
      '<ul class="perk-list">' + plan.perks.map(function (perk) { return '<li>' + perk + '</li>'; }).join("") + '</ul>' +
      (plan.key === "free" ? '<button class="btn" ' + (state.session ? 'data-view="rooms"' : 'data-auth="signup"') + '>Use Mellow Commons free</button>' : '<button class="btn btn-primary" data-checkout="' + plan.key + '">Choose ' + plan.name + '</button>' + (plan.annual ? '<button class="btn btn-sm annual-button" data-checkout="premium_year">Choose annual Premium</button>' : '')) +
      (plan.key === "free" ? '<span class="apple-pay">No card required</span>' : '<span class="apple-pay">Secure Stripe checkout · Apple Pay on eligible devices once activated</span>') + '</article>';
  }).join("");
}

function blogCards() {
  return blogs.map(function (post) {
    return '<article class="card blog-card" data-blog="' + post.id + '"><span class="tag">' + post.tag + '</span><h3>' + post.title + '</h3><p>' + post.excerpt + '</p><span class="read">Read article →</span></article>';
  }).join("");
}

function renderLanding() {
  const totalOnline = Object.values(state.roomCounts).reduce(function(a,b){return a+b;},0);
  const previewRooms = state.rooms.slice(0, 3).map(function (room) {
    return '<div class="preview-room"><span class="room-icon">' + esc(room.icon) + '</span><div><strong>' + esc(room.name) + '</strong><small><span data-room-count="' + esc(room.slug) + '">' + (state.roomCounts[room.slug] || 0) + '</span> connected</small></div><span class="preview-status">Open</span></div>';
  }).join("");
  app.innerHTML = baseBackground() + '<div class="landing">' + publicHeader() +
    '<main><section class="hero"><div class="hero-copy"><span class="eyebrow">Live focus rooms · free to join</span><h1><span class="gradient-text">Open a room.</span><br>Start the work.</h1><p>Choose what you are working on, test your camera and microphone, and focus beside other students in an always-open study space.</p><div class="hero-actions"><button class="btn btn-primary" data-auth="signup">Create a free account</button><a class="btn" href="#rooms">See the live rooms</a></div><div class="trust-row"><span>Device check before joining</span><span>Camera always optional</span><span>Real live counts</span></div></div>' +
    '<div class="hero-visual product-preview" aria-label="Mellow Commons product preview"><div class="preview-top"><div><span class="eyebrow">Live focus floor</span><h2>Choose your room</h2></div><span class="online-pill"><i></i>' + totalOnline + ' online</span></div><div class="preview-intention"><span>Today’s intention</span><strong>Finish one clear task</strong><div class="preview-progress"><i></i></div></div><div class="preview-room-list">' + (previewRooms || '<div class="skeleton"></div>') + '</div><div class="preview-footer"><span>25</span><span class="active">50</span><span>90 min</span><button class="btn btn-primary btn-sm" data-auth="signup">Start session</button></div></div></section>' +
    '<section class="section" id="rooms"><div class="section-head"><div><span class="eyebrow">Live rooms · no join limit</span><h2>Find your focus atmosphere</h2></div><p>Public rooms stay open as the community grows. Every number is based on people actually connected through live Presence.</p></div><div class="room-grid">' + roomCards(true) + '</div></section>' +
    '<section class="section session-steps"><div class="section-head"><div><span class="eyebrow">A real session, not another feed</span><h2>From intention to finished work</h2></div></div><div class="grid-3"><article class="card step-card"><span>01</span><h3>Name the task</h3><p>Write one concrete intention and choose a preset or your own focus duration.</p></article><article class="card step-card"><span>02</span><h3>Check your setup</h3><p>Preview video, confirm microphone activity, and choose the exact devices you want.</p></article><article class="card step-card"><span>03</span><h3>Focus with others</h3><p>Join muted or camera-off, use the timer, and save finished sessions to your history.</p></article></div></section>' +
    '<section class="section" id="features"><div class="section-head"><div><span class="eyebrow">Made for momentum</span><h2>More than a video call</h2></div></div><div class="bento"><article class="card feature-card"><div class="feature-icon">◷</div><div><h3>Focus timer and goals</h3><p>Choose a preset or custom duration, write the next task, and save completed sessions to your history.</p></div></article><article class="card feature-card"><div class="feature-icon">♡</div><div><h3>Real encouragement</h3><p>Send thoughtful support to people who are showing up. Daily allowances scale with your membership.</p></div></article><article class="card feature-card"><div class="feature-icon">☾</div><div><h3>Cozy ambience</h3><p>Use generated rain, café, or fireside sound without opening another distracting tab.</p></div></article></div></section>' +
    '<section class="section" id="pricing"><div class="section-head"><div><span class="eyebrow">Simple student pricing</span><h2>Free for focus. Upgrade for connection.</h2></div><p>Public-room time scales by plan. Private audio and video calls are reserved for Premium and Buddy.</p></div><div class="pricing-grid pricing-four">' + pricingCards() + '</div><p class="plan-fine-print">*Unlimited messaging is intended for normal person-to-person use and remains protected by anti-spam, blocking, reporting, file-size, and safety controls.</p></section>' +
    '<section class="section" id="journal"><div class="section-head"><div><span class="eyebrow">Focus journal</span><h2>Small ideas that help</h2></div></div><div class="grid-3">' + blogCards() + '</div></section></main>' +
    '<footer class="footer"><div><button class="brand brand-button" data-public-home>' + brandLogo() + '<span>Mellow Commons</span></button><p>Study together without the pressure.</p></div><div><button class="btn btn-sm" data-privacy>Privacy</button> <button class="btn btn-sm" data-auth="login">Member login</button></div></footer></div>';
}

function renderAuth() {
  const signup = state.authMode === "signup";
  app.innerHTML = baseBackground() + '<main class="auth-stage"><button class="auth-stage-close" data-public-home aria-label="Close">×</button><section class="auth-promise"><a class="brand" href="#" data-public-home>' + brandLogo() + '<span>Mellow Commons</span></a><span class="eyebrow">A softer place to get things done</span><h1>Study beside people who are trying too.</h1><p>Join live rooms, track quiet progress, find a study buddy, and keep your momentum in one calm student commons.</p><div class="auth-mini-room"><div class="auth-avatar-row"><i></i><i></i><i></i><i></i></div><strong>Deep Focus · live now</strong><small>Camera is always your choice</small></div></section><section class="card auth-card auth-modal"><div class="auth-head"><div><span class="eyebrow">' + (signup ? 'Join the commons' : 'Welcome back') + '</span><h2>' + (signup ? 'Create your account' : 'Log in to Mellow Commons') + '</h2></div>' + themeToggle() + '</div><button class="btn google-auth" data-google-auth><span>G</span>Continue with Google</button><div class="auth-divider"><span>or use email</span></div><form class="form" id="authForm">' +
    (signup ? '<div class="field"><label for="displayName">Display name</label><input id="displayName" name="displayName" minlength="2" maxlength="40" required autocomplete="name" placeholder="How students will see you"></div>' : '') +
    '<div class="field"><label for="email">Email address</label><input id="email" name="email" type="email" required autocomplete="email" placeholder="you@example.com"></div><div class="field password-field"><label for="password">Password</label><input id="password" name="password" type="password" minlength="8" required autocomplete="' + (signup ? 'new-password' : 'current-password') + '" placeholder="At least 8 characters"><button type="button" data-password-toggle aria-label="Show password">Show</button></div>' +
    (!signup ? '<button type="button" class="text-action" data-forgot-password>Forgot password?</button>' : '') + '<button class="btn btn-primary auth-submit" type="submit">' + (signup ? 'Create free account' : 'Log in') + '</button><p class="form-note">' + (signup ? 'By joining, you agree to keep the commons respectful. Camera and microphone stay off until you choose otherwise.' : 'Your goals, messages, and focus history will be waiting.') + '</p></form><p class="auth-switch">' + (signup ? 'Already a member? <button data-auth-tab="login">Log in</button>' : 'New here? <button data-auth-tab="signup">Create an account</button>') + '</p>' + (!signup ? '<button class="btn btn-link" data-open-resend>Didn’t receive a verification email?</button>' : '') + '</section></main>';
}

function navItems() {
  const items = [
    ["home","⌂","Home"], ["rooms","◎","Study rooms"], ["goals","✓","Goals & progress"],
    ["encouragements","♡","Community"], ["buddies","♧","Study buddies"], ["community","◌","Conversations"],
    ["blog","▤","Focus journal"], ["feedback","△","Feedback"]
  ];
  if (state.admin && state.admin.is_admin) items.push(["admin","◆","Admin center"]);
  return items.map(function (item) {
    return '<button class="side-link ' + (state.view === item[0] ? 'active' : '') + '" data-view="' + item[0] + '" title="' + esc(item[2]) + '" aria-label="' + esc(item[2]) + '"><span class="nav-icon" aria-hidden="true">' + item[1] + '</span><span class="nav-label">' + item[2] + '</span></button>';
  }).join("");
}

function appShell(content, title) {
  const name = state.profile ? state.profile.display_name : "Student";
  const plan = state.allowance.plan === "plus" ? "premium" : state.allowance.plan;
  const membership = state.admin && state.admin.role === "owner"
    ? '<span class="owner-badge">◆ OWNER · ' + esc(String(plan).toUpperCase()) + '</span>'
    : (plan !== "free" ? '<span class="plus-badge">✦ ' + esc(String(plan).toUpperCase()) + '</span>' : 'Free member');
  const accountMenu = state.accountMenuOpen ? '<div class="account-menu popover"><div class="account-summary">' + avatarMarkup(state.profile) + '<span><strong>' + esc(name) + '</strong><small>' + membership + '</small></span></div><button data-member-profile="' + esc(state.user.id) + '">● View public profile</button><button data-view="profile">✎ Edit profile</button><button data-view="settings">⚙ Privacy & settings</button><button data-view="plus">✦ Manage membership</button>' + (state.admin && state.admin.is_admin ? '<button data-view="admin">◆ Admin center</button>' : '') + '<button class="danger" data-signout>↪ Log out</button></div>' : '';
  const chatRows = state.conversations.slice(0, 4).map(function (conversation) { const person = conversationPerson(conversation); return '<button data-conversation="' + esc(conversation.id) + '">' + avatarMarkup(person) + '<span><strong>' + esc(person.display_name) + '</strong><small>' + esc(messagePreview(conversation)) + '</small></span></button>'; }).join("");
  const chatMenu = state.chatMenuOpen ? '<div class="quick-chat popover"><div class="popover-title"><strong>Chats</strong><button data-view="community">Open all →</button></div><button class="channel-shortcut" data-channel-slug="general"><span>#</span><strong>General channel</strong></button>' + (chatRows || '<p class="empty">Your conversations will appear here.</p>') + '</div>' : '';
  const collapsed = state.navCollapsed ? " nav-collapsed" : "";
  app.innerHTML = baseBackground() + '<div class="app-layout' + collapsed + '"><aside class="sidebar ' + (state.mobileNav ? 'open' : '') + (state.navCollapsed ? ' collapsed' : '') + '"><button class="brand brand-button sidebar-brand" data-view="home" aria-label="Go to home">' + brandLogo() + '<span class="brand-name">Mellow<br><small>Commons</small></span></button><nav class="side-nav">' + navItems() + '</nav><div class="sidebar-streak"><span>🔥</span><strong>' + streakDays() + ' day streak</strong><small>Focus for 30m to grow it</small></div></aside><main class="main"><header class="app-top"><div class="top-title"><button class="btn icon-btn nav-toggle" data-toggle-nav aria-label="' + (state.navCollapsed ? 'Expand navigation' : 'Collapse navigation') + '" aria-pressed="' + String(state.navCollapsed) + '">☰</button><h2>' + esc(title) + '</h2><span class="daily-time">' + dailyTimeLabel() + '</span></div><div class="app-top-actions"><button class="unlock-button" data-view="plus">Unlock more</button><div class="top-popover-wrap"><button class="btn icon-btn top-icon" data-toggle-chat aria-label="Open chats">◌</button>' + chatMenu + '</div>' + themeToggle() + '<div class="top-popover-wrap"><button class="avatar-button top-avatar" data-toggle-account aria-label="Open account menu">' + avatarMarkup(state.profile) + '</button>' + accountMenu + '</div></div></header><div class="app-content">' + content + '</div></main>' + ambientDock() + '</div>';
  const sidebar = app.querySelector(".sidebar");
  if (sidebar) sidebar.insertAdjacentHTML("beforeend", '<button class="sidebar-close" data-toggle-nav aria-label="Close navigation">☰</button>');
  if (state.mobileNav) app.querySelector(".app-layout")?.insertAdjacentHTML("afterbegin", '<button class="nav-scrim" data-toggle-nav aria-label="Close navigation"></button>');
}

function ambientDock() {
  return '<div class="ambient-dock" aria-label="Focus ambience"><button data-ambient="none" class="' + (state.ambient === "none" ? "active" : "") + '">Quiet</button><button data-ambient="rain" class="' + (state.ambient === "rain" ? "active" : "") + '">🌧 Rain</button><button data-ambient="cafe" class="' + (state.ambient === "cafe" ? "active" : "") + '">☕ Café</button><button data-ambient="fire" class="' + (state.ambient === "fire" ? "active" : "") + '">🔥 Fire</button></div>';
}

function completedMinutes() {
  return state.sessions.reduce(function (sum, row) { return sum + Number(row.minutes || 0); }, 0);
}

function localDayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function streakDays() {
  const days = new Set(state.sessions.map(function (s) { return localDayKey(s.completed_at); }));
  let streak = 0;
  const date = new Date();
  if (!days.has(localDayKey(date))) date.setDate(date.getDate() - 1);
  while (days.has(localDayKey(date))) { streak += 1; date.setDate(date.getDate() - 1); }
  return streak;
}

function renderHome() {
  const complete = state.goals.filter(function (g) { return g.complete; }).length;
  const progress = state.goals.length ? Math.round(complete / state.goals.length * 100) : 0;
  const leadRoom = state.rooms.find(function (room) { return room.slug === state.preferences.defaultRoom; }) || state.rooms[0];
  const roomStrip = state.rooms.slice(0, 3).map(function (room) {
    return '<button class="focus-floor-room" data-join-room="' + esc(room.id) + '"><span class="room-icon">' + esc(room.icon) + '</span><span><strong>' + esc(room.name) + '</strong><small><i></i><b data-room-count="' + esc(room.slug) + '">' + (state.roomCounts[room.slug] || 0) + '</b> connected</small></span><span class="room-arrow">→</span></button>';
  }).join("");
  const content = '<div class="workspace-head"><div><span class="eyebrow">Your study desk</span><h1>What are you finishing today?</h1></div><div class="date-chip">' + new Date().toLocaleDateString(undefined, { weekday:"short", month:"short", day:"numeric" }) + '</div></div>' +
    '<section class="card start-session-card"><div class="session-copy"><span class="eyebrow">Start a focus block</span><h2>Set one target. Join when ready.</h2><p>Your intention appears only in this setup and helps you start with a clear finish line.</p></div><form id="quickSessionForm" class="quick-session"><div class="field"><label for="quickIntention">Session intention</label><input id="quickIntention" name="intention" maxlength="100" required placeholder="e.g. Finish chapter 4 notes"></div><div class="field duration-field"><label for="quickDuration">Minutes</label><input id="quickDuration" name="duration" type="number" inputmode="numeric" min="1" max="240" step="1" value="' + Number(state.preferences.defaultDuration || 50) + '" required></div><button class="btn btn-primary"' + (leadRoom ? '' : ' disabled') + '>Choose a room</button></form></section>' +
    '<div class="dashboard-layout"><div class="stack"><section class="card focus-floor"><div class="card-title-row"><div><span class="eyebrow">Live focus floor</span><h3>Open rooms</h3></div><button class="btn btn-sm" data-view="rooms">View all</button></div><div class="focus-floor-list">' + (roomStrip || '<div class="empty">Rooms are loading.</div>') + '</div></section><section class="card"><div class="card-title-row"><div><span class="eyebrow">Your plan</span><h3>Today’s goals</h3></div><strong>' + complete + '/' + state.goals.length + '</strong></div><div class="progress"><span style="width:' + progress + '%"></span></div><div style="height:16px"></div>' + goalsList(4) + '<button class="btn btn-sm goals-link" data-view="goals">Manage goals</button></section></div><div class="stack">' + timerCard() + '<section class="card activity-card"><span class="eyebrow">Your momentum</span><div class="mini-stats"><div><strong>' + fmtMinutes(completedMinutes()) + '</strong><span>focused</span></div><div><strong>' + state.sessions.length + '</strong><span>sessions</span></div><div><strong>' + streakDays() + '</strong><span>day streak</span></div></div></section></div></div>';
  appShell(content, "Today");
}

function timerCard() {
  const custom = ![25, 50, 90].includes(state.timerPreset);
  return '<aside class="card timer-card"><span class="eyebrow">Focus timer</span><div class="pills timer-presets"><button class="pill ' + (state.timerPreset === 25 ? 'active' : '') + '" data-timer-preset="25">25 min</button><button class="pill ' + (state.timerPreset === 50 ? 'active' : '') + '" data-timer-preset="50">50 min</button><button class="pill ' + (state.timerPreset === 90 ? 'active' : '') + '" data-timer-preset="90">90 min</button><button class="pill ' + (custom ? 'active' : '') + '" data-custom-timer>' + (custom ? state.timerPreset + ' min' : 'Custom') + '</button></div><div class="timer-display" id="timerDisplay">' + formatTimer() + '</div><p>Stay with one task until the bell.</p><div class="timer-actions"><button class="btn btn-primary" data-timer-toggle>' + (state.timerRunning ? 'Pause' : 'Start') + '</button><button class="btn" data-timer-reset>Reset</button></div></aside>';
}

function renderRooms() {
  const online = Object.values(state.roomCounts).reduce(function (sum, count) { return sum + count; }, 0);
  appShell('<div class="page-head"><div><span class="eyebrow">Live focus floor · open rooms</span><h1>Pick your room</h1><p>Public rooms have no participant cap. Choose an atmosphere, set your task, and check your devices before entering.</p></div><span class="online-pill"><i></i>' + online + ' connected</span></div><div class="room-grid">' + roomCards(false) + '</div><div class="room-info-grid"><section class="card"><span class="eyebrow">Before you enter</span><h3>You control what others see and hear</h3><p>The setup screen shows your local preview first. Camera is optional, and you can join muted.</p></section><section class="card"><span class="eyebrow">Community standard</span><h3>Keep the room useful</h3><p>No recording, harassment, disruptive audio, or sharing private information. Leave if anything feels unsafe.</p></section><section class="card"><span class="eyebrow">Open, smooth rooms</span><h3>Everyone can join</h3><p>The live count and People list include the full room. Video is arranged into small stream circles so phones and laptops stay responsive as the room grows.</p></section></div>', "Study rooms");
}

function goalsList(limit) {
  const rows = (limit ? state.goals.slice(0, limit) : state.goals).map(function (goal) {
    return '<div class="goal-row ' + (goal.complete ? 'complete' : '') + '"><input type="checkbox" data-goal-toggle="' + goal.id + '" ' + (goal.complete ? 'checked' : '') + ' aria-label="Complete goal"><span class="goal-title">' + esc(goal.title) + '</span><button class="btn btn-sm btn-danger" data-goal-delete="' + goal.id + '" aria-label="Delete goal">×</button></div>';
  }).join("");
  return rows || '<div class="empty">No goals yet. Add one small, clear target.</div>';
}

function renderGoals() {
  const complete = state.goals.filter(function (g) { return g.complete; }).length;
  appShell('<div class="page-head"><div><span class="eyebrow">Plan less, finish more</span><h1>Goals & progress</h1><p>' + complete + ' completed · ' + state.goals.length + ' total</p></div></div><section class="card"><div class="goal-list">' + goalsList() + '</div><form class="goal-add field" id="goalForm"><input name="title" maxlength="100" required placeholder="What will you finish next?"><button class="btn btn-primary">Add goal</button></form></section><section class="card" style="margin-top:18px"><h3>Recent focus history</h3>' + (state.sessions.length ? state.sessions.slice(0,10).map(function(s){return '<div class="check-row"><span>' + new Date(s.completed_at).toLocaleDateString() + '</span><strong>' + s.minutes + ' minutes</strong></div>';}).join("") : '<div class="empty">Complete a timer to begin your history.</div>') + '</section>', "Goals & progress");
}

function renderEncouragements() {
  const inbox = state.encouragements.map(function (item) {
    const sender = item.sender || { id:item.sender_id, display_name:item.sender_display_name, avatar_color:item.sender_avatar_color, avatar_path:item.sender_avatar_path };
    return '<div class="inbox-item"><button class="avatar-button" data-member-profile="' + esc(item.sender_id) + '" aria-label="Open ' + esc(sender.display_name || "member") + ' profile">' + avatarMarkup(sender) + '</button><div><button class="profile-name" data-member-profile="' + esc(item.sender_id) + '">' + esc(sender.display_name || "Mellow Commons member") + '</button> sent ' + (item.kind === "focus_boost" ? '<span class="plus-badge">✦ FOCUS BOOST</span>' : 'an encouragement') + '<p>' + esc(item.message || "Keep going — you’ve got this.") + '</p><span class="meta">' + new Date(item.created_at).toLocaleString() + '</span></div></div>';
  }).join("");
  const members = state.members.map(function (member) {
    return '<article class="card member-card"><button class="member-profile-link" data-member-profile="' + esc(member.id) + '">' + avatarMarkup(member, "member-avatar") + '<span><strong>' + esc(member.display_name) + '</strong><small>' + esc(member.subject || "Working toward a goal") + '</small></span></button><div class="member-social"><span><strong>' + Number(member.pinned_by_count || 0) + '</strong> pinned by</span><button class="pin-chip ' + (member.viewer_has_pinned ? 'active' : '') + '" data-' + (member.viewer_has_pinned ? 'unpin' : 'pin') + '-member="' + esc(member.id) + '">' + (member.viewer_has_pinned ? '✓ Pinned' : '＋ Pin') + '</button></div><div class="actions"><button class="btn btn-sm" data-message-member="' + esc(member.id) + '">Message</button><button class="btn btn-sm" data-encourage="' + esc(member.id) + '">♡ Encourage</button></div></article>';
  }).join("");
  appShell('<div class="page-head"><div><span class="eyebrow">Your study circle</span><h1>Find people worth pinning</h1><p>Open a student’s profile, pin them to follow their progress, or start a private message.</p></div></div><div class="allowance"><div><span>Encouragements today</span><strong>' + state.allowance.encouragements_remaining + '</strong></div><div><span>Focus Boosts this week</span><strong>' + state.allowance.boosts_remaining + '</strong></div><div><span>Your plan</span><strong>' + esc(planLabel(state.allowance.plan)) + '</strong></div></div><h2 style="margin-top:34px">Discover students</h2><div class="member-grid">' + (members || '<div class="empty">More public profiles will appear as the community grows.</div>') + '</div><h2 style="margin-top:34px">Your inbox</h2><div class="card inbox-list">' + (inbox || '<div class="empty">Encouragements you receive will appear here.</div>') + '</div>', "Community");
}

function renderPrivate() {
  const plus = ["plus", "premium", "buddy"].includes(state.allowance.plan);
  const list = state.privateRooms.map(function (room) {
    return '<div class="private-room"><div><strong>' + esc(room.title) + '</strong><p>' + (room.call_mode === "audio" ? "Audio call" : "Video call") + ' · expires ' + new Date(room.expires_at).toLocaleString() + '</p></div><div><button class="btn btn-sm" data-copy-invite="' + room.invite_token + '">Copy invite</button> <button class="btn btn-sm btn-primary" data-join-private="' + room.id + '">Open</button></div></div>';
  }).join("");
  const create = plus ? '<form class="card form" id="privateRoomForm"><h3>Create a private room</h3><div class="field"><label>Room title</label><input name="title" minlength="2" maxlength="80" required placeholder="Evening study call"></div><div class="field"><label>Call type</label><select name="mode"><option value="video">Video call</option><option value="audio">Audio call</option></select></div><button class="btn btn-primary">Create private room</button><p class="form-note">Rooms expire after 24 hours and support up to 6 authenticated members.</p></form>' : '<article class="card daily-card"><span class="eyebrow">Premium feature</span><h2>Private calls for your study circle</h2><p>Create an invite-only audio or video room for up to six people. Your invite uses a random private token and expires after 24 hours.</p><button class="btn btn-primary" data-view="plus">See membership plans</button></article>';
  appShell('<div class="page-head"><div><span class="eyebrow">Your study circle</span><h1>Private calls</h1><p>Hosting requires Premium or Buddy. Invited members can join with a free account.</p></div>' + (plus ? '<span class="plus-badge">✦ PRIVATE CALLS ACTIVE</span>' : '') + '</div><div class="dashboard-grid"><div class="stack"><section class="card"><h3>Your rooms</h3><div class="stack">' + (list || '<div class="empty">You have no active private rooms.</div>') + '</div></section></div>' + create + '</div>', "Private calls");
}

function renderPlus() {
  const active = state.allowance.plan !== "free";
  appShell('<div class="page-head"><div><span class="eyebrow">Membership</span><h1>Choose what fits</h1><p>Timers, goals, focus history, ambience, and appearance settings remain available to everyone.</p></div>' + (active ? '<span class="plus-badge">✦ ' + esc(String(state.allowance.plan).toUpperCase()) + ' ACTIVE</span>' : '') + '</div><div class="pricing-grid pricing-four">' + pricingCards() + '</div><p class="plan-fine-print">*Unlimited messaging is intended for normal person-to-person use and remains protected by anti-spam, blocking, reporting, file-size, and safety controls.</p><section class="card social-model-card"><span class="eyebrow">Mellow Commons social model</span><h3>Pin means follow</h3><p>Pinning a member follows their study profile and adds one follower to their count. Unpinning immediately unfollows them. Plan limits control how many people you can pin—not how many followers you can earn.</p></section>', "Membership");
}

function renderBlog() {
  appShell('<div class="page-head"><div><span class="eyebrow">Focus journal</span><h1>Guides for better sessions</h1><p>Practical, calm advice you can use today.</p></div></div><div class="grid-3">' + blogCards() + '</div><section class="card" style="margin-top:18px"><h3>Weekly reflection</h3><p>What helped you focus this week? What got in the way? Choose one small adjustment for your next session.</p></section>', "Focus journal");
}

function renderCommunity() {
  const active = state.communityChannels.find(function (channel) { return channel.id === state.activeChannelId; }) || state.communityChannels[0];
  const channelRows = state.communityChannels.map(function (channel) {
    return '<button class="channel-row ' + (active && channel.id === active.id ? 'active' : '') + '" data-channel="' + esc(channel.id) + '"><span>' + esc(channel.icon || "#") + '</span><div><strong>' + esc(channel.name) + '</strong><small>' + esc(channel.description || "") + '</small></div></button>';
  }).join("");
  const messages = state.channelMessages.map(function (message) {
    const person = { id:message.sender_id, display_name:message.display_name || message.sender_display_name || "Student", avatar_path:message.avatar_path || message.sender_avatar_path, avatar_color:message.avatar_color || message.sender_avatar_color, profile_frame:message.profile_frame, profile_sticker:message.profile_sticker };
    return '<article class="channel-message"><button class="avatar-button" data-member-profile="' + esc(person.id) + '">' + avatarMarkup(person) + '</button><div><div class="message-meta"><button data-member-profile="' + esc(person.id) + '">' + esc(person.display_name) + '</button><time>' + new Date(message.created_at).toLocaleString([], { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" }) + '</time></div><p>' + esc(message.body) + '</p></div></article>';
  }).join("");
  const canPost = active && (active.posting_scope !== "staff" || (state.admin && state.admin.is_admin));
  const composer = canPost ? '<form class="channel-composer" id="channelMessageForm"><input type="hidden" name="channel_id" value="' + esc(active.id) + '"><textarea name="body" maxlength="2000" required placeholder="Message #' + esc(active.slug) + '"></textarea><button class="btn btn-primary">Send</button></form>' : '<div class="channel-readonly">Only Mellow Commons staff can post in this channel.</div>';
  const dmRows = state.conversations.slice(0, 8).map(function (conversation) { const person = conversationPerson(conversation); return '<button class="conversation-row" data-conversation="' + esc(conversation.id) + '">' + avatarMarkup(person) + '<span><strong>' + esc(person.display_name) + '</strong><small>' + esc(messagePreview(conversation)) + '</small></span></button>'; }).join("");
  appShell('<div class="community-layout"><aside class="community-rail"><div class="community-heading"><span class="eyebrow">Mellow Commons</span><h3>Channels</h3></div>' + channelRows + '<div class="rail-divider"></div><div class="community-heading"><h3>Direct messages</h3><button data-view="encouragements">＋</button></div>' + (dmRows || '<p class="empty">Find a student to start a DM.</p>') + '</aside><section class="channel-panel"><header><div><span class="eyebrow">Community channel</span><h1># ' + esc(active ? active.name : "Conversations") + '</h1><p>' + esc(active ? active.description : "Choose a channel") + '</p></div><button class="btn btn-sm" data-view="messages">Private DMs</button></header><div class="channel-scroll">' + (messages || '<div class="empty">Be the first to start a useful conversation.</div>') + '</div>' + (active ? composer : '') + '</section></div>', "Conversations");
}

function renderBuddies() {
  const studyModeLabel = function (mode) {
    return ({ quiet:"Quiet body doubling", "check-ins":"Short check-ins", pomodoro:"Pomodoro blocks", discussion:"Discussion friendly", flexible:"Flexible" })[mode] || "Any style";
  };
  const query = state.buddySearch.toLowerCase();
  const posts = state.buddyPosts.filter(function (post) { return !query || [post.title, post.body, post.subject, post.timezone].join(" ").toLowerCase().includes(query); }).map(function (post) {
    const person = { id:post.author_id, display_name:post.author_display_name || "Student", avatar_path:post.author_avatar_path, avatar_color:post.author_avatar_color };
    return '<article class="card buddy-post"><div class="buddy-author"><button data-member-profile="' + esc(post.author_id) + '">' + avatarMarkup(person) + '</button><div><strong>' + esc(person.display_name) + '</strong><small>' + esc(post.subject || "Open to studying together") + '</small></div><time>' + new Date(post.created_at).toLocaleDateString() + '</time></div><h3>' + esc(post.title) + '</h3><p>' + esc(post.body) + '</p><div class="buddy-tags"><span>◷ ' + esc(post.timezone || "Flexible") + '</span><span>◎ ' + esc(studyModeLabel(post.study_mode)) + '</span></div><div class="actions">' + (post.is_own ? '<button class="btn btn-sm" data-close-buddy="' + esc(post.id) + '">Close post</button>' : '<button class="btn btn-primary btn-sm" data-message-member="' + esc(post.author_id) + '">Message</button><button class="btn btn-sm" data-member-profile="' + esc(post.author_id) + '">View profile</button>') + '</div></article>';
  }).join("");
  appShell('<div class="page-head"><div><span class="eyebrow">Accountability, without pressure</span><h1>Find a study buddy</h1><p>Post what you are studying, your timezone, and the kind of support that would help.</p></div><button class="btn btn-primary" data-new-buddy>Create a post</button></div><div class="buddy-search"><input aria-label="Search buddy posts" placeholder="Search subjects, goals, or timezones" value="' + esc(state.buddySearch) + '" data-buddy-search><span>' + state.buddyPosts.length + ' open posts</span></div><div class="buddy-grid">' + (posts || '<div class="card empty">No matching buddy posts yet. Create the first one.</div>') + '</div>', "Study buddies");
}

function renderFeedback() {
  const query = state.feedbackSearch.toLowerCase();
  const posts = state.feedbackPosts.filter(function (post) { return (state.feedbackCategory === "all" || post.category === state.feedbackCategory) && (!query || [post.title, post.body].join(" ").toLowerCase().includes(query)); }).map(function (post) {
    const author = post.author_display_name || "Student";
    return '<article class="feedback-post"><div class="feedback-vote"><button class="' + (post.viewer_voted ? 'active' : '') + '" data-feedback-vote="' + esc(post.id) + '" aria-label="Vote">⌃</button><strong>' + Number(post.votes_count || 0) + '</strong></div><div><div class="feedback-title"><h3>' + esc(post.title) + '</h3><span class="feedback-category ' + esc(post.category) + '">' + (post.category === "bug" ? "Bug" : "Feature request") + '</span></div><p>' + esc(post.body) + '</p><small>' + esc(author) + ' · ' + new Date(post.created_at).toLocaleDateString() + (post.status && post.status !== "open" ? ' · ' + esc(post.status) : '') + '</small></div></article>';
  }).join("");
  const leaders = state.feedbackPosts.slice().sort(function (a,b) { return Number(b.votes_count || 0) - Number(a.votes_count || 0); }).slice(0,5).map(function (post, index) { return '<div class="helpful-row"><span>' + (index + 1) + '</span><strong>' + esc(post.author_display_name || "Student") + '</strong><small>' + Number(post.votes_count || 0) + ' votes</small></div>'; }).join("");
  appShell('<div class="feedback-layout"><section><div class="feedback-intro"><h1>Help shape Mellow Commons</h1><p>Share a useful feature idea or report a bug. Search first, then vote if someone has already posted it.</p></div><div class="feedback-toolbar"><div class="pills"><button class="pill ' + (state.feedbackSort === 'new' ? 'active' : '') + '" data-feedback-sort="new">New</button><button class="pill ' + (state.feedbackSort === 'top' ? 'active' : '') + '" data-feedback-sort="top">Top</button><button class="pill ' + (state.feedbackSort === 'trending' ? 'active' : '') + '" data-feedback-sort="trending">Trending</button></div><input placeholder="Search feedback" value="' + esc(state.feedbackSearch) + '" data-feedback-search><button class="btn btn-primary" data-new-feedback>＋ New post</button></div><div class="feedback-list">' + (posts || '<div class="card empty">No feedback matches these filters.</div>') + '</div></section><aside class="feedback-aside card"><span class="eyebrow">Categories</span><button class="' + (state.feedbackCategory === 'all' ? 'active' : '') + '" data-feedback-category="all">View all requests</button><button class="' + (state.feedbackCategory === 'feature' ? 'active' : '') + '" data-feedback-category="feature">💡 Feature requests</button><button class="' + (state.feedbackCategory === 'bug' ? 'active' : '') + '" data-feedback-category="bug">🐞 Bugs</button><div class="rail-divider"></div><span class="eyebrow">Most helpful</span>' + (leaders || '<p class="empty">Rankings will appear as members vote.</p>') + '</aside></div>', "Feedback");
}

function renderMemberProfile() {
  const p = state.memberProfile;
  if (!p) {
    appShell('<button class="back-link" data-profile-back>← Back</button><div class="profile-loading"><div class="skeleton"></div><div class="skeleton"></div></div>', "Member profile");
    return;
  }
  const joined = p.joined_at ? new Date(p.joined_at).toLocaleDateString(undefined, { month:"long", year:"numeric" }) : "";
  const pinButton = p.is_self
    ? '<button class="btn btn-primary" data-view="profile">Edit profile</button>'
    : '<button class="btn ' + (p.viewer_has_pinned ? '' : 'btn-primary') + '" data-' + (p.viewer_has_pinned ? 'unpin' : 'pin') + '-member="' + esc(p.id) + '">' + (p.viewer_has_pinned ? '✓ Pinned' : '＋ Pin profile') + '</button>';
  const messageButton = p.is_self ? '' : (p.accepting_dms
    ? '<button class="btn" data-message-member="' + esc(p.id) + '">Message</button>'
    : '<button class="btn" disabled title="This member has paused new messages">Messages paused</button>');
  const safetyButton = p.is_self ? '' : '<button class="btn icon-btn" data-profile-options="' + esc(p.id) + '" aria-label="Profile safety options">•••</button>';
  const insight = state.memberInsights || {};
  const currentStreak = Number(insight.current_streak || 0);
  const earned = achievementLevels.filter(function (badge) { return currentStreak >= badge[0]; });
  const badges = achievementLevels.slice().reverse().map(function (badge) {
    const unlocked = currentStreak >= badge[0];
    const tag = unlocked ? "button" : "div";
    return '<' + tag + (unlocked ? ' type="button" data-celebrate-achievement="' + badge[0] + '"' : '') + ' class="achievement ' + (unlocked ? 'earned' : '') + '"><span>' + badge[2] + '</span><strong>' + badge[1] + '</strong><small>' + badge[0] + ' day streak</small></' + tag + '>';
  }).join("");
  const featuredBadge = earned[0] ? '<button type="button" class="featured-achievement" data-celebrate-achievement="' + earned[0][0] + '" aria-label="View ' + esc(earned[0][1]) + ' achievement"><b>' + earned[0][2] + '</b><span>' + esc(earned[0][1]) + '</span></button>' : '';
  let tabContent = '<div class="profile-summary-grid"><article><span>Join date</span><strong>' + (joined || "New") + '</strong></article><article><span>Highest badge</span><strong>' + (earned[0] ? earned[0][2] + ' ' + earned[0][1] : "Just beginning") + '</strong></article><article><span>Pin count</span><strong>' + Number(p.pinned_by_count || 0) + '</strong></article></div><section class="profile-about"><span class="eyebrow">About</span><p>' + esc(p.bio || "This student has not added a bio yet.") + '</p></section>';
  if (state.profileTab === "achievements") tabContent = '<div class="achievement-grid">' + badges + '</div>';
  if (state.profileTab === "statistics") {
    const days = Array.isArray(insight.last_7_days) ? insight.last_7_days : [];
    const max = Math.max(1, ...days.map(function (day) { return Number(day.minutes || 0); }));
    tabContent = '<div class="stat-hero"><div><span>Overall focus</span><strong>' + fmtMinutes(insight.total_minutes || 0) + '</strong></div><div><span>Best streak</span><strong>' + Number(insight.best_streak || 0) + ' days</strong></div><div><span>Current streak</span><strong>' + currentStreak + ' days</strong></div></div><div class="week-chart">' + days.map(function (day) { return '<div><span style="height:' + Math.max(5, Math.round(Number(day.minutes || 0) / max * 100)) + '%"></span><small>' + esc(String(day.day || day.date || "").slice(-5)) + '</small></div>'; }).join("") + '</div>';
  }
  appShell('<button class="back-link" data-profile-back>← Back</button><div class="profile-page-grid"><section class="card public-profile"><div class="profile-cover banner-' + safeBanner(p.profile_banner) + '"><span></span><span></span>' + featuredBadge + '</div><div class="profile-main"><div class="profile-identity">' + avatarMarkup(p, "profile-avatar") + '<div><span class="eyebrow">Mellow Commons profile</span><h1>' + esc(p.display_name) + '</h1><p>' + esc(p.subject || "Working toward a goal") + (p.country ? ' · ' + esc(p.country) : '') + '</p></div></div><div class="profile-actions">' + pinButton + messageButton + safetyButton + '</div></div><div class="profile-stats"><div><strong>' + Number(p.pinned_by_count || 0) + '</strong><span>Pinned by</span></div><div><strong>' + Number(p.pins_count || 0) + '</strong><span>Profiles pinned</span></div></div></section><section class="profile-details"><nav class="profile-tabs"><button class="' + (state.profileTab === 'summary' ? 'active' : '') + '" data-profile-tab="summary">Summary</button><button class="' + (state.profileTab === 'achievements' ? 'active' : '') + '" data-profile-tab="achievements">Achievements</button><button class="' + (state.profileTab === 'statistics' ? 'active' : '') + '" data-profile-tab="statistics">Statistics</button></nav><div class="card profile-tab-content">' + tabContent + '</div></section></div>', p.display_name);
}

function activeConversation() {
  return state.conversations.find(function (item) { return item.id === state.activeConversationId; }) || null;
}

function conversationPerson(conversation) {
  return {
    id: conversation.other_user_id,
    display_name: conversation.other_display_name,
    avatar_color: conversation.other_avatar_color,
    avatar_path: conversation.other_avatar_path
  };
}

function messagePreview(conversation) {
  if (conversation.last_kind === "image") return "Photo";
  if (conversation.last_kind === "voice") return "Voice message";
  return conversation.last_message || (conversation.accepted ? "Start the conversation" : "Message request");
}

function privateCallsIncluded() {
  return ["plus", "premium", "buddy"].includes(state.allowance.plan);
}

function messageReactionMarkup(messageId) {
  const rows = state.messageReactions[messageId] || [];
  const groups = {};
  rows.forEach(function (row) {
    if (!groups[row.emoji]) groups[row.emoji] = { count:0, mine:false };
    groups[row.emoji].count += 1;
    if (row.user_id === state.user.id) groups[row.emoji].mine = true;
  });
  return Object.entries(groups).map(function (entry) {
    return '<button class="message-reaction ' + (entry[1].mine ? 'mine' : '') + '" data-message-reaction="' + esc(messageId) + '" data-emoji="' + esc(entry[0]) + '" aria-label="React ' + esc(entry[0]) + '">' + esc(entry[0]) + '<span>' + entry[1].count + '</span></button>';
  }).join("");
}

function messageOptionsMarkup(message, person) {
  if (state.messageMenuId !== message.id) return "";
  const emoji = ["♡", "👍", "✦", "😂", "👏"].map(function (item) { return '<button data-message-reaction="' + esc(message.id) + '" data-emoji="' + item + '" aria-label="React ' + item + '">' + item + '</button>'; }).join("");
  return '<div class="message-options"><div class="message-emoji-row">' + emoji + '</div>' + (message.kind === "text" ? '<button data-copy-message="' + esc(message.id) + '">▣ Copy message</button>' : '') + (message.sender_id !== state.user.id ? '<button data-report-message="' + esc(message.id) + '" data-report-user="' + esc(person.id) + '">△ Report message</button>' : '') + '</div>';
}

function renderDmMessageEvent(message, person) {
  const mine = message.sender_id === state.user.id;
  let body = '<p>' + esc(message.body) + '</p>';
  if (message.kind === "image") body = state.messageMedia[message.id]
    ? '<img class="dm-image" src="' + esc(state.messageMedia[message.id]) + '" alt="Photo sent in this conversation">'
    : '<p class="media-loading">Loading photo…</p>';
  if (message.kind === "voice") body = state.messageMedia[message.id]
    ? '<audio controls preload="metadata" src="' + esc(state.messageMedia[message.id]) + '"></audio>'
    : '<p class="media-loading">Loading voice message…</p>';
  return '<div class="message-row ' + (mine ? 'mine' : 'theirs') + '" data-message-row="' + esc(message.id) + '"><div class="message-stack"><div class="message-bubble">' + body + '<span>' + new Date(message.created_at).toLocaleTimeString([], { hour:"numeric", minute:"2-digit" }) + '</span></div><div class="message-reactions">' + messageReactionMarkup(message.id) + '</div></div><button class="message-report" data-message-options="' + esc(message.id) + '" aria-label="Message options" aria-expanded="' + String(state.messageMenuId === message.id) + '">•••</button>' + messageOptionsMarkup(message, person) + '</div>';
}

function dmCallStatus(call) {
  if (call.status === "ringing") return call.caller_id === state.user.id ? "Calling…" : "Incoming call";
  if (call.status === "active") return "Call in progress";
  if (call.status === "declined") return "Call declined";
  if (call.status === "cancelled") return "Call cancelled";
  if (call.status === "missed") return "Missed call";
  return "Call ended";
}

function renderDmCallEvent(call, person) {
  const mine = call.caller_id === state.user.id;
  const icon = call.call_mode === "audio" ? "☎" : "▣";
  const type = call.call_mode === "audio" ? "Audio call" : "Video call";
  let actions = "";
  if (call.status === "ringing" && !mine) {
    actions = '<button class="btn btn-primary btn-sm" data-answer-dm-call="' + esc(call.id) + '">Accept</button><button class="btn btn-sm" data-decline-dm-call="' + esc(call.id) + '">Decline</button>';
  } else if (call.status === "ringing" && mine) {
    actions = '<button class="btn btn-sm" data-end-dm-call="' + esc(call.id) + '">Cancel</button>';
  } else if (call.status === "active") {
    actions = '<button class="btn btn-primary btn-sm" data-join-dm-call="' + esc(call.id) + '">Join</button><button class="btn btn-sm" data-end-dm-call="' + esc(call.id) + '">End</button>';
  }
  return '<div class="dm-call-event ' + (call.status === "active" || call.status === "ringing" ? 'live' : '') + '"><span class="dm-call-icon">' + icon + '</span><div><strong>' + type + '</strong><p>' + esc(dmCallStatus(call)) + ' · ' + new Date(call.created_at).toLocaleTimeString([], { hour:"numeric", minute:"2-digit" }) + '</p></div>' + (actions ? '<div class="dm-call-event-actions">' + actions + '</div>' : '') + '</div>';
}

function renderMessages() {
  const active = activeConversation();
  const conversationRows = state.conversations.map(function (conversation) {
    const person = conversationPerson(conversation);
    return '<button class="conversation-row ' + (conversation.id === state.activeConversationId ? 'active' : '') + '" data-conversation="' + esc(conversation.id) + '">' + avatarMarkup(person) + '<span><strong>' + esc(person.display_name) + '</strong><small>' + esc(messagePreview(conversation)) + '</small></span>' + (!conversation.accepted ? '<i>Request</i>' : '') + '</button>';
  }).join("");

  let panel = '<div class="message-empty"><span>✉</span><h2>Your messages live here</h2><p>Open a student profile and choose Message to begin.</p></div>';
  if (active) {
    const person = conversationPerson(active);
    const timeline = state.messages.map(function (message) { return { type:"message", at:message.created_at, value:message }; })
      .concat(state.dmCalls.map(function (call) { return { type:"call", at:call.created_at, value:call }; }))
      .sort(function (a, b) { return new Date(a.at) - new Date(b.at); })
      .map(function (event) { return event.type === "message" ? renderDmMessageEvent(event.value, person) : renderDmCallEvent(event.value, person); })
      .join("");
    const recipientRequest = !active.accepted && active.created_by !== state.user.id;
    const senderWaiting = !active.accepted && active.created_by === state.user.id && state.messages.length > 0;
    const canCompose = active.accepted || (!active.accepted && active.created_by === state.user.id && state.messages.length === 0);
    const callActions = active.accepted
      ? '<div class="dm-call-actions"><button class="btn icon-btn dm-call-button' + (privateCallsIncluded() ? '' : ' locked') + '" data-start-dm-call="audio" aria-label="Start private audio call" title="' + (privateCallsIncluded() ? 'Start audio call' : 'Premium or Buddy') + '">☎</button><button class="btn icon-btn dm-call-button' + (privateCallsIncluded() ? '' : ' locked') + '" data-start-dm-call="video" aria-label="Start private video call" title="' + (privateCallsIncluded() ? 'Start video call' : 'Premium or Buddy') + '">▣</button></div>'
      : '';
    const requestBanner = recipientRequest
      ? '<div class="message-request"><div><strong>Message request</strong><p>Accept before replying. You can also block or report this member.</p></div><button class="btn btn-primary btn-sm" data-accept-dm="' + esc(active.id) + '">Accept</button></div>'
      : (senderWaiting ? '<div class="message-request waiting"><div><strong>Request sent</strong><p>You can continue after ' + esc(person.display_name) + ' accepts.</p></div></div>' : '');
    const composer = canCompose
      ? '<div class="dm-composer-wrap"><div class="composer-emoji-picker"' + (state.messageEmojiOpen ? '' : ' hidden') + '>' + ["😊","📚","✨","☕","💪","🌱","♡","👍"].map(function (emoji) { return '<button type="button" data-insert-emoji="' + emoji + '">' + emoji + '</button>'; }).join("") + '</div><form class="dm-composer" id="dmForm"><textarea name="message" data-message-draft maxlength="2000" rows="1" required placeholder="Message ' + esc(person.display_name) + '">' + esc(state.messageDraft) + '</textarea><button class="btn icon-btn" type="button" data-toggle-message-emoji title="Add emoji">☺</button><label class="btn icon-btn" title="Send a photo"><input id="dmMediaInput" type="file" accept="image/jpeg,image/png,image/webp" hidden><span aria-hidden="true">▧</span></label><button class="btn icon-btn record-button ' + (state.voiceRecorder && state.voiceRecorder.state === "recording" ? 'recording' : '') + '" type="button" data-record-voice title="' + (state.voiceRecorder && state.voiceRecorder.state === "recording" ? 'Stop recording' : 'Record a voice message') + '">●</button><button class="btn btn-primary" type="submit">Send</button></form></div>'
      : '';
    panel = '<section class="message-panel"><header class="message-head"><button class="message-person" data-member-profile="' + esc(person.id) + '">' + avatarMarkup(person) + '<span><strong>' + esc(person.display_name) + '</strong><small>' + (active.accepted ? 'Private conversation' : 'Message request') + '</small></span></button><div class="message-head-actions">' + callActions + '<button class="btn icon-btn" data-profile-options="' + esc(person.id) + '" aria-label="Conversation safety options">•••</button></div></header>' + requestBanner + '<div class="message-thread" id="messageThread">' + (timeline || '<div class="thread-start"><span>Start simple</span><p>Say hello and share what you are studying.</p></div>') + '</div>' + composer + '</section>';
  }

  appShell('<div class="messages-layout"><aside class="conversation-list"><div class="conversation-title"><div><span class="eyebrow">Private</span><h1>Messages</h1></div><button class="btn icon-btn" data-view="encouragements" title="Find students">＋</button></div><div class="conversation-scroll">' + (conversationRows || '<div class="empty conversation-empty">No conversations yet.</div>') + '</div></aside>' + panel + '</div>', "Messages");
  requestAnimationFrame(function () {
    const thread = document.querySelector("#messageThread");
    if (thread) thread.scrollTop = thread.scrollHeight;
  });
}

function renderProfile() {
  const p = state.profile;
  const banners = profileBanners.map(function (banner) { return '<label class="banner-option"><input type="radio" name="profile_banner" value="' + banner[0] + '"' + (safeBanner(p.profile_banner) === banner[0] ? ' checked' : '') + '><span class="banner-swatch banner-' + banner[0] + '"><i></i></span><small>' + banner[1] + '</small></label>'; }).join("");
  const frames = [["none","Simple"],["soft-glow","Soft glow"],["notebook","Notebook"],["mint-ring","Mint ring"],["moonlit","Moonlit ✦"],["garden","Garden ✦"],["aurora","Aurora ✦"]].map(function (frame) { return '<label class="cosmetic-option"><input type="radio" name="profile_frame" value="' + frame[0] + '"' + ((p.profile_frame || "none") === frame[0] ? ' checked' : '') + '><span class="frame-swatch frame-' + frame[0] + '"></span><small>' + frame[1] + '</small></label>'; }).join("");
  const stickers = [["","None"],["moon","☾"],["sprout","🌱"],["sparkles","✦"],["books","📚"],["coffee","☕"],["flower","✿"]].map(function (sticker) { return '<label class="sticker-option"><input type="radio" name="profile_sticker" value="' + sticker[0] + '"' + ((p.profile_sticker || "") === sticker[0] ? ' checked' : '') + '><span>' + (sticker[1] || "None") + '</span></label>'; }).join("");
  appShell('<div class="page-head"><div><span class="eyebrow">Your public identity</span><h1>Make the space feel like yours</h1><p>Your profile appears when another student clicks your picture or name.</p></div><button class="btn" data-member-profile="' + esc(p.id) + '">Preview profile</button></div><div class="profile-editor"><aside class="card profile-photo-card"><div class="profile-photo-preview">' + avatarMarkup(p, "profile-avatar") + '</div><h3>Profile picture</h3><p>JPG, PNG, or WebP · up to 4 MB. Sexual, explicit, hateful, or unsafe images are not allowed.</p><label class="btn btn-primary" for="avatarUpload">' + (p.avatar_path ? 'Change picture' : 'Upload picture') + '</label><input id="avatarUpload" type="file" accept="image/jpeg,image/png,image/webp" hidden>' + (p.avatar_path ? '<button class="btn btn-sm" data-remove-avatar>Remove picture</button>' : '') + '<span class="safety-copy">Members can report unsafe profile images for review.</span></aside><form class="card form" id="profileForm"><div class="field"><label>Display name</label><input name="display_name" minlength="2" maxlength="40" required value="' + esc(p.display_name) + '"></div><div class="field"><label>What are you studying?</label><input name="subject" maxlength="80" value="' + esc(p.subject) + '" placeholder="Biology, design, coding…"></div><div class="field"><label>Bio</label><textarea name="bio" maxlength="240" placeholder="A short introduction">' + esc(p.bio) + '</textarea></div><div class="field"><label>Country or region</label><input name="country" maxlength="60" value="' + esc(p.country) + '"></div><div class="field"><label>Profile color</label><input name="avatar_color" type="color" value="' + esc(p.avatar_color) + '"></div><div class="field"><label>Profile banner</label><div class="banner-grid">' + banners + '</div><small>Banners are included for every member.</small></div><div class="field"><label>Profile frame</label><div class="cosmetic-grid">' + frames + '</div><small>✦ frames are included with Premium and Buddy.</small></div><div class="field"><label>Profile sticker</label><div class="sticker-grid">' + stickers + '</div></div><button class="btn btn-primary">Save profile</button></form></div>', "Profile");
}

function toggleRow(name, title, description, checked) {
  return '<div class="check-row"><div><strong>' + title + '</strong><p style="margin:3px 0 0">' + description + '</p></div><label class="switch"><input type="checkbox" name="' + name + '" ' + (checked ? "checked" : "") + '><span></span></label></div>';
}

function renderSettings() {
  const p = state.profile;
  const prefs = state.preferences;
  const roomOptions = state.rooms.map(function (room) { return '<option value="' + esc(room.slug) + '"' + (prefs.defaultRoom === room.slug ? ' selected' : '') + '>' + esc(room.name) + '</option>'; }).join("");
  appShell('<div class="page-head"><div><span class="eyebrow">You stay in control</span><h1>Privacy & settings</h1><p>Private calls connect browser to browser and are not recorded by Mellow Commons.</p></div></div><section class="card appearance-card"><div><span class="eyebrow">Website ambience</span><h3>Appearance</h3><p>Choose the atmosphere that feels best for your study space.</p></div><div class="theme-choice" role="group" aria-label="Website appearance"><button class="btn ' + (state.theme === "light" ? "active" : "") + '" data-theme="light">☀ Light</button><button class="btn ' + (state.theme === "dark" ? "active" : "") + '" data-theme="dark">☾ Dark</button></div></section><form class="card form" id="privacyForm" style="margin-top:18px">' +
    toggleRow("show_profile", "Public member profile", "Allow signed-in members to see your name, bio, and subject.", p.show_profile) +
    toggleRow("show_country", "Show country", "Display your country or region on your profile.", p.show_country) +
    toggleRow("allow_invites", "Allow private-room invites", "Let other members invite you to private study calls.", p.allow_invites) +
    toggleRow("accepting_dms", "Accept new messages", "Let signed-in members start a private conversation from your profile.", p.accepting_dms) +
    toggleRow("accepting_encouragements", "Receive encouragements", "Allow members to send you supportive messages.", p.accepting_encouragements) +
    '<button class="btn btn-primary">Save privacy settings</button></form><form class="card form advanced-settings" id="studyPreferencesForm"><div><span class="eyebrow">Session defaults</span><h3>Study preferences</h3><p>These choices are saved in this browser and prefill your room setup.</p></div><div class="settings-grid"><div class="field"><label>Default focus block (minutes)</label><input name="defaultDuration" type="number" inputmode="numeric" min="1" max="240" step="1" value="' + Number(prefs.defaultDuration || 50) + '" required></div><div class="field"><label>Quick-start room</label><select name="defaultRoom">' + roomOptions + '</select></div></div>' + toggleRow("defaultCamera", "Camera ready by default", "Keep camera selected when opening the device lobby. You still approve browser access.", prefs.defaultCamera) + toggleRow("defaultMicrophone", "Microphone ready by default", "Keep microphone selected in the device lobby. Public rooms should usually stay muted.", prefs.defaultMicrophone) + toggleRow("soundCues", "Timer sound cues", "Allow a short sound when a focus block finishes.", prefs.soundCues) + toggleRow("compactMode", "Compact dashboard", "Fit more study information on screen with tighter spacing.", prefs.compactMode) + '<button class="btn btn-primary">Save study preferences</button></form><section class="card" style="margin-top:18px"><h3>Account</h3><p>Signed in as ' + esc(state.user.email) + '</p><button class="btn btn-danger" data-signout>Sign out</button> <button class="btn" data-privacy>Read privacy summary</button></section>', "Privacy & settings");
}

function adminPlanOptions(selected) {
  return [
    ["free", "No complimentary access"],
    ["basic", "Basic"],
    ["premium", "Premium"],
    ["buddy", "Buddy"]
  ].map(function (option) {
    return '<option value="' + option[0] + '"' + (selected === option[0] ? ' selected' : '') + '>' + option[1] + '</option>';
  }).join("");
}

function renderAdmin() {
  if (!state.admin || !state.admin.is_admin) {
    state.view = "home";
    return renderHome();
  }

  const stats = state.adminStats || {};
  const statCards = [
    [Number(stats.members_total || 0), "Members"],
    [Number(stats.premium_members || 0), "Premium access"],
    [Number(stats.active_rooms || 0), "Open rooms"],
    [Number(stats.open_reports || 0), "Reports to review"],
    [Number(stats.messages_today || 0), "Messages today"],
    [Number(stats.calls_today || 0), "Calls today"]
  ].map(function (item) {
    return '<article class="card admin-stat"><strong>' + item[0] + '</strong><span>' + item[1] + '</span></article>';
  }).join("");

  const members = state.adminMembers.map(function (member) {
    const role = member.app_role
      ? '<span class="admin-role ' + esc(member.app_role) + '">' + esc(member.app_role) + '</span>'
      : '';
    const controls = member.app_role
      ? '<span class="admin-lock-note">Role includes permanent Premium</span>'
      : '<div class="admin-plan-control"><select data-admin-plan-for="' + esc(member.id) + '" aria-label="Complimentary plan for ' + esc(member.display_name) + '">' + adminPlanOptions(member.entitlement_tier || "free") + '</select><button class="btn btn-sm" data-admin-save-plan="' + esc(member.id) + '">Save</button></div>';
    return '<div class="admin-member-row"><div class="admin-member-identity">' + avatarMarkup(member) + '<span><strong>' + esc(member.display_name) + ' ' + role + '</strong><small>' + esc(member.email) + '</small></span></div><div><span class="admin-cell-label">Current plan</span><strong>' + esc(planLabel(member.current_plan)) + '</strong></div><div><span class="admin-cell-label">Reports</span><strong>' + Number(member.report_count || 0) + '</strong></div><div>' + controls + '</div></div>';
  }).join("");

  const reports = state.adminReports.map(function (report) {
    return '<article class="admin-report"><div class="admin-report-head"><span class="report-status ' + esc(report.status) + '">' + esc(report.status) + '</span><time>' + new Date(report.created_at).toLocaleString() + '</time></div><p>' + esc(report.reason) + '</p><div class="admin-report-people"><span><small>Reported by</small><strong>' + esc(report.reporter_name) + '</strong><em>' + esc(report.reporter_email) + '</em></span><span><small>Reported member</small><strong>' + esc(report.reported_name) + '</strong><em>' + esc(report.reported_email) + '</em></span><span><small>Context</small><strong>' + esc(report.context) + '</strong></span></div><div class="admin-report-actions"><button class="btn btn-sm" data-admin-report="' + esc(report.report_id) + '" data-report-status="reviewing">Reviewing</button><button class="btn btn-sm btn-mint" data-admin-report="' + esc(report.report_id) + '" data-report-status="resolved">Resolve</button><button class="btn btn-sm" data-admin-report="' + esc(report.report_id) + '" data-report-status="dismissed">Dismiss</button></div></article>';
  }).join("");

  const rooms = state.adminRooms.map(function (room) {
    return '<div class="admin-room-row"><span class="room-icon">' + esc(room.icon) + '</span><div><strong>' + esc(room.name) + '</strong><small>' + esc(room.description) + '</small></div><span class="room-state ' + (room.active ? 'open' : 'closed') + '">' + (room.active ? 'Open' : 'Closed') + '</span><button class="btn btn-sm" data-admin-room="' + esc(room.id) + '" data-room-active="' + (!room.active) + '">' + (room.active ? 'Close room' : 'Open room') + '</button></div>';
  }).join("");

  const content = '<section class="card admin-hero"><div><span class="eyebrow">Private owner workspace</span><h1>Admin center</h1><p>Manage member access, safety reports, and public room availability. Every change is checked and recorded on the server.</p></div><div class="owner-access-card"><span class="owner-badge">◆ OWNER</span><strong>Premium included</strong><small>No charge and no Stripe subscription</small></div></section>' +
    '<div class="admin-stat-grid">' + statCards + '</div>' +
    '<section class="card admin-section"><div class="admin-section-head"><div><span class="eyebrow">Members</span><h2>Plans and access</h2></div><form id="adminSearchForm" class="admin-search"><input name="search" maxlength="100" value="' + esc(state.adminSearch) + '" placeholder="Search name or email" aria-label="Search members"><button class="btn btn-sm">Search</button></form></div><div class="admin-member-list">' + (members || '<div class="empty">No members match this search.</div>') + '</div></section>' +
    '<div class="admin-two-column"><section class="card admin-section"><div class="admin-section-head"><div><span class="eyebrow">Safety</span><h2>Reports</h2></div><button class="btn btn-sm" data-admin-refresh>Refresh</button></div><div class="admin-report-list">' + (reports || '<div class="empty">No reports need review.</div>') + '</div></section><section class="card admin-section"><div class="admin-section-head"><div><span class="eyebrow">Live spaces</span><h2>Public rooms</h2></div></div><div class="admin-room-list">' + (rooms || '<div class="empty">No rooms found.</div>') + '</div><p class="admin-footnote">At least one public room must remain open.</p></section></div>';

  appShell(content, "Admin center");
}

function renderApp() {
  if (!state.session) return renderLanding();
  const renderers = { home:renderHome, rooms:renderRooms, goals:renderGoals, encouragements:renderEncouragements, buddies:renderBuddies, community:renderCommunity, feedback:renderFeedback, messages:renderMessages, member:renderMemberProfile, private:renderPrivate, plus:renderPlus, blog:renderBlog, profile:renderProfile, settings:renderSettings, admin:renderAdmin };
  (renderers[state.view] || renderHome)();
}

async function loadPublicRooms() {
  const result = await supabase.from("rooms").select("*").eq("active", true).order("sort_order");
  if (!result.error) {
    state.rooms = result.data || [];
    subscribeRoomCounts();
  }
}

function subscribeRoomCounts() {
  state.channels.forEach(function (channel) { supabase.removeChannel(channel); });
  state.channels = [];
  state.rooms.forEach(function (room) {
    const channel = supabase.channel("presence:" + room.slug, { config: { presence: { key: "observer-" + crypto.randomUUID() } } });
    channel.on("presence", { event: "sync" }, function () {
      const presence = channel.presenceState();
      const connectedUsers = new Set();
      Object.values(presence).forEach(function (entries) {
        entries.forEach(function (entry) { if (entry && entry.user_id) connectedUsers.add(entry.user_id); });
      });
      state.roomCounts[room.slug] = connectedUsers.size;
      const countEls = document.querySelectorAll('[data-room-count="' + room.slug + '"]');
      countEls.forEach(function (el) { el.textContent = state.roomCounts[room.slug]; });
    }).subscribe();
    state.channels.push(channel);
  });
}

async function loadUserData() {
  if (!state.user) return;
  const userId = state.user.id;
  const results = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.from("goals").select("*").order("created_at", { ascending:false }),
    supabase.from("focus_sessions").select("*").order("completed_at", { ascending:false }).limit(100),
    supabase.from("subscriptions").select("*").eq("user_id", userId).maybeSingle(),
    supabase.rpc("get_weekly_allowance"),
    supabase.rpc("list_received_encouragements", { p_limit:30 }),
    supabase.rpc("list_member_profiles", { p_limit:24 }),
    supabase.from("private_rooms").select("*").order("created_at", { ascending:false }),
    supabase.rpc("list_dm_conversations"),
    supabase.rpc("list_pending_dm_calls"),
    supabase.rpc("get_admin_access"),
    supabase.from("community_channels").select("*").eq("active", true).order("sort_order"),
    supabase.rpc("list_feedback_posts", { p_sort:"new", p_category:null, p_search:"", p_limit:100 }),
    supabase.rpc("list_focus_buddy_posts", { p_subject:"", p_limit:100 }),
    supabase.rpc("get_focus_room_allowance")
  ]);
  if (results[0].error) showToast(results[0].error.message, true);
  if (results[6].error) showToast(results[6].error.message, true);
  if (results[8].error) showToast(results[8].error.message, true);
  if (results[9].error) showToast(results[9].error.message, true);
  if (results[10].error) showToast(results[10].error.message, true);
  state.profile = results[0].data || { id:userId, display_name:state.user.email.split("@")[0], bio:"", country:"", subject:"", avatar_color:"#7c6cff", avatar_path:null, show_profile:true, show_country:false, allow_invites:true, accepting_dms:true, accepting_encouragements:true };
  state.goals = results[1].data || [];
  state.sessions = results[2].data || [];
  state.subscription = results[3].data || null;
  if (results[4].data && results[4].data[0]) state.allowance = results[4].data[0];
  state.encouragements = results[5].data || [];
  state.members = results[6].data || [];
  state.privateRooms = results[7].data || [];
  state.conversations = results[8].data || [];
  state.pendingDmCalls = results[9].data || [];
  state.admin = results[10].data && results[10].data[0] ? results[10].data[0] : null;
  state.communityChannels = results[11].data || [];
  state.activeChannelId = state.activeChannelId || (state.communityChannels[0] && state.communityChannels[0].id);
  state.feedbackPosts = results[12].data || [];
  state.buddyPosts = results[13].data || [];
  if (results[14].data && results[14].data[0]) state.focusAllowance = results[14].data[0];
  if (state.activeChannelId) await loadChannelMessages(state.activeChannelId);
  if (state.admin && state.admin.is_admin) await loadAdminData(state.adminSearch);
  await processInvite();
}

async function loadChannelMessages(channelId) {
  if (!channelId) return;
  const result = await supabase.rpc("list_channel_messages", { p_channel_id:channelId, p_limit:100, p_before:null });
  if (result.error) return showToast(result.error.message, true);
  state.channelMessages = (result.data || []).slice().reverse();
  if (state.communityChannel) await supabase.removeChannel(state.communityChannel);
  state.communityChannel = supabase.channel("mellow-channel-" + channelId)
    .on("postgres_changes", { event:"INSERT", schema:"public", table:"channel_messages", filter:"channel_id=eq." + channelId }, async function () {
      await loadChannelMessages(channelId);
      if (state.view === "community") renderCommunity();
    }).subscribe();
}

async function sendChannelMessage(form) {
  const data = new FormData(form);
  const result = await supabase.rpc("send_channel_message", { p_channel_id:data.get("channel_id"), p_body:String(data.get("body") || "").trim() });
  if (result.error) return showToast(result.error.message, true);
  form.reset();
  await loadChannelMessages(data.get("channel_id"));
  renderCommunity();
}

async function refreshFeedback() {
  const result = await supabase.rpc("list_feedback_posts", { p_sort:state.feedbackSort, p_category:state.feedbackCategory === "all" ? null : state.feedbackCategory, p_search:state.feedbackSearch || "", p_limit:100 });
  if (result.error) return showToast(result.error.message, true);
  state.feedbackPosts = result.data || [];
}

function showFeedbackComposer() {
  showModal("Share feedback", '<form class="form" id="feedbackForm"><div class="field"><label>Type</label><select name="category"><option value="feature">Feature request</option><option value="bug">Bug report</option></select></div><div class="field"><label>Title</label><input name="title" minlength="4" maxlength="120" required placeholder="A clear, searchable title"></div><div class="field"><label>Details</label><textarea name="body" minlength="8" maxlength="2000" required placeholder="What would be useful, or what went wrong?"></textarea></div><button class="btn btn-primary">Post feedback</button></form>');
}

async function submitFeedback(form) {
  const data = new FormData(form);
  const result = await supabase.rpc("create_feedback_post", { p_title:String(data.get("title") || "").trim(), p_body:String(data.get("body") || "").trim(), p_category:data.get("category") });
  if (result.error) return showToast(result.error.message, true);
  closeModal(); await refreshFeedback(); renderFeedback(); showToast("Feedback posted. Thank you.");
}

async function voteFeedback(postId) {
  const result = await supabase.rpc("toggle_feedback_vote", { p_post_id:postId });
  if (result.error) return showToast(result.error.message, true);
  await refreshFeedback(); renderFeedback();
}

function showBuddyComposer() {
  showModal("Find a study buddy", '<form class="form" id="buddyForm"><div class="field"><label>Post title</label><input name="title" minlength="4" maxlength="100" required placeholder="Looking for an evening revision buddy"></div><div class="field"><label>What are you working on?</label><input name="subject" maxlength="80" placeholder="Calculus, IELTS, portfolio…"></div><div class="field"><label>About your goal</label><textarea name="body" minlength="10" maxlength="1200" required placeholder="Share your schedule, goal, and the kind of accountability you want."></textarea></div><div class="settings-grid"><div class="field"><label>Timezone</label><input name="timezone" maxlength="60" value="' + esc(Intl.DateTimeFormat().resolvedOptions().timeZone || "") + '"></div><div class="field"><label>Study style</label><select name="study_mode"><option value="quiet">Quiet body doubling</option><option value="check-ins">Short check-ins</option><option value="pomodoro">Pomodoro blocks</option><option value="discussion">Discussion friendly</option><option value="flexible">Flexible</option></select></div></div><button class="btn btn-primary">Publish post</button></form>');
}

async function submitBuddy(form) {
  const data = new FormData(form);
  const result = await supabase.rpc("create_focus_buddy_post", { p_title:String(data.get("title") || "").trim(), p_body:String(data.get("body") || "").trim(), p_subject:String(data.get("subject") || "").trim(), p_timezone:String(data.get("timezone") || "").trim(), p_study_mode:data.get("study_mode") });
  if (result.error) return showToast(result.error.message, true);
  closeModal(); await refreshBuddies(); renderBuddies(); showToast("Buddy post published.");
}

async function refreshBuddies() {
  const result = await supabase.rpc("list_focus_buddy_posts", { p_subject:"", p_limit:100 });
  if (result.error) return showToast(result.error.message, true);
  state.buddyPosts = result.data || [];
}

async function closeBuddy(postId) {
  const result = await supabase.rpc("close_focus_buddy_post", { p_post_id:postId });
  if (result.error) return showToast(result.error.message, true);
  await refreshBuddies(); renderBuddies(); showToast("Buddy post closed.");
}

async function loadAdminData(search) {
  if (!state.admin || !state.admin.is_admin) return;
  const results = await Promise.all([
    supabase.rpc("get_admin_dashboard"),
    supabase.rpc("admin_list_members", { p_search:String(search || ""), p_limit:50 }),
    supabase.rpc("admin_list_reports", { p_status:null, p_limit:50 }),
    supabase.rpc("admin_list_rooms")
  ]);
  const failed = results.find(function (result) { return result.error; });
  if (failed) showToast(failed.error.message, true);
  state.adminStats = results[0].data && results[0].data[0] ? results[0].data[0] : null;
  state.adminMembers = results[1].data || [];
  state.adminReports = results[2].data || [];
  state.adminRooms = results[3].data || [];
}

async function processInvite() {
  const token = new URLSearchParams(location.search).get("invite");
  if (!token || !state.session) return;
  const result = await supabase.rpc("join_private_room", { p_invite_token: token });
  if (result.error) showToast(result.error.message, true);
  else {
    history.replaceState({}, "", location.pathname);
    state.view = "private";
    await loadPrivateRooms();
    showToast("Private room joined.");
  }
}

async function loadPrivateRooms() {
  const result = await supabase.from("private_rooms").select("*").order("created_at", { ascending:false });
  state.privateRooms = result.data || [];
}

async function refreshMembers() {
  const result = await supabase.rpc("list_member_profiles", { p_limit:24 });
  if (result.error) return showToast(result.error.message, true);
  state.members = result.data || [];
}

async function openMemberProfile(userId) {
  if (!userId) return;
  state.profileReturnView = state.view === "member" ? state.profileReturnView : state.view;
  state.memberProfile = null;
  state.memberInsights = null;
  state.profileTab = "summary";
  state.view = "member";
  renderMemberProfile();
  const responses = await Promise.all([
    supabase.rpc("get_member_profile", { p_member_id:userId }),
    supabase.rpc("get_profile_insights", { p_member_id:userId })
  ]);
  const result = responses[0];
  if (result.error || !result.data || !result.data[0]) {
    state.view = state.profileReturnView || "encouragements";
    renderApp();
    return showToast(result.error ? result.error.message : "This profile is unavailable.", true);
  }
  state.memberProfile = result.data[0];
  state.memberInsights = responses[1].data && responses[1].data[0] ? responses[1].data[0] : null;
  renderMemberProfile();
}

async function togglePin(userId, shouldPin) {
  const result = await supabase.rpc(shouldPin ? "pin_member" : "unpin_member", { p_member_id:userId });
  if (result.error) return showToast(result.error.message, true);
  const social = result.data && result.data[0];
  if (state.memberProfile && state.memberProfile.id === userId && social) {
    state.memberProfile.viewer_has_pinned = social.is_pinned;
    state.memberProfile.pinned_by_count = social.pinned_by_count;
    state.memberProfile.pins_count = social.pins_count;
  }
  await refreshMembers();
  renderApp();
  showToast(shouldPin ? "Profile pinned. You’re now following this student." : "Profile unpinned.");
}

async function loadConversations() {
  const result = await supabase.rpc("list_dm_conversations");
  if (result.error) return showToast(result.error.message, true);
  state.conversations = result.data || [];
}

async function startConversation(userId) {
  const result = await supabase.rpc("start_dm", { p_recipient_id:userId });
  if (result.error) return showToast(result.error.message, true);
  await loadConversations();
  state.activeConversationId = result.data;
  state.messageDraft = "";
  state.view = "messages";
  await Promise.all([loadMessages(result.data), loadDmCalls(result.data)]);
  renderMessages();
}

async function openConversation(conversationId) {
  if (state.activeConversationId !== conversationId) state.messageDraft = "";
  state.activeConversationId = conversationId;
  state.view = "messages";
  await Promise.all([loadMessages(conversationId), loadDmCalls(conversationId)]);
  renderMessages();
}

async function loadMessages(conversationId) {
  if (!conversationId) { state.messages = []; state.messageMedia = {}; state.messageReactions = {}; return; }
  const result = await supabase.from("dm_messages").select("*").eq("conversation_id", conversationId).order("created_at", { ascending:true }).limit(300);
  if (result.error) return showToast(result.error.message, true);
  state.messages = result.data || [];
  state.messageMedia = {};
  const attachments = state.messages.filter(function (message) { return message.storage_path; });
  await Promise.all(attachments.map(async function (message) {
    const signed = await supabase.storage.from("dm-media").createSignedUrl(message.storage_path, 3600);
    if (!signed.error && signed.data) state.messageMedia[message.id] = signed.data.signedUrl;
  }));
  await loadMessageReactions();
  subscribeToDm(conversationId);
}

async function loadMessageReactions() {
  const ids = state.messages.map(function (message) { return message.id; });
  state.messageReactions = {};
  if (!ids.length) return;
  const result = await supabase.from("dm_message_reactions").select("message_id,user_id,emoji,created_at").in("message_id", ids);
  if (result.error) return;
  (result.data || []).forEach(function (row) {
    if (!state.messageReactions[row.message_id]) state.messageReactions[row.message_id] = [];
    state.messageReactions[row.message_id].push(row);
  });
}

async function toggleMessageReaction(messageId, emoji) {
  const allowed = ["♡", "👍", "✦", "😂", "👏"];
  if (!allowed.includes(emoji)) return;
  const rows = state.messageReactions[messageId] || [];
  const mine = rows.some(function (row) { return row.user_id === state.user.id && row.emoji === emoji; });
  const query = mine
    ? supabase.from("dm_message_reactions").delete().eq("message_id", messageId).eq("user_id", state.user.id).eq("emoji", emoji)
    : supabase.from("dm_message_reactions").insert({ message_id:messageId, user_id:state.user.id, emoji:emoji });
  const result = await query;
  if (result.error) return showToast("That reaction could not be saved.", true);
  state.messageMenuId = null;
  await loadMessageReactions();
  renderMessages();
}

async function copyDmMessage(messageId) {
  const message = state.messages.find(function (item) { return item.id === messageId; });
  if (!message || message.kind !== "text") return;
  await navigator.clipboard.writeText(message.body || "");
  state.messageMenuId = null;
  showToast("Message copied.");
  renderMessages();
}

function subscribeToDm(conversationId) {
  if (state.dmChannel) supabase.removeChannel(state.dmChannel);
  state.dmChannel = supabase.channel("focusroom-dm-" + conversationId)
    .on("postgres_changes", { event:"INSERT", schema:"public", table:"dm_messages", filter:"conversation_id=eq." + conversationId }, async function () {
      await loadMessages(conversationId);
      await loadConversations();
      if (state.view === "messages") renderMessages();
    })
    .on("postgres_changes", { event:"*", schema:"public", table:"dm_message_reactions" }, async function (payload) {
      const row = payload.new && payload.new.message_id ? payload.new : payload.old;
      if (!row || !state.messages.some(function (message) { return message.id === row.message_id; })) return;
      await loadMessageReactions();
      if (state.view === "messages") renderMessages();
    })
    .subscribe();
}

async function loadDmCalls(conversationId) {
  if (!conversationId) { state.dmCalls = []; return; }
  const result = await supabase.rpc("list_dm_calls", { p_conversation_id:conversationId, p_limit:30 });
  if (result.error) return showToast(result.error.message, true);
  state.dmCalls = result.data || [];
}

async function loadPendingDmCalls() {
  const result = await supabase.rpc("list_pending_dm_calls");
  if (result.error) return;
  state.pendingDmCalls = result.data || [];
}

function incomingCallPerson(call) {
  const conversation = state.conversations.find(function (item) { return item.id === call.conversation_id; });
  if (conversation) return conversationPerson(conversation);
  return {
    id:call.caller_id,
    display_name:call.caller_display_name || "A Mellow Commons member",
    avatar_color:call.caller_avatar_color || "#7c6cff",
    avatar_path:call.caller_avatar_path || null
  };
}

function notifyNextIncomingCall() {
  if (!state.session) return;
  const call = state.pendingDmCalls.find(function (item) { return !state.notifiedDmCalls.has(item.id); });
  if (!call) return;
  if (modalRoot.children.length) {
    showToast("You have an incoming private call.");
    setTimeout(notifyNextIncomingCall, 4000);
    return;
  }
  const person = incomingCallPerson(call);
  state.notifiedDmCalls.add(call.id);
  modalRoot.innerHTML = '<div class="social-incoming" role="dialog" aria-modal="true"><div class="social-incoming-glow"></div><div class="social-incoming-card"><span class="call-kicker">Incoming ' + (call.call_mode === "audio" ? "audio" : "video") + ' call</span><div class="incoming-call-avatar">' + avatarMarkup(person, "profile-avatar") + '</div><h2>' + esc(person.display_name) + '</h2><p>Mellow Commons private call</p><div class="incoming-social-actions"><button class="social-answer decline" data-decline-dm-call="' + esc(call.id) + '"><span>×</span><small>Decline</small></button><button class="social-answer accept" data-answer-dm-call="' + esc(call.id) + '"><span>' + (call.call_mode === "audio" ? "☎" : "▣") + '</span><small>Answer</small></button></div></div></div>';
}

function subscribeToDmCalls() {
  if (state.dmCallChannel) supabase.removeChannel(state.dmCallChannel);
  if (!state.user) return;
  state.dmCallChannel = supabase.channel("focusroom-dm-calls-" + state.user.id)
    .on("postgres_changes", { event:"*", schema:"public", table:"dm_calls" }, async function (payload) {
      const changed = payload.new && payload.new.id ? payload.new : payload.old;
      await Promise.all([loadConversations(), loadPendingDmCalls()]);
      if (state.activeConversationId && changed && changed.conversation_id === state.activeConversationId) {
        await loadDmCalls(state.activeConversationId);
        if (state.view === "messages" && !document.querySelector(".meeting-page, .social-call-page")) renderMessages();
      }
      if (changed && changed.id === state.activeDmCallId && ["declined", "cancelled", "missed", "ended"].includes(changed.status)) {
        const statusText = { declined:"Call declined", cancelled:"Call cancelled", missed:"Call missed", ended:"Call ended" }[changed.status];
        setSocialCallStatus(statusText);
        await leaveMeeting(false);
        showToast(statusText + ".");
      }
      if (changed && changed.id === state.activeDmCallId && changed.status === "active") {
        setSocialCallStatus("Connecting…");
      }
      notifyNextIncomingCall();
    })
    .subscribe();
}

async function acceptConversation(conversationId) {
  const result = await supabase.rpc("accept_dm", { p_conversation_id:conversationId });
  if (result.error) return showToast(result.error.message, true);
  await loadConversations();
  await Promise.all([loadMessages(conversationId), loadDmCalls(conversationId)]);
  renderMessages();
  showToast("Message request accepted.");
}

function dmCallRoom(call, person) {
  return {
    id:call.room_id,
    title:(call.call_mode === "audio" ? "Audio call with " : "Video call with ") + (person && person.display_name || "study partner"),
    description:"A private one-to-one Mellow Commons call.",
    call_mode:call.call_mode,
    dm_call_id:call.id
  };
}

async function startDmCallSetup(mode) {
  const active = activeConversation();
  if (!active || !active.accepted) return showToast("Accept the message request before calling.", true);
  if (!privateCallsIncluded()) {
    state.view = "plus";
    renderPlus();
    return showToast("Private audio and video calls are included with Premium and Buddy.");
  }
  const person = conversationPerson(active);
  const room = await createDmCall({ conversationId:active.id, mode:mode, person:person });
  if (room) await mountSocialCall(room, person, true);
}

async function createDmCall(start) {
  const result = await supabase.rpc("start_dm_call", {
    p_conversation_id:start.conversationId,
    p_call_mode:start.mode
  });
  if (result.error || !result.data || !result.data[0]) {
    showToast(result.error ? result.error.message : "The call could not start.", true);
    return null;
  }
  const call = result.data[0];
  await Promise.all([loadDmCalls(start.conversationId), loadPendingDmCalls()]);
  if (state.view === "messages") renderMessages();
  showToast("Calling " + start.person.display_name + "…");
  return dmCallRoom(call, start.person);
}

async function answerDmCall(callId, shouldAccept) {
  const pending = state.pendingDmCalls.find(function (item) { return item.id === callId; });
  const existing = state.dmCalls.find(function (item) { return item.id === callId; });
  const conversationId = (pending || existing || {}).conversation_id;
  const result = await supabase.rpc("answer_dm_call", {
    p_call_id:callId,
    p_response:shouldAccept ? "accept" : "decline"
  });
  if (result.error) return showToast(result.error.message, true);
  state.pendingDmCalls = state.pendingDmCalls.filter(function (item) { return item.id !== callId; });
  modalRoot.innerHTML = "";
  if (!shouldAccept) {
    if (conversationId === state.activeConversationId) await loadDmCalls(conversationId);
    if (state.view === "messages") renderMessages();
    return showToast("Call declined.");
  }
  const call = result.data && result.data[0];
  if (!call) return showToast("The call room is unavailable.", true);
  await loadConversations();
  state.activeConversationId = call.conversation_id;
  state.view = "messages";
  await Promise.all([loadMessages(call.conversation_id), loadDmCalls(call.conversation_id)]);
  renderMessages();
  const person = incomingCallPerson(pending || call);
  await mountSocialCall(dmCallRoom(call, person), person, false);
}

async function joinDmCall(callId) {
  const call = state.dmCalls.find(function (item) { return item.id === callId; });
  const active = activeConversation();
  if (!call || call.status !== "active") return showToast("This call is no longer available.", true);
  const person = active && conversationPerson(active);
  await mountSocialCall(dmCallRoom(call, person), person, false);
}

async function endDmCall(callId) {
  const result = await supabase.rpc("end_dm_call", { p_call_id:callId });
  if (result.error) return showToast(result.error.message, true);
  state.pendingDmCalls = state.pendingDmCalls.filter(function (item) { return item.id !== callId; });
  if (state.activeDmCallId === callId) await leaveMeeting(false);
  if (state.activeConversationId) await loadDmCalls(state.activeConversationId);
  if (state.view === "messages") renderMessages();
  modalRoot.innerHTML = "";
  showToast("Private call ended.");
}

async function submitDm(form) {
  const active = activeConversation();
  if (!active) return;
  const data = new FormData(form);
  const body = String(data.get("message") || "").trim();
  if (!body) return;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  const result = await supabase.rpc("send_dm", {
    p_conversation_id:active.id,
    p_kind:"text",
    p_body:body,
    p_storage_path:null,
    p_mime_type:null,
    p_byte_size:null
  });
  button.disabled = false;
  if (result.error) return showToast(result.error.message, true);
  form.reset();
  state.messageDraft = "";
  await loadMessages(active.id);
  await loadConversations();
  renderMessages();
}

async function uploadDmAttachment(blob, kind, mimeType) {
  const active = activeConversation();
  if (!active || !blob) return;
  const type = mimeType || blob.type;
  const allowed = kind === "image"
    ? ["image/jpeg", "image/png", "image/webp"]
    : ["audio/webm", "audio/mp4", "audio/mpeg", "audio/ogg"];
  if (!allowed.includes(type)) return showToast("That file type is not supported.", true);
  if (!blob.size || blob.size > 6291456) return showToast("Attachments must be under 6 MB.", true);
  const extensions = { "image/jpeg":"jpg", "image/png":"png", "image/webp":"webp", "audio/webm":"webm", "audio/mp4":"m4a", "audio/mpeg":"mp3", "audio/ogg":"ogg" };
  const path = active.id + "/" + state.user.id + "/" + crypto.randomUUID() + "." + extensions[type];
  showToast(kind === "image" ? "Uploading photo…" : "Uploading voice message…");
  const uploaded = await supabase.storage.from("dm-media").upload(path, blob, { contentType:type, upsert:false });
  if (uploaded.error) return showToast(uploaded.error.message, true);
  const sent = await supabase.rpc("send_dm", {
    p_conversation_id:active.id,
    p_kind:kind,
    p_body:"",
    p_storage_path:path,
    p_mime_type:type,
    p_byte_size:blob.size
  });
  if (sent.error) {
    await supabase.storage.from("dm-media").remove([path]);
    return showToast(sent.error.message, true);
  }
  await loadMessages(active.id);
  await loadConversations();
  renderMessages();
  showToast(kind === "image" ? "Photo sent." : "Voice message sent.");
}

async function toggleVoiceRecording() {
  if (state.voiceRecorder && state.voiceRecorder.state === "recording") {
    state.voiceRecorder.stop();
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === "undefined") {
    return showToast("Voice recording is not supported in this browser.", true);
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
    const preferred = ["audio/webm", "audio/mp4", "audio/ogg"].find(function (type) { return MediaRecorder.isTypeSupported(type); }) || "";
    const recorder = new MediaRecorder(stream, preferred ? { mimeType:preferred } : undefined);
    state.voiceStream = stream;
    state.voiceRecorder = recorder;
    state.voiceChunks = [];
    recorder.addEventListener("dataavailable", function (event) { if (event.data.size) state.voiceChunks.push(event.data); });
    recorder.addEventListener("stop", async function () {
      clearTimeout(state.voiceTimer);
      const type = recorder.mimeType.split(";")[0] || preferred || "audio/webm";
      const blob = new Blob(state.voiceChunks, { type:type });
      stream.getTracks().forEach(function (track) { track.stop(); });
      state.voiceRecorder = null;
      state.voiceStream = null;
      state.voiceChunks = [];
      if (state.view === "messages") renderMessages();
      await uploadDmAttachment(blob, "voice", type);
    });
    recorder.start();
    state.voiceTimer = setTimeout(function () { if (recorder.state === "recording") recorder.stop(); }, 120000);
    renderMessages();
    showToast("Recording voice message. Tap the red button to stop.");
  } catch (error) {
    showToast(deviceErrorMessage(error), true);
  }
}

async function uploadAvatar(file) {
  if (!file) return;
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(file.type)) return showToast("Choose a JPG, PNG, or WebP image.", true);
  if (file.size > 4194304) return showToast("Profile pictures must be under 4 MB.", true);
  const extensions = { "image/jpeg":"jpg", "image/png":"png", "image/webp":"webp" };
  const path = state.user.id + "/" + crypto.randomUUID() + "." + extensions[file.type];
  showToast("Uploading profile picture…");
  const uploaded = await supabase.storage.from("profile-avatars").upload(path, file, { contentType:file.type, cacheControl:"3600", upsert:false });
  if (uploaded.error) return showToast(uploaded.error.message, true);
  const previous = state.profile.avatar_path;
  const saved = await supabase.from("profiles").update({ avatar_path:path }).eq("id", state.user.id).select().single();
  if (saved.error) {
    await supabase.storage.from("profile-avatars").remove([path]);
    return showToast(saved.error.message, true);
  }
  state.profile = saved.data;
  if (previous) await supabase.storage.from("profile-avatars").remove([previous]);
  renderProfile();
  showToast("Profile picture updated.");
}

async function removeAvatar() {
  const previous = state.profile.avatar_path;
  if (!previous) return;
  const saved = await supabase.from("profiles").update({ avatar_path:null }).eq("id", state.user.id).select().single();
  if (saved.error) return showToast(saved.error.message, true);
  state.profile = saved.data;
  await supabase.storage.from("profile-avatars").remove([previous]);
  renderProfile();
  showToast("Profile picture removed.");
}

function showReportModal(userId, messageId) {
  const context = messageId ? "message" : "profile";
  showModal(messageId ? "Report message" : "Profile safety", '<form class="form" id="reportMemberForm"><input type="hidden" name="user_id" value="' + esc(userId) + '"><input type="hidden" name="message_id" value="' + esc(messageId || "") + '"><input type="hidden" name="context" value="' + context + '"><p>Reports are private. Add enough detail for the Mellow Commons team to review the issue.</p><div class="field"><label>What happened?</label><textarea name="reason" minlength="3" maxlength="500" required placeholder="Describe the unsafe image, profile, or message"></textarea></div><button class="btn btn-primary">Send report</button></form><div class="modal-safety"><strong>Need distance now?</strong><p>Blocking hides this member’s profile and ends access to your conversation.</p><button class="btn btn-danger" data-block-member="' + esc(userId) + '">Block member</button></div>');
}

async function submitMemberReport(form) {
  const data = new FormData(form);
  const result = await supabase.rpc("report_member", {
    p_user_id:data.get("user_id"),
    p_reason:String(data.get("reason") || "").trim(),
    p_context:data.get("context"),
    p_message_id:data.get("message_id") || null
  });
  if (result.error) return showToast(result.error.message, true);
  closeModal();
  showToast("Report sent. Thank you for helping keep Mellow Commons safe.");
}

async function blockMember(userId) {
  const result = await supabase.rpc("block_member", { p_user_id:userId });
  if (result.error) return showToast(result.error.message, true);
  closeModal();
  if (state.dmChannel) { await supabase.removeChannel(state.dmChannel); state.dmChannel = null; }
  state.activeConversationId = null;
  state.messages = [];
  state.memberProfile = null;
  await Promise.all([refreshMembers(), loadConversations()]);
  state.view = "encouragements";
  renderEncouragements();
  showToast("Member blocked.");
}

async function handleAuthSubmit(form) {
  const data = new FormData(form);
  const email = String(data.get("email")).trim();
  const password = String(data.get("password"));
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  button.textContent = "Please wait…";
  if (state.authMode === "signup") {
    const displayName = String(data.get("displayName")).trim();
    const result = await supabase.auth.signUp({ email:email, password:password, options:{ data:{ display_name:displayName }, emailRedirectTo:authReturnUrl() } });
    if (result.error) showToast(result.error.message, true);
    else if (!result.data.session) {
      state.pendingVerificationEmail = email;
      showModal("Check your email", '<p>We sent a confirmation link to <strong>' + esc(email) + '</strong>. Open it to activate your Mellow Commons account.</p><p class="form-note">Check Spam and Promotions. If the link says it was already used, request a fresh one below—some email security scanners can open single-use links before you do.</p><button class="btn" data-resend-email>Resend verification</button> <button class="btn btn-primary" data-close-modal>Got it</button>');
      button.disabled = false; button.textContent = "Create free account";
    }
  } else {
    const result = await supabase.auth.signInWithPassword({ email:email, password:password });
    if (result.error) { showToast(result.error.message, true); button.disabled = false; button.textContent = "Log in"; }
  }
}

async function resendVerification(email) {
  const address = String(email || state.pendingVerificationEmail || "").trim();
  if (!address) return showToast("Enter the email address you registered with.", true);
  const result = await supabase.auth.resend({ type:"signup", email:address, options:{ emailRedirectTo:authReturnUrl() } });
  if (result.error) return showToast(result.error.message, true);
  state.pendingVerificationEmail = address;
  closeModal();
  showToast("A fresh verification email was sent. Check Spam and Promotions too.");
}

async function signInWithGoogle() {
  const result = await supabase.auth.signInWithOAuth({ provider:"google", options:{ redirectTo:authReturnUrl(), queryParams:{ prompt:"select_account" } } });
  if (result.error) showToast(result.error.message, true);
}

function showPasswordReset() {
  showModal("Reset your password", '<form id="passwordResetForm" class="form"><p>Enter your email and we’ll send a secure recovery link.</p><div class="field"><label>Email address</label><input name="email" type="email" required autocomplete="email" placeholder="you@example.com"></div><button class="btn btn-primary">Send reset link</button></form>');
}

async function requestPasswordReset(form) {
  const email = String(new FormData(form).get("email") || "").trim();
  const result = await supabase.auth.resetPasswordForEmail(email, { redirectTo:authReturnUrl() });
  if (result.error) return showToast(result.error.message, true);
  closeModal(); showToast("Password reset link sent.");
}

function showNewPassword() {
  showModal("Choose a new password", '<form id="newPasswordForm" class="form"><div class="field"><label>New password</label><input name="password" type="password" minlength="8" required autocomplete="new-password"></div><button class="btn btn-primary">Update password</button></form>');
}

async function updatePassword(form) {
  const password = String(new FormData(form).get("password") || "");
  const result = await supabase.auth.updateUser({ password:password });
  if (result.error) return showToast(result.error.message, true);
  closeModal(); showToast("Password updated.");
}

async function saveGoal(title) {
  const result = await supabase.from("goals").insert({ user_id:state.user.id, title:title }).select().single();
  if (result.error) return showToast(result.error.message, true);
  state.goals.unshift(result.data); renderGoals();
}

async function toggleGoal(id, complete) {
  const result = await supabase.from("goals").update({ complete:complete }).eq("id", id).select().single();
  if (result.error) return showToast(result.error.message, true);
  const row = state.goals.find(function (g) { return g.id === id; });
  if (row) row.complete = complete;
  renderApp();
}

async function deleteGoal(id) {
  const result = await supabase.from("goals").delete().eq("id", id);
  if (result.error) return showToast(result.error.message, true);
  state.goals = state.goals.filter(function (g) { return g.id !== id; }); renderApp();
}

function setTimerPreset(minutes) {
  const safeMinutes = Math.min(240, Math.max(1, Math.round(Number(minutes) || 25)));
  state.timerPreset = safeMinutes; state.timerSeconds = safeMinutes * 60; state.timerRunning = false;
  clearInterval(state.timerId); renderApp();
}

function showCustomTimer() {
  showModal("Custom focus timer", '<form id="customTimerForm" class="form"><div class="custom-timer-hero"><span>◷</span><div><h3>Choose your own focus block</h3><p>Set anything from 1 minute to 4 hours.</p></div></div><div class="field"><label for="customTimerMinutes">Minutes</label><input id="customTimerMinutes" name="minutes" type="number" inputmode="numeric" min="1" max="240" step="1" required value="' + state.timerPreset + '"></div><button class="btn btn-primary">Use this duration</button></form>');
  requestAnimationFrame(function () { document.querySelector("#customTimerMinutes")?.select(); });
}

function toggleTimer() {
  state.timerRunning = !state.timerRunning;
  if (state.timerRunning) {
    state.timerId = setInterval(async function () {
      state.timerSeconds -= 1;
      const display = document.querySelector("#timerDisplay");
      if (display) display.textContent = formatTimer();
      if (state.timerSeconds <= 0) {
        clearInterval(state.timerId); state.timerRunning = false;
        await saveFocusSession(state.timerPreset);
        state.timerSeconds = state.timerPreset * 60;
        playTimerCue();
        showToast("Focus session complete. Great work.");
        renderApp();
      }
    }, 1000);
  } else clearInterval(state.timerId);
  renderApp();
}

function playTimerCue() {
  if (!state.preferences.soundCues) return;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  const context = new AudioCtx();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.setValueAtTime(660, context.currentTime);
  oscillator.frequency.setValueAtTime(880, context.currentTime + .14);
  gain.gain.setValueAtTime(.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(.08, context.currentTime + .02);
  gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .38);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(); oscillator.stop(context.currentTime + .4);
  oscillator.onended = function () { context.close(); };
}

async function saveFocusSession(minutes) {
  const result = await supabase.from("focus_sessions").insert({ user_id:state.user.id, room_id:state.activeRoom && state.activeRoom.id || null, minutes:minutes }).select().single();
  if (!result.error) state.sessions.unshift(result.data);
}

function resetTimer() {
  clearInterval(state.timerId); state.timerRunning = false; state.timerSeconds = state.timerPreset * 60; renderApp();
}

async function joinPublicRoom(roomId) {
  if (!state.session) { state.authMode = "signup"; return renderAuth(); }
  const room = state.rooms.find(function (item) { return item.id === roomId; });
  if (!room) return;
  showJoinLobby(room, false);
}

function deviceErrorMessage(error) {
  if (!window.isSecureContext) return "Camera and microphone need a secure HTTPS page.";
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return "This browser does not support camera and microphone access.";
  if (error && (error.name === "NotAllowedError" || error.name === "SecurityError")) return "Permission was blocked. Allow camera and microphone for this site in your browser settings, then try again.";
  if (error && (error.name === "NotFoundError" || error.name === "DevicesNotFoundError")) return "No camera or microphone was found. Connect a device and try again.";
  if (error && (error.name === "NotReadableError" || error.name === "TrackStartError")) return "A device is busy in another app. Close other video apps and try again.";
  return "The device check could not start. Check browser permissions and try again.";
}

function watchLocalTrack(track) {
  if (!track) return;
  track.onended = async function () {
    if (!state.localCallStream || !state.localCallStream.getTracks().includes(track)) return;
    const label = track.kind === "video" ? "Camera" : "Microphone";
    showToast(label + " disconnected. Choose another device to continue.", true);
    if (state.rtcSession) await state.rtcSession.updatePresence(track.kind === "video" ? { camera:false } : { microphone:false });
    if (document.querySelector(".study-stream")) renderRoomGrid();
    if (document.querySelector(".social-call-page") && track.kind === "video") document.querySelector(".local-call-card")?.classList.add("camera-off");
  };
}

function watchLocalStream(stream) {
  if (stream) stream.getTracks().forEach(watchLocalTrack);
  return stream;
}

function showJoinLobby(room, isPrivate) {
  state.pendingRoom = room;
  state.pendingPrivate = Boolean(isPrivate);
  const draft = state.joinDraft;
  showModal("Set up your session", '<form id="joinLobbyForm" class="join-lobby"><div class="lobby-grid"><div class="device-panel"><div class="video-preview-wrap"><video id="devicePreview" autoplay muted playsinline></video><div class="video-placeholder" id="videoPlaceholder"><span>◉</span><strong>Preview is off</strong><small>Nothing is shared until you join</small></div><div class="mic-meter" aria-label="Microphone level"><i id="micLevel"></i></div></div><button class="btn device-check-btn" type="button" data-check-devices>Test camera & microphone</button><p class="device-status" id="deviceStatus">You can also join with both off.</p></div><div class="lobby-options"><span class="eyebrow">' + (isPrivate ? 'Private room' : 'Public focus room') + '</span><h3>' + esc(room.name || room.title) + '</h3><p>' + esc(room.description || (room.call_mode === "audio" ? "Invite-only audio study call." : "Invite-only video study call.")) + '</p>' + (isPrivate ? '' : '<div class="public-room-open"><span>∞</span><div><strong>No join limit</strong><small>Everyone can enter. Video is organized into small live circles as the room grows.</small></div></div>') + '<div class="field"><label for="sessionIntention">What will you finish?</label><input id="sessionIntention" name="intention" maxlength="100" value="' + esc(draft.intention) + '" placeholder="One clear task"></div><div class="field"><label for="sessionDuration">Focus block (minutes)</label><input id="sessionDuration" name="duration" type="number" inputmode="numeric" min="1" max="240" step="1" required value="' + Math.min(240, Math.max(1, Number(draft.duration || 50))) + '"><small>Choose any duration from 1 to 240 minutes.</small></div><div class="device-switches"><label><input type="checkbox" name="camera" data-media-toggle="camera"' + (draft.camera ? ' checked' : '') + '><span>Camera</span><small id="cameraState">' + (draft.camera ? 'On' : 'Off') + '</small></label><label><input type="checkbox" name="microphone" data-media-toggle="microphone"' + (draft.microphone ? ' checked' : '') + '><span>Microphone</span><small id="microphoneState">' + (draft.microphone ? 'On' : 'Off') + '</small></label></div><div class="device-selects" id="deviceSelects"><div class="field"><label>Camera</label><select name="cameraDevice" disabled><option>Run device test first</option></select></div><div class="field"><label>Microphone</label><select name="microphoneDevice" disabled><option>Run device test first</option></select></div></div></div></div><div class="lobby-footer"><p><strong>Privacy:</strong> your preview stays on this device. Mellow Commons does not record calls.</p><div><button type="button" class="btn" data-close-modal>Cancel</button> <button class="btn btn-primary" type="submit">Join room →</button></div></div></form>', true);
}

async function populateDeviceSelectors() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameraSelect = document.querySelector('[name="cameraDevice"]');
  const micSelect = document.querySelector('[name="microphoneDevice"]');
  if (!cameraSelect || !micSelect) return;
  const cameras = devices.filter(function (device) { return device.kind === "videoinput"; });
  const microphones = devices.filter(function (device) { return device.kind === "audioinput"; });
  cameraSelect.innerHTML = cameras.map(function (device, index) { return '<option value="' + esc(device.deviceId) + '">' + esc(device.label || "Camera " + (index + 1)) + '</option>'; }).join("") || '<option value="">No camera found</option>';
  micSelect.innerHTML = microphones.map(function (device, index) { return '<option value="' + esc(device.deviceId) + '">' + esc(device.label || "Microphone " + (index + 1)) + '</option>'; }).join("") || '<option value="">No microphone found</option>';
  cameraSelect.disabled = !cameras.length;
  micSelect.disabled = !microphones.length;
  if (state.joinDraft.cameraDeviceId) cameraSelect.value = state.joinDraft.cameraDeviceId;
  if (state.joinDraft.microphoneDeviceId) micSelect.value = state.joinDraft.microphoneDeviceId;
}

function startMicMeter(stream) {
  const audioTrack = stream.getAudioTracks()[0];
  if (!audioTrack) return;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  state.previewAudioContext = new AudioCtx();
  const source = state.previewAudioContext.createMediaStreamSource(new MediaStream([audioTrack]));
  const analyser = state.previewAudioContext.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  const draw = function () {
    analyser.getByteFrequencyData(data);
    const average = data.reduce(function (sum, value) { return sum + value; }, 0) / data.length;
    const level = document.querySelector("#micLevel");
    if (level) level.style.width = Math.max(4, Math.min(100, average * 1.45)) + "%";
    state.previewAnimation = requestAnimationFrame(draw);
  };
  draw();
}

function stopDevicePreview() {
  if (state.previewAnimation) cancelAnimationFrame(state.previewAnimation);
  state.previewAnimation = null;
  if (state.previewStream) state.previewStream.getTracks().forEach(function (track) { track.stop(); });
  state.previewStream = null;
  if (state.previewAudioContext) state.previewAudioContext.close().catch(function () {});
  state.previewAudioContext = null;
}

async function checkDevices() {
  const status = document.querySelector("#deviceStatus");
  const button = document.querySelector("[data-check-devices]");
  if (status) status.textContent = "Requesting browser permission…";
  if (button) button.disabled = true;
  stopDevicePreview();
  try {
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new DOMException("Media unavailable", "SecurityError");
    const stream = new MediaStream();
    const failures = [];
    try {
      const camera = await navigator.mediaDevices.getUserMedia({ video:true, audio:false });
      camera.getVideoTracks().forEach(function (track) { stream.addTrack(track); });
    } catch (error) { failures.push({ kind:"Camera", error:error }); }
    try {
      const microphone = await navigator.mediaDevices.getUserMedia({ video:false, audio:{ echoCancellation:true, noiseSuppression:true, autoGainControl:true } });
      microphone.getAudioTracks().forEach(function (track) { stream.addTrack(track); });
    } catch (error) { failures.push({ kind:"Microphone", error:error }); }
    if (!stream.getTracks().length) throw failures[0]?.error || new DOMException("No media devices", "NotFoundError");
    state.previewStream = stream;
    const video = document.querySelector("#devicePreview");
    if (video) { video.srcObject = stream; await video.play().catch(function () {}); }
    state.joinDraft.camera = Boolean(stream.getVideoTracks().length);
    state.joinDraft.microphone = Boolean(stream.getAudioTracks().length);
    document.querySelector("#videoPlaceholder")?.classList.toggle("hidden", state.joinDraft.camera);
    const cameraToggle = document.querySelector('[name="camera"]');
    const micToggle = document.querySelector('[name="microphone"]');
    if (cameraToggle) cameraToggle.checked = state.joinDraft.camera;
    if (micToggle) micToggle.checked = state.joinDraft.microphone;
    const cameraState = document.querySelector("#cameraState");
    const microphoneState = document.querySelector("#microphoneState");
    if (cameraState) cameraState.textContent = state.joinDraft.camera ? "On" : "Unavailable";
    if (microphoneState) microphoneState.textContent = state.joinDraft.microphone ? "On" : "Unavailable";
    try { await populateDeviceSelectors(); }
    catch (error) { failures.push({ kind:"Device list", error:error }); }
    startMicMeter(stream);
    if (status) {
      status.textContent = failures.length
        ? failures.map(function (item) { return item.kind + " unavailable"; }).join(" · ") + ". You can still join with the working device or both off."
        : "Devices are working. Choose what to keep on when you enter.";
      status.classList.toggle("error", failures.length > 0);
    }
    if (button) button.textContent = "Test again";
  } catch (error) {
    if (status) { status.textContent = deviceErrorMessage(error); status.classList.add("error"); }
  } finally {
    if (button) button.disabled = false;
  }
}

function togglePreviewTrack(kind, enabled) {
  state.joinDraft[kind] = enabled;
  const tracks = state.previewStream ? (kind === "camera" ? state.previewStream.getVideoTracks() : state.previewStream.getAudioTracks()) : [];
  tracks.forEach(function (track) { track.enabled = enabled; });
  const label = document.querySelector(kind === "camera" ? "#cameraState" : "#microphoneState");
  if (label) label.textContent = enabled ? (tracks.length ? "On" : "Enable in call") : "Off";
  if (kind === "camera") document.querySelector("#videoPlaceholder")?.classList.toggle("hidden", enabled && tracks.length > 0);
}

async function beginFocusVisit(room, isPrivate) {
  if (isPrivate || room.dm_call_id) return true;
  const result = await supabase.rpc("start_focus_room_visit", { p_room_id:room.id });
  if (result.error || !result.data || !result.data[0]) {
    showToast(result.error ? result.error.message : "Your public room time is unavailable.", true);
    return false;
  }
  const visit = result.data[0];
  state.focusVisitId = visit.visit_id;
  state.focusAllowance = Object.assign({}, state.focusAllowance, visit);
  clearInterval(state.focusHeartbeat);
  state.focusHeartbeat = setInterval(heartbeatFocusVisit, 30000);
  return true;
}

async function heartbeatFocusVisit() {
  if (!state.focusVisitId || state.focusHeartbeatBusy) return;
  state.focusHeartbeatBusy = true;
  const result = await supabase.rpc("heartbeat_focus_room_visit", { p_visit_id:state.focusVisitId });
  state.focusHeartbeatBusy = false;
  if (result.error || !result.data || !result.data[0]) return;
  const allowance = result.data[0];
  state.focusAllowance = Object.assign({}, state.focusAllowance, allowance);
  const remaining = document.querySelector("#meetingAllowance");
  if (remaining) remaining.textContent = allowance.is_unlimited ? "Unlimited room time" : fmtMinutes(Math.ceil(Number(allowance.remaining_seconds || 0) / 60)) + " left today";
  if (!allowance.allowed) {
    await leaveMeeting();
    state.view = "plus";
    renderPlus();
    showToast("You reached today’s public focus-room limit. Your goals and timer still remain available.", true);
  }
}

async function endFocusVisit() {
  clearInterval(state.focusHeartbeat);
  state.focusHeartbeat = null;
  const visitId = state.focusVisitId;
  state.focusVisitId = null;
  if (visitId) await supabase.rpc("end_focus_room_visit", { p_visit_id:visitId });
  const result = await supabase.rpc("get_focus_room_allowance");
  if (result.data && result.data[0]) state.focusAllowance = result.data[0];
}

function showMeetingDecorations() {
  const frames = [["none","None"],["soft-glow","Soft glow"],["notebook","Notebook"],["mint-ring","Mint ring"],["moonlit","Moonlit"],["garden","Garden"],["aurora","Aurora"]].map(function (frame) { return '<label class="cosmetic-option"><input type="radio" name="frame" value="' + frame[0] + '"' + (state.meetingFrame === frame[0] ? ' checked' : '') + '><span class="frame-swatch frame-' + frame[0] + '"></span><small>' + frame[1] + '</small></label>'; }).join("");
  const stickers = [["","None"],["moon","☾"],["sprout","🌱"],["sparkles","✦"],["books","📚"],["coffee","☕"],["flower","✿"]].map(function (sticker) { return '<label class="sticker-option"><input type="radio" name="sticker" value="' + sticker[0] + '"' + (state.meetingSticker === sticker[0] ? ' checked' : '') + '><span>' + sticker[1] + '</span></label>'; }).join("");
  const effects = [["natural","Natural"],["warm","Warm"],["moonlight","Moonlight"],["mono","Mono"],["dreamy","Dreamy"]].map(function (effect) { return '<label class="effect-option effect-' + effect[0] + '"><input type="radio" name="effect" value="' + effect[0] + '"' + (state.roomEffect === effect[0] ? ' checked' : '') + '><span></span><small>' + effect[1] + '</small></label>'; }).join("");
  showModal("Stream effects", '<form id="meetingDecorForm" class="form"><p>Style the study-stream interface around your video. These effects never alter the camera track sent to other students.</p><div class="field"><label>Video mood</label><div class="effect-grid">' + effects + '</div></div><div class="settings-grid"><div class="field"><label>Video quality</label><select name="quality"><option value="data"' + (state.roomQuality === "data" ? ' selected' : '') + '>Data saver · 360p</option><option value="balanced"' + (state.roomQuality === "balanced" ? ' selected' : '') + '>Balanced · 720p</option><option value="hd"' + (state.roomQuality === "hd" ? ' selected' : '') + '>High definition · 1080p</option></select></div><label class="check-option"><input type="checkbox" name="mirror"' + (state.roomMirror ? ' checked' : '') + '><span>Mirror my preview</span></label></div><div class="field"><label>Room frame</label><div class="cosmetic-grid">' + frames + '</div></div><div class="field"><label>Corner sticker</label><div class="sticker-grid">' + stickers + '</div></div><button class="btn btn-primary">Apply effects</button></form>', true);
}

function saveMeetingDecorations(form) {
  const data = new FormData(form);
  state.meetingFrame = String(data.get("frame") || "none");
  state.meetingSticker = String(data.get("sticker") || "");
  state.roomEffect = String(data.get("effect") || "natural");
  state.roomQuality = String(data.get("quality") || "balanced");
  state.roomMirror = data.has("mirror");
  localStorage.setItem("mellow-meeting-frame", state.meetingFrame);
  localStorage.setItem("mellow-meeting-sticker", state.meetingSticker);
  localStorage.setItem("mellow-room-effect", state.roomEffect);
  localStorage.setItem("mellow-room-quality", state.roomQuality);
  localStorage.setItem("mellow-room-mirror", String(state.roomMirror));
  const page = document.querySelector(".meeting-page");
  if (page) { page.dataset.frame = state.meetingFrame; page.dataset.mirror = String(state.roomMirror); }
  const sticker = document.querySelector("#meetingSticker");
  if (sticker) sticker.textContent = stickerGlyph(state.meetingSticker);
  if (state.rtcSession && document.querySelector(".study-stream")) {
    state.rtcSession.updatePresence({ effect:state.roomEffect });
    renderRoomGrid();
  }
  closeModal(); showToast("Stream effects applied.");
}

function setSocialCallStatus(message) {
  const status = document.querySelector("#socialCallStatus");
  if (status) status.textContent = message;
}

function formatCallDuration(seconds) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  return minutes + ":" + (seconds % 60).toString().padStart(2, "0");
}

function startSocialCallTimer() {
  if (!state.socialCallStartedAt) state.socialCallStartedAt = Date.now();
  clearInterval(state.socialCallTimerId);
  const update = function () {
    const timer = document.querySelector("#socialCallTimer");
    if (timer) timer.textContent = formatCallDuration(Math.floor((Date.now() - state.socialCallStartedAt) / 1000));
  };
  update();
  state.socialCallTimerId = setInterval(update, 1000);
}

function updateSocialControl(kind, muted) {
  const button = document.querySelector(kind === "audio" ? "#socialMicButton" : "#socialVideoButton");
  if (!button) return;
  button.classList.toggle("off", muted);
  button.setAttribute("aria-pressed", String(muted));
  const label = button.querySelector("small");
  if (label) label.textContent = kind === "audio" ? (muted ? "Unmute" : "Mute") : (muted ? "Camera on" : "Camera off");
  const icon = button.querySelector("span");
  if (icon) icon.textContent = kind === "audio" ? (muted ? "⌁" : "●") : (muted ? "▢" : "▣");
}

async function runSocialCallCommand(command) {
  if (!state.localCallStream) return;
  if (command === "toggleAudio") {
    const tracks = state.localCallStream.getAudioTracks();
    if (!tracks.length) return showToast("No microphone is available on this device.", true);
    state.socialMicMuted = !state.socialMicMuted;
    tracks.forEach(function (track) { track.enabled = !state.socialMicMuted; });
    await state.rtcSession?.updatePresence({ microphone:!state.socialMicMuted });
    updateSocialControl("audio", state.socialMicMuted);
  }
  if (command === "toggleVideo") {
    const tracks = state.localCallStream.getVideoTracks();
    if (!tracks.length) return showToast("Camera access is off. Check your browser permissions to turn it on.", true);
    state.socialVideoMuted = !state.socialVideoMuted;
    tracks.forEach(function (track) { track.enabled = !state.socialVideoMuted; });
    await state.rtcSession?.updatePresence({ camera:!state.socialVideoMuted });
    updateSocialControl("video", state.socialVideoMuted);
    document.querySelector(".local-call-card")?.classList.toggle("camera-off", state.socialVideoMuted);
  }
  if (command === "upgradeVideo") {
    try {
      const camera = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:{ ideal:"user" }, width:{ ideal:1280 }, height:{ ideal:720 } }, audio:false });
      const cameraTrack = camera.getVideoTracks()[0];
      watchLocalTrack(cameraTrack);
      await state.rtcSession.replaceTrack("video", cameraTrack);
      state.socialVideoMuted = false;
      state.socialCallMode = "video";
      await state.rtcSession.updatePresence({ camera:true });
      const page = document.querySelector(".social-call-page");
      page?.classList.add("video-upgraded");
      const preview = document.querySelector("#localCallVideo");
      if (preview) { preview.srcObject = state.localCallStream; preview.play().catch(function () {}); }
      const button = document.querySelector("#socialVideoButton");
      if (button) { button.dataset.socialCommand = "toggleVideo"; button.querySelector("small").textContent = "Camera off"; }
    } catch (error) { showToast(deviceErrorMessage(error), true); }
  }
  if (command === "toggleCamera") await switchNativeCamera();
  if (command === "devices") await showRoomDeviceSettings();
}

async function switchNativeCamera() {
  if (!state.rtcSession || !state.localCallStream) return;
  const oldTrack = state.localCallStream.getVideoTracks()[0];
  if (!oldTrack) return showToast("No camera is available to switch.", true);
  const nextFacing = state.callFacingMode === "user" ? "environment" : "user";
  try {
    const replacement = await navigator.mediaDevices.getUserMedia({
      video:{ facingMode:{ ideal:nextFacing }, width:{ ideal:1280 }, height:{ ideal:720 } },
      audio:false
    });
    const nextTrack = replacement.getVideoTracks()[0];
    const inStudyStream = Boolean(document.querySelector(".study-stream"));
    nextTrack.enabled = inStudyStream ? true : !state.socialVideoMuted;
    watchLocalTrack(nextTrack);
    await state.rtcSession.replaceTrack("video", nextTrack);
    state.callFacingMode = nextFacing;
    await state.rtcSession.updatePresence({ camera:nextTrack.enabled });
    const preview = document.querySelector("#localCallVideo");
    if (preview) preview.srcObject = state.localCallStream;
    if (document.querySelector(".study-stream")) renderRoomGrid();
  } catch (error) {
    showToast("This device could not switch cameras.", true);
  }
}

function markNativeCallConnected() {
  if (!state.socialCallConnected) startSocialCallTimer();
  state.socialCallConnected = true;
  setSocialCallStatus("Connected");
  document.querySelector(".social-call-page")?.classList.add("peer-connected");
}

async function playRemoteCallMedia() {
  const media = document.querySelector("#remoteCallMedia");
  const gate = document.querySelector("#callSoundGate");
  if (!media) return;
  try {
    await media.play();
    if (gate) gate.hidden = true;
  } catch (error) {
    if (gate) gate.hidden = false;
    setSocialCallStatus("Tap for sound");
  }
}

async function startNativeCallConnection(room, audioOnly, outgoing) {
  if (!window.isSecureContext || !navigator.mediaDevices || !window.RTCPeerConnection) {
    setSocialCallStatus("Calls unsupported here");
    showToast("Open the secure HTTPS site in a current version of Chrome, Safari, or Edge.", true);
    return;
  }

  const audio = { echoCancellation:true, noiseSuppression:true, autoGainControl:true };
  const stream = new MediaStream();
  const unavailable = [];
  try {
    const microphone = await navigator.mediaDevices.getUserMedia({ audio:audio, video:false });
    microphone.getAudioTracks().forEach(function (track) { stream.addTrack(track); });
  } catch (error) { unavailable.push("microphone"); }
  if (!audioOnly) {
    try {
      const camera = await navigator.mediaDevices.getUserMedia({
        audio:false,
        video:{ facingMode:{ ideal:"user" }, width:{ ideal:1280, max:1920 }, height:{ ideal:720, max:1080 } }
      });
      camera.getVideoTracks().forEach(function (track) { stream.addTrack(track); });
    } catch (error) { unavailable.push("camera"); }
  }

  state.socialMicMuted = stream.getAudioTracks().length === 0;
  state.socialVideoMuted = audioOnly || stream.getVideoTracks().length === 0;
  if (state.socialMicMuted) updateSocialControl("audio", true);
  if (state.socialVideoMuted && !audioOnly) updateSocialControl("video", true);
  document.querySelector(".local-call-card")?.classList.toggle("camera-off", state.socialVideoMuted);
  if (unavailable.length) {
    showToast(unavailable.map(function (kind) { return kind[0].toUpperCase() + kind.slice(1); }).join(" and ") + " unavailable. The call will continue with the devices that are available.", true);
  }

  state.localCallStream = watchLocalStream(stream);
  const preview = document.querySelector("#localCallVideo");
  if (preview) { preview.srcObject = stream; preview.play().catch(function () {}); }
  const clientId = crypto.randomUUID();
  state.rtcClientId = clientId;
  const session = new RealtimeWebRTCSession({
    supabase:supabase,
    authSession:state.session,
    topic:"dm-call:" + room.dm_call_id,
    clientId:clientId,
    localStream:stream,
    maxPeers:1,
    iceServers:await resolveIceServers(),
    presence:{ user_id:state.user.id, display_name:state.profile.display_name, camera:stream.getVideoTracks().length > 0, microphone:stream.getAudioTracks().length > 0 },
    onRemoteStream:function (_, remote) {
      state.remoteCallStream = remote;
      const media = document.querySelector("#remoteCallMedia");
      if (media) { media.srcObject = remote; playRemoteCallMedia(); }
      const video = remote.getVideoTracks()[0];
      const page = document.querySelector(".social-call-page");
      if (video && video.readyState === "live") { page?.classList.add("media-connected"); page?.classList.add("video-upgraded"); }
      if (video) {
        video.onmute = function () { page?.classList.remove("media-connected"); };
        video.onunmute = function () { page?.classList.add("media-connected"); };
        video.onended = function () { page?.classList.remove("media-connected"); };
      }
    },
    onPeerState:function (_, status) {
      if (status === "connected") markNativeCallConnected();
      else if (status === "connecting" || status === "new") setSocialCallStatus(outgoing ? "Ringing…" : "Connecting…");
      else if (status === "disconnected") setSocialCallStatus("Reconnecting…");
      else if (status === "failed") {
        setSocialCallStatus("Connection blocked");
        showToast("This network blocked the direct connection. Try another network; relay support can be added through the TURN configuration.", true);
      } else if (status === "left") setSocialCallStatus("Call ended");
    },
    onEvent:function (kind) { if (kind === "hangup") leaveMeeting(false); },
    onStatus:function (status) {
      if (status === "SUBSCRIBED") setSocialCallStatus(outgoing ? "Calling…" : "Connecting…");
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        setSocialCallStatus("Secure connection unavailable");
        showToast("The private call could not open its secure signaling channel. End it and try again.", true);
      }
    }
  });
  state.rtcSession = session;
  await session.start();
}

function roomPresence(options) {
  return {
    user_id:state.user.id,
    display_name:state.profile.display_name,
    avatar_color:state.profile.avatar_color,
    avatar_path:state.profile.avatar_path,
    profile_frame:state.profile.profile_frame,
    profile_sticker:state.profile.profile_sticker,
    intention:String(options.intention || "Quiet focus"),
    camera:Boolean(state.localCallStream && state.localCallStream.getVideoTracks().some(function (track) { return track.enabled; })),
    microphone:Boolean(state.localCallStream && state.localCallStream.getAudioTracks().some(function (track) { return track.enabled; })),
    effect:state.roomEffect
  };
}

function roomTileMarkup(person, local) {
  const clientId = person.client_id || state.rtcClientId;
  const cameraOn = Boolean(person.camera);
  const status = local ? "Your stream" : (state.roomPeerStates[clientId] === "connected" ? "Studying live" : "Joining…");
  const effect = ["natural", "warm", "moonlight", "mono", "dreamy"].includes(person.effect) ? person.effect : "natural";
  return '<article class="rtc-tile effect-' + effect + (cameraOn ? '' : ' camera-off') + (local ? ' local' : '') + '" data-rtc-tile="' + esc(clientId) + '"><video id="roomVideo-' + esc(clientId) + '" autoplay playsinline' + (local ? ' muted' : '') + '></video><div class="rtc-camera-off">' + avatarMarkup(person, "room-avatar") + '<strong>' + esc(person.display_name || "Student") + '</strong><span>' + esc(person.intention || "Quiet focus") + '</span></div><div class="rtc-tile-shade"></div><footer><div><strong>' + esc(person.display_name || "Student") + (local ? ' <em>You</em>' : '') + '</strong><span><i></i>' + esc(status) + '</span></div><div class="rtc-tile-actions">' + (!local && person.user_id ? '<button data-room-boost="' + esc(person.user_id) + '" title="Send a live Focus Boost" aria-label="Boost ' + esc(person.display_name || "student") + '">✦</button>' : '') + '<span aria-label="' + (person.microphone ? 'Microphone on' : 'Microphone muted') + '">' + (person.microphone ? '●' : '⌁') + '</span></div></footer></article>';
}

function renderRoomGrid() {
  const grid = document.querySelector("#roomGrid");
  if (!grid || !state.rtcClientId) return;
  const local = Object.assign({}, roomPresence(state.joinDraft), { client_id:state.rtcClientId });
  const streaming = state.roomParticipants.filter(function (person) { return person.stream_slot !== false; });
  const visible = [local].concat(streaming).slice(0, 6);
  grid.dataset.count = String(visible.length);
  grid.innerHTML = visible.map(function (person, index) { return roomTileMarkup(person, index === 0); }).join("");
  const localVideo = document.getElementById("roomVideo-" + state.rtcClientId);
  if (localVideo) { localVideo.srcObject = state.localCallStream; localVideo.play().catch(function () {}); }
  streaming.forEach(function (person) {
    const peer = state.rtcSession && state.rtcSession.peers.get(person.client_id);
    const video = document.getElementById("roomVideo-" + person.client_id);
    if (video && peer && peer.remoteStream) {
      video.srcObject = peer.remoteStream;
      video.play().catch(function () {});
    }
  });
  const roomTotal = state.roomParticipants.length + 1;
  const count = document.querySelector("#roomPeopleCount");
  if (count) count.textContent = String(roomTotal);
  const circleNotice = document.querySelector("#roomCircleNotice");
  if (circleNotice) {
    circleNotice.hidden = roomTotal <= PUBLIC_STREAM_CIRCLE_SIZE;
    const title = circleNotice.querySelector("strong");
    const detail = circleNotice.querySelector("span");
    if (title) title.textContent = roomTotal + " studying across this open room";
    if (detail) detail.textContent = "You are seeing a live circle of " + visible.length + ". Everyone remains visible in People.";
  }
  renderRoomPeople();
}

function renderRoomPeople() {
  const list = document.querySelector("#roomPeopleList");
  if (!list) return;
  const everyone = [Object.assign({}, state.profile, roomPresence(state.joinDraft), { client_id:state.rtcClientId, local:true })].concat(state.roomParticipants);
  list.innerHTML = everyone.map(function (person) {
    const presenceLabel = !person.local && person.stream_slot === false ? "In room" : (person.camera ? "Camera on" : "Camera off");
    return '<div class="room-person">' + avatarMarkup(person) + '<span><strong>' + esc(person.display_name) + (person.local ? ' · You' : '') + '</strong><small>' + esc(person.intention || "Quiet focus") + '</small></span><i class="' + (person.camera && person.stream_slot !== false ? 'on' : '') + '">' + presenceLabel + '</i></div>';
  }).join("");
}

function appendRoomChat(message, local) {
  state.roomChat.push(Object.assign({}, message, { local:Boolean(local), at:message.at || new Date().toISOString() }));
  state.roomChat = state.roomChat.slice(-100);
  const list = document.querySelector("#roomChatList");
  if (!list) return;
  list.innerHTML = state.roomChat.map(function (item) {
    return '<div class="room-chat-message ' + (item.local ? 'mine' : '') + '"><strong>' + esc(item.display_name || "Student") + '</strong><p>' + esc(item.body) + '</p><time>' + new Date(item.at).toLocaleTimeString([], { hour:"numeric", minute:"2-digit" }) + '</time></div>';
  }).join("");
  list.scrollTop = list.scrollHeight;
}

function showRoomBoost(payload) {
  if (!payload || payload.receiver_id !== state.user.id) return;
  const layer = document.querySelector("#roomCelebration");
  if (!layer) return;
  layer.innerHTML = '<div class="live-boost"><span>✦</span><strong>' + esc(payload.sender_name || "A study partner") + ' boosted your focus</strong><small>' + esc(payload.message || "Keep going — you’ve got this.") + '</small></div>';
  layer.classList.add("show");
  clearTimeout(showRoomBoost.timeout);
  showRoomBoost.timeout = setTimeout(function () { layer.classList.remove("show"); }, 4200);
}

function handleRoomEvent(kind, payload) {
  if (kind === "room-chat" && payload.body) appendRoomChat(payload, false);
  if (kind === "boost") showRoomBoost(payload);
}

async function acquireRoomStream(options) {
  if (!window.isSecureContext || !navigator.mediaDevices || !window.RTCPeerConnection) throw new Error("Native camera calls require the secure HTTPS site in a current browser.");
  const stream = new MediaStream();
  if (options.microphone) {
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio:{ deviceId:options.microphoneDeviceId ? { exact:options.microphoneDeviceId } : undefined, echoCancellation:true, noiseSuppression:true, autoGainControl:true }, video:false });
      audioStream.getAudioTracks().forEach(function (track) { watchLocalTrack(track); stream.addTrack(track); });
    } catch (error) { showToast("Microphone stayed off. " + deviceErrorMessage(error), true); }
  }
  if (options.camera) {
    const sizes = state.roomQuality === "hd" ? [1920, 1080] : (state.roomQuality === "data" ? [640, 360] : [1280, 720]);
    try {
      const videoStream = await navigator.mediaDevices.getUserMedia({ video:{ deviceId:options.cameraDeviceId ? { exact:options.cameraDeviceId } : undefined, facingMode:{ ideal:"user" }, width:{ ideal:sizes[0] }, height:{ ideal:sizes[1] } }, audio:false });
      videoStream.getVideoTracks().forEach(function (track) { watchLocalTrack(track); stream.addTrack(track); });
    } catch (error) { showToast("Camera stayed off. " + deviceErrorMessage(error), true); }
  }
  return stream;
}

function startRoomTimer(shouldRun) {
  clearInterval(state.roomTimerId);
  if (typeof shouldRun === "boolean") state.timerRunning = shouldRun;
  const update = function () {
    const timer = document.querySelector("#roomCountdown");
    if (timer) timer.textContent = formatTimer();
    const button = document.querySelector('[data-room-command="timer"] small');
    if (button) button.textContent = state.timerRunning ? "Pause" : "Resume";
  };
  update();
  if (!state.timerRunning) return;
  state.roomTimerId = setInterval(async function () {
    if (!state.timerRunning) return;
    state.timerSeconds = Math.max(0, state.timerSeconds - 1);
    update();
    if (state.timerSeconds === 0) {
      clearInterval(state.roomTimerId);
      state.roomTimerId = null;
      state.timerRunning = false;
      await saveFocusSession(state.timerPreset);
      playTimerCue();
      showToast("Focus block complete. Take a real break ✦");
    }
  }, 1000);
}

async function setRoomTrack(kind, enabled) {
  if (!state.localCallStream || !state.rtcSession) return;
  let track = state.localCallStream.getTracks().find(function (item) { return item.kind === kind; });
  if (enabled && !track) {
    try {
      const media = await navigator.mediaDevices.getUserMedia(kind === "audio" ? { audio:{ echoCancellation:true, noiseSuppression:true, autoGainControl:true }, video:false } : { audio:false, video:{ facingMode:{ ideal:state.callFacingMode } } });
      track = media.getTracks()[0];
      watchLocalTrack(track);
      await state.rtcSession.replaceTrack(kind, track);
    } catch (error) { return showToast(deviceErrorMessage(error), true); }
  }
  if (track) track.enabled = Boolean(enabled);
  await state.rtcSession.updatePresence(kind === "video" ? { camera:Boolean(enabled) } : { microphone:Boolean(enabled) });
  renderRoomGrid();
}

async function runRoomCommand(command) {
  if (!state.rtcSession) return;
  if (command === "audio") {
    const track = state.localCallStream.getAudioTracks()[0];
    await setRoomTrack("audio", !(track && track.enabled));
  }
  if (command === "video") {
    const track = state.localCallStream.getVideoTracks()[0];
    await setRoomTrack("video", !(track && track.enabled));
  }
  if (command === "camera") await switchNativeCamera();
  if (command === "devices") await showRoomDeviceSettings();
  if (command === "people") document.querySelector("#roomPeopleDrawer")?.classList.toggle("open");
  if (command === "chat") document.querySelector("#roomChatDrawer")?.classList.toggle("open");
  if (command === "effects") showMeetingDecorations();
  if (command === "timer") startRoomTimer(!state.timerRunning);
  if (command === "reset") { state.timerSeconds = state.timerPreset * 60; startRoomTimer(true); }
}

async function showRoomDeviceSettings() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter(function (item) { return item.kind === "videoinput"; });
  const microphones = devices.filter(function (item) { return item.kind === "audioinput"; });
  const outputs = devices.filter(function (item) { return item.kind === "audiooutput"; });
  const options = function (items, fallback) { return items.map(function (item, index) { return '<option value="' + esc(item.deviceId) + '">' + esc(item.label || fallback + " " + (index + 1)) + '</option>'; }).join(""); };
  showModal("Camera & audio", '<form id="roomDeviceForm" class="form"><div class="field"><label>Camera</label><select name="cameraDevice">' + options(cameras, "Camera") + '</select></div><div class="field"><label>Microphone</label><select name="microphoneDevice">' + options(microphones, "Microphone") + '</select></div>' + (outputs.length && typeof HTMLMediaElement.prototype.setSinkId === "function" ? '<div class="field"><label>Speaker</label><select name="speakerDevice">' + options(outputs, "Speaker") + '</select></div>' : '<p class="form-note">Speaker selection is managed by your browser on this device.</p>') + '<button class="btn btn-primary">Apply devices</button></form>');
}

async function applyRoomDevices(form) {
  const data = new FormData(form);
  const replacements = [["video", "cameraDevice"], ["audio", "microphoneDevice"]];
  for (const pair of replacements) {
    const deviceId = String(data.get(pair[1]) || "");
    if (!deviceId) continue;
    try {
      const previous = state.localCallStream && state.localCallStream.getTracks().find(function (track) { return track.kind === pair[0]; });
      const media = await navigator.mediaDevices.getUserMedia(pair[0] === "video" ? { video:{ deviceId:{ exact:deviceId } }, audio:false } : { audio:{ deviceId:{ exact:deviceId }, echoCancellation:true, noiseSuppression:true, autoGainControl:true }, video:false });
      const nextTrack = media.getTracks()[0];
      nextTrack.enabled = previous ? previous.enabled : true;
      watchLocalTrack(nextTrack);
      await state.rtcSession.replaceTrack(pair[0], nextTrack);
      if (document.querySelector(".social-call-page")) {
        if (pair[0] === "audio") { state.socialMicMuted = !nextTrack.enabled; updateSocialControl("audio", state.socialMicMuted); }
        if (pair[0] === "video") { state.socialVideoMuted = !nextTrack.enabled; updateSocialControl("video", state.socialVideoMuted); document.querySelector(".local-call-card")?.classList.toggle("camera-off", state.socialVideoMuted); }
      }
    } catch (error) { showToast("That device could not be selected.", true); }
  }
  const speaker = String(data.get("speakerDevice") || "");
  if (speaker) await Promise.all(Array.from(document.querySelectorAll(".rtc-tile video,.social-call-page video,.social-call-page audio")).map(function (media) { return typeof media.setSinkId === "function" ? media.setSinkId(speaker).catch(function () {}) : null; }));
  await state.rtcSession.updatePresence(roomPresence(state.joinDraft));
  closeModal();
  renderRoomGrid();
  showToast("Call devices updated.");
}

function enableCallPreviewDrag() {
  const preview = document.querySelector("[data-draggable-preview]");
  if (!preview) return;
  let drag = null;
  preview.addEventListener("pointerdown", function (event) {
    if (event.button !== undefined && event.button !== 0) return;
    const rect = preview.getBoundingClientRect();
    drag = { x:event.clientX, y:event.clientY, left:rect.left, top:rect.top };
    preview.style.left = rect.left + "px";
    preview.style.top = rect.top + "px";
    preview.style.right = "auto";
    preview.setPointerCapture(event.pointerId);
  });
  preview.addEventListener("pointermove", function (event) {
    if (!drag) return;
    const width = preview.offsetWidth;
    const height = preview.offsetHeight;
    preview.style.left = Math.max(8, Math.min(window.innerWidth - width - 8, drag.left + event.clientX - drag.x)) + "px";
    preview.style.top = Math.max(76, Math.min(window.innerHeight - height - 110, drag.top + event.clientY - drag.y)) + "px";
  });
  const end = function () { drag = null; };
  preview.addEventListener("pointerup", end);
  preview.addEventListener("pointercancel", end);
}

async function mountSocialCall(room, person, outgoing) {
  modalRoot.innerHTML = "";
  if (state.rtcSession) await state.rtcSession.stop({ notify:false });
  document.querySelector(".social-call-page")?.remove();
  state.activeRoom = room;
  state.activeDmCallId = room.dm_call_id;
  state.socialCallPerson = person || { display_name:"Study partner", avatar_color:"#7c6cff" };
  state.socialCallMode = room.call_mode || "video";
  state.socialCallConnected = false;
  state.socialCallStartedAt = null;
  state.socialMicMuted = false;
  state.socialVideoMuted = state.socialCallMode === "audio";
  state.callFacingMode = "user";
  const audioOnly = state.socialCallMode === "audio";
  const partner = state.socialCallPerson;
  const videoControls = audioOnly
    ? '<button id="socialVideoButton" class="social-control" data-social-command="upgradeVideo" aria-label="Turn on camera"><span>▣</span><small>Camera on</small></button><button class="social-control mobile-flip upgrade-only" data-social-command="toggleCamera" aria-label="Switch camera"><span>↻</span><small>Flip</small></button>'
    : '<button id="socialVideoButton" class="social-control" data-social-command="toggleVideo" aria-label="Turn camera off"><span>▣</span><small>Camera off</small></button><button class="social-control mobile-flip" data-social-command="toggleCamera" aria-label="Switch camera"><span>↻</span><small>Flip</small></button>';
  const audioVisual = '<div class="audio-call-visual"><div class="audio-pulse one"></div><div class="audio-pulse two"></div>' + avatarMarkup(partner, "social-call-avatar") + '<h1>' + esc(partner.display_name) + '</h1><p>' + (audioOnly ? 'Private audio call' : 'Waiting for video…') + '</p></div>';
  const mediaStage = '<div class="native-call-stage"><video id="remoteCallMedia" class="remote-call-video" autoplay playsinline></video><div class="remote-call-placeholder">' + audioVisual + '</div><div class="local-call-card" data-draggable-preview><video id="localCallVideo" autoplay muted playsinline></video><span>You · drag me</span></div></div>';
  app.insertAdjacentHTML("beforeend", '<section class="social-call-page native-call ' + (audioOnly ? 'audio-only' : 'video-call') + '">' + mediaStage + '<header class="social-call-top"><div class="social-call-identity">' + avatarMarkup(partner) + '<div><strong>' + esc(partner.display_name) + '</strong><span><i></i><b id="socialCallStatus">' + (outgoing ? 'Calling…' : 'Connecting…') + '</b><b id="socialCallTimer">00:00</b></span></div></div><div class="social-call-top-actions"><span class="social-call-private">⌁ Private</span><button class="call-help-button" data-call-help aria-label="Call help">?</button></div></header><button id="callSoundGate" class="call-sound-gate" data-call-play hidden>Tap to hear call</button><div class="social-call-safety">Browser-to-browser · Mellow Commons does not record this call</div><nav class="social-call-controls" aria-label="Call controls"><button id="socialMicButton" class="social-control" data-social-command="toggleAudio" aria-label="Mute microphone"><span>●</span><small>Mute</small></button>' + videoControls + '<button class="social-control" data-social-command="devices" aria-label="Call devices"><span>⚙</span><small>Devices</small></button><button class="social-control" data-social-fullscreen aria-label="Full screen"><span>⛶</span><small>Full screen</small></button><button class="social-control end" data-social-end aria-label="End call"><span>☎</span><small>End</small></button></nav><aside class="call-help-sheet" id="callHelpSheet" hidden><button data-close-call-help aria-label="Close call help">×</button><span class="eyebrow">Quick call check</span><h2>Camera or microphone not working?</h2><ol><li>Open the lock or camera icon beside the website address.</li><li>Allow camera and microphone access.</li><li>Make sure no other app is using the camera.</li><li>End this call and try once more.</li></ol><p>For the smoothest call, use current Chrome, Safari, or Edge on a stable connection.</p></aside></section>');
  enableCallPreviewDrag();
  await startNativeCallConnection(room, audioOnly, outgoing);
}

async function mountMeeting(room, isPrivate, joinOptions) {
  const options = joinOptions || state.joinDraft;
  if (!(await beginFocusVisit(room, isPrivate))) { state.view = "plus"; renderPlus(); return; }
  state.activeRoom = room;
  state.activeDmCallId = null;
  state.joinDraft = Object.assign({}, state.joinDraft, options);
  state.timerPreset = Math.min(240, Math.max(1, Number(options.duration || 50)));
  state.timerSeconds = state.timerPreset * 60;
  state.roomParticipants = [];
  state.roomPeerStates = {};
  state.roomChat = [];
  state.roomConnectedAt = Date.now();
  state.callFacingMode = "user";
  app.insertAdjacentHTML("beforeend", '<section class="meeting-page study-stream" data-frame="' + esc(state.meetingFrame) + '"><header class="meeting-head"><div class="stream-room-identity"><span class="stream-live"><i></i> Study stream</span><div><h3>' + esc(room.name || room.title) + '</h3><span id="meetingStatus">Opening your stream…</span></div></div><div class="stream-head-stats"><span><strong id="roomPeopleCount">1</strong> studying</span>' + (isPrivate ? '' : '<span class="stream-open-room">∞ Open room</span>') + '<span class="meeting-allowance" id="meetingAllowance">' + (isPrivate ? 'Invite-only room' : (state.focusAllowance.is_unlimited ? 'Unlimited today' : fmtMinutes(Math.ceil(Number(state.focusAllowance.remaining_seconds || 0) / 60)) + ' left today')) + '</span></div><button class="btn btn-sm stream-finish" data-leave-meeting>Finish session</button></header><main class="rtc-stage"><div class="rtc-grid" id="roomGrid" data-count="1"><div class="room-connecting"><span class="brand-spinner">' + brandLogo() + '</span><strong>Preparing your study stream</strong><small>Your camera and microphone remain under your control.</small></div></div><div class="stream-circle-note" id="roomCircleNotice" hidden aria-live="polite"><strong></strong><span></span></div><div class="room-celebration" id="roomCelebration" aria-live="polite"></div><aside class="room-drawer room-people-drawer" id="roomPeopleDrawer"><header><div><span class="eyebrow">In this room</span><h3>Study partners</h3></div><button data-room-command="people" aria-label="Close participants">×</button></header>' + (isPrivate ? '' : '<div class="room-people-intro"><strong>∞ No join limit</strong><span>Everyone appears here. Live video uses circles of up to six to keep devices smooth.</span></div>') + '<div id="roomPeopleList"></div></aside><aside class="room-drawer room-chat-drawer" id="roomChatDrawer"><header><div><span class="eyebrow">Quiet room chat</span><h3>Check in</h3></div><button data-room-command="chat" aria-label="Close chat">×</button></header><div class="room-chat-list" id="roomChatList"><div class="room-chat-empty">Share a short, study-related check-in.</div></div><form id="roomChatForm"><input name="message" maxlength="240" required placeholder="What are you working on?"><button aria-label="Send room message">↑</button></form></aside><span id="meetingSticker" class="meeting-sticker">' + stickerGlyph(state.meetingSticker) + '</span></main><div class="stream-focus-pill"><span>Now focusing on</span><strong>' + esc(options.intention || "Quiet focus") + '</strong><button data-room-command="timer"><b id="roomCountdown">' + formatTimer() + '</b><small>Pause</small></button></div><nav class="room-control-dock" aria-label="Study stream controls"><button data-room-command="audio" title="Microphone"><span>●</span><small>Mic</small></button><button data-room-command="video" title="Camera"><span>▣</span><small>Camera</small></button><button data-room-command="camera" title="Switch camera"><span>↻</span><small>Flip</small></button><button data-room-command="devices" title="Camera and audio devices"><span>⚙</span><small>Devices</small></button><button data-room-command="people" title="Participants"><span>◎</span><small>People</small></button><button data-room-command="chat" title="Room chat"><span>◌</span><small>Chat</small></button><button data-room-command="effects" title="Effects and decorations"><span>✦</span><small>Effects</small></button><button data-meeting-fullscreen title="Full screen"><span>⛶</span><small>Full</small></button><button class="leave" data-leave-meeting title="Leave session"><span>↪</span><small>Leave</small></button></nav></section>');
  const streamPage = document.querySelector(".study-stream");
  if (streamPage) streamPage.dataset.mirror = String(state.roomMirror);
  try {
    state.localCallStream = await acquireRoomStream(options);
    state.rtcClientId = crypto.randomUUID();
    const streamCircleSize = isPrivate ? Number(room.max_participants || 6) : PUBLIC_STREAM_CIRCLE_SIZE;
    state.rtcSession = new RealtimeWebRTCSession({
      supabase:supabase,
      authSession:state.session,
      topic:"study-room:" + (isPrivate ? "private" : "public") + ":" + room.id,
      clientId:state.rtcClientId,
      localStream:state.localCallStream,
      maxPeers:Math.max(1, streamCircleSize - 1),
      iceServers:await resolveIceServers(),
      presence:roomPresence(options),
      onParticipants:function (people) { state.roomParticipants = people; renderRoomGrid(); },
      onRemoteStream:function () { renderRoomGrid(); },
      onPeerState:function (peerId, status) {
        state.roomPeerStates[peerId] = status;
        renderRoomGrid();
        if (status === "failed") showToast("A study partner could not connect on this network. TURN relay support can improve restrictive networks.", true);
      },
      onEvent:handleRoomEvent,
      onStatus:function (status) {
        const label = document.querySelector("#meetingStatus");
        if (status === "SUBSCRIBED") {
          if (label) label.textContent = isPrivate ? "Private room · connected" : "Live · open room · no join limit";
          trackPresence(room, isPrivate);
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          if (label) label.textContent = "Connection interrupted";
          showToast("The secure room connection was interrupted. Rejoin the room to try again.", true);
        }
      }
    });
    renderRoomGrid();
    await state.rtcSession.start();
    startRoomTimer(true);
  } catch (error) {
    const grid = document.querySelector("#roomGrid");
    if (grid) grid.innerHTML = '<div class="meeting-error"><h2>Your study stream could not start</h2><p>' + esc(error.message) + '</p><button class="btn btn-primary" data-leave-meeting>Return to rooms</button></div>';
    if (state.focusVisitId) await endFocusVisit();
  }
}

function trackPresence(room, isPrivate) {
  if (state.presenceChannel) supabase.removeChannel(state.presenceChannel);
  state.presenceChannel = null;
  // Native private-room presence already lives on its authorized WebRTC channel.
  // The legacy public channel remains only for public lobby occupancy cards.
  if (isPrivate) return;
  const channelName = "presence:" + room.slug;
  state.presenceChannel = supabase.channel(channelName, { config:{ presence:{ key:state.user.id } } });
  state.presenceChannel.subscribe(async function (status) {
    if (status === "SUBSCRIBED") await state.presenceChannel.track({ user_id:state.user.id, display_name:state.profile.display_name, joined_at:new Date().toISOString() });
  });
}

async function leaveMeeting(endCall) {
  if (state.leavingMeeting) return;
  state.leavingMeeting = true;
  try {
    const dmCallId = state.activeDmCallId;
    if (state.rtcSession && dmCallId && endCall !== false) await state.rtcSession.sendEvent("hangup", { call_id:dmCallId });
    state.activeDmCallId = null;
    clearInterval(state.socialCallTimerId);
    clearInterval(state.roomTimerId);
    state.socialCallTimerId = null;
    state.socialCallStartedAt = null;
    state.socialCallConnected = false;
    state.socialCallPerson = null;
    state.socialCallMode = null;
    state.roomTimerId = null;
    state.roomParticipants = [];
    state.roomPeerStates = {};
    state.roomChat = [];
    if (state.presenceChannel) { await state.presenceChannel.untrack(); await supabase.removeChannel(state.presenceChannel); state.presenceChannel = null; }
    if (state.rtcSession) {
      const rtc = state.rtcSession;
      state.rtcSession = null;
      await rtc.stop({ notify:true });
    }
    if (state.localCallStream) state.localCallStream.getTracks().forEach(function (track) { track.stop(); });
    if (state.remoteCallStream) state.remoteCallStream.getTracks().forEach(function (track) { track.stop(); });
    state.localCallStream = null;
    state.remoteCallStream = null;
    state.activeRoom = null;
    state.rtcClientId = null;
    state.roomConnectedAt = null;
    document.querySelector(".meeting-page")?.remove();
    document.querySelector(".social-call-page")?.remove();
    if (document.fullscreenElement) await document.exitFullscreen().catch(function () {});
    if (state.focusVisitId) await endFocusVisit();
    if (dmCallId && endCall !== false) {
      const result = await supabase.rpc("end_dm_call", { p_call_id:dmCallId });
      if (result.error) showToast(result.error.message, true);
      if (state.activeConversationId) await loadDmCalls(state.activeConversationId);
      if (state.view === "messages") renderMessages();
    }
  } finally {
    state.leavingMeeting = false;
  }
}

async function sendEncouragement(userId, kind) {
  if (kind === "focus_boost" && !["plus", "premium", "buddy"].includes(state.allowance.plan)) { state.view = "plus"; renderPlus(); return showToast("Focus Boosts are included with Premium and Buddy."); }
  showModal(kind === "focus_boost" ? "Send a Focus Boost" : "Send encouragement", '<form id="encouragementForm" class="form"><input type="hidden" name="receiver" value="' + esc(userId) + '"><input type="hidden" name="kind" value="' + kind + '"><div class="field"><label>Supportive message</label><textarea name="message" maxlength="160" placeholder="You’re doing great — keep going!"></textarea></div><button class="btn btn-primary">Send</button></form>');
}

async function submitEncouragement(form) {
  const data = new FormData(form);
  const receiverId = String(data.get("receiver") || "");
  const kind = String(data.get("kind") || "encouragement");
  const message = String(data.get("message") || "");
  const result = await supabase.rpc("send_encouragement", { p_receiver_id:receiverId, p_kind:kind, p_message:message });
  if (result.error) return showToast(result.error.message, true);
  closeModal();
  const allowance = await supabase.rpc("get_weekly_allowance");
  if (allowance.data && allowance.data[0]) state.allowance = allowance.data[0];
  if (kind === "focus_boost" && state.rtcSession && document.querySelector(".study-stream")) {
    await state.rtcSession.sendEvent("boost", { receiver_id:receiverId, sender_name:state.profile.display_name, message:message });
  }
  showToast(kind === "focus_boost" ? "Focus Boost sent live ✦" : "Encouragement sent.");
  if (!document.querySelector(".meeting-page,.social-call-page")) renderEncouragements();
}

async function createPrivateRoom(form) {
  const data = new FormData(form);
  const result = await supabase.rpc("create_private_room", { p_title:data.get("title"), p_call_mode:data.get("mode") });
  if (result.error) return showToast(result.error.message, true);
  await loadPrivateRooms(); renderPrivate(); showToast("Private room created.");
}

async function joinPrivateRoom(id) {
  const room = state.privateRooms.find(function (r) { return r.id === id; });
  if (room) showJoinLobby(room, true);
}

async function copyInvite(token) {
  const url = location.origin + location.pathname + "?invite=" + token;
  await navigator.clipboard.writeText(url);
  showToast("Private invite copied.");
}

async function saveProfile(form, privacyOnly) {
  const data = new FormData(form);
  let update;
  if (privacyOnly) {
    update = { show_profile:data.has("show_profile"), show_country:data.has("show_country"), allow_invites:data.has("allow_invites"), accepting_dms:data.has("accepting_dms"), accepting_encouragements:data.has("accepting_encouragements") };
  } else {
    update = { display_name:String(data.get("display_name")).trim(), subject:String(data.get("subject")).trim(), bio:String(data.get("bio")).trim(), country:String(data.get("country")).trim(), avatar_color:data.get("avatar_color"), profile_banner:safeBanner(data.get("profile_banner")), profile_frame:data.get("profile_frame") || "none", profile_sticker:data.get("profile_sticker") || "" };
  }
  const result = await supabase.from("profiles").update(update).eq("id", state.user.id).select().single();
  if (result.error) return showToast(result.error.message, true);
  state.profile = result.data; showToast("Settings saved."); renderApp();
}

function saveStudyPreferences(form) {
  const data = new FormData(form);
  state.preferences = {
    defaultDuration:Math.min(240, Math.max(1, Number(data.get("defaultDuration") || 50))),
    defaultRoom:String(data.get("defaultRoom") || "deep-focus"),
    defaultCamera:data.has("defaultCamera"),
    defaultMicrophone:data.has("defaultMicrophone"),
    soundCues:data.has("soundCues"),
    compactMode:data.has("compactMode")
  };
  state.joinDraft.duration = state.preferences.defaultDuration;
  state.joinDraft.camera = state.preferences.defaultCamera;
  state.joinDraft.microphone = state.preferences.defaultMicrophone;
  localStorage.setItem("mellow-commons-study-preferences", JSON.stringify(state.preferences));
  document.documentElement.classList.toggle("compact-mode", state.preferences.compactMode);
  showToast("Study preferences saved.");
  renderSettings();
}

async function saveAdminEntitlement(userId) {
  const select = Array.from(document.querySelectorAll("[data-admin-plan-for]")).find(function (element) {
    return element.dataset.adminPlanFor === userId;
  });
  if (!select) return;
  const result = await supabase.rpc("admin_set_entitlement", {
    p_user_id:userId,
    p_tier:select.value,
    p_expires_at:null,
    p_reason:"Granted from the Mellow Commons admin center"
  });
  if (result.error) return showToast(result.error.message, true);
  await loadAdminData(state.adminSearch);
  showToast(select.value === "free" ? "Complimentary access removed." : planLabel(select.value) + " access granted.");
  renderAdmin();
}

async function updateAdminReport(reportId, status) {
  const result = await supabase.rpc("admin_update_report", {
    p_report_id:reportId,
    p_status:status,
    p_note:"Updated from the Mellow Commons admin center"
  });
  if (result.error) return showToast(result.error.message, true);
  await loadAdminData(state.adminSearch);
  showToast("Report marked " + status + ".");
  renderAdmin();
}

async function setAdminRoomActive(roomId, active) {
  const result = await supabase.rpc("admin_set_room_active", {
    p_room_id:roomId,
    p_active:active
  });
  if (result.error) return showToast(result.error.message, true);
  await Promise.all([loadAdminData(state.adminSearch), loadPublicRooms()]);
  showToast(active ? "Room opened." : "Room closed.");
  renderAdmin();
}

async function searchAdminMembers(form) {
  const data = new FormData(form);
  state.adminSearch = String(data.get("search") || "").trim();
  const result = await supabase.rpc("admin_list_members", { p_search:state.adminSearch, p_limit:50 });
  if (result.error) return showToast(result.error.message, true);
  state.adminMembers = result.data || [];
  renderAdmin();
}

function checkout(interval) {
  const url = CHECKOUT_URLS[interval];
  if (!url) {
    const labels = { basic_month:"Basic · $1.99 monthly", premium_month:"Premium · $6.99 monthly", premium_year:"Premium · $69.96 yearly ($5.83/month)", buddy_month:"Buddy · $12.99 monthly" };
    showModal("Checkout is being connected", '<p>The new membership prices are set. Payment collection stays disabled until the matching Stripe recurring prices and verified business profile are connected.</p><p>When activated, Stripe Checkout can show Apple Pay automatically on eligible Apple devices.</p><div class="card"><strong>Selected plan</strong><p>' + esc(labels[interval] || "Membership") + '</p></div><button class="btn btn-primary" data-close-modal>Got it</button>');
    return;
  }
  location.href = url;
}

function showPrivacy() {
  showModal("Mellow Commons privacy summary", '<div class="article-body"><h3>Your account data</h3><p>Mellow Commons stores your account, profile, goals, sessions, plan status, privacy choices, and encouragement activity in Supabase. Row-level rules limit personal data to the correct account.</p><h3>Calls and study streams</h3><p>Direct calls and study-room media use native browser WebRTC. Supabase carries short-lived connection messages only for authorized room members; Mellow Commons does not record or store call audio or video.</p><h3>Private rooms</h3><p>Private-room invites are unguessable, membership is enforced on the server, and rooms expire after 24 hours. Do not share an invite publicly.</p><h3>Payments</h3><p>When enabled, Stripe processes card and Apple Pay details. Mellow Commons stores subscription status but never stores full payment-card details.</p></div>', true);
}

function showBlog(id) {
  const post = blogs.find(function (item) { return item.id === id; });
  if (post) showModal(post.title, '<div class="article-body"><span class="eyebrow">' + post.tag + '</span>' + post.body + '</div>', true);
}

function stopAmbient() {
  if (state.audio) {
    try { state.audio.source.stop(); state.audio.context.close(); } catch (e) {}
    state.audio = null;
  }
}

function setAmbient(kind) {
  stopAmbient(); state.ambient = kind;
  if (kind !== "none") {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const context = new AudioCtx();
    const seconds = 3;
    const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i += 1) {
      const white = Math.random() * 2 - 1;
      if (kind === "rain") data[i] = white * .22;
      else if (kind === "cafe") { last = (last + .035 * white) / 1.035; data[i] = last * 3.2; }
      else { const crack = Math.random() > .998 ? Math.random() * .9 : 0; last = last * .92 + white * .03; data[i] = last + crack; }
    }
    const source = context.createBufferSource(); source.buffer = buffer; source.loop = true;
    const gain = context.createGain(); gain.gain.value = kind === "rain" ? .15 : .11;
    source.connect(gain).connect(context.destination); source.start();
    state.audio = { context:context, source:source };
  }
  if (!document.querySelector(".meeting-page,.social-call-page")) renderApp();
}

document.addEventListener("click", async function (event) {
  if (event.target.matches("[data-close-modal]")) return closeModal();
  const target = event.target.closest("button,a,article");
  if (!target) return;
  if (target.matches("[data-close-modal]")) return closeModal();
  if (target.dataset.publicHome !== undefined) { event.preventDefault(); state.session ? (state.view = "home", renderApp()) : renderLanding(); }
  if (target.dataset.auth) { state.authMode = target.dataset.auth; renderAuth(); }
  if (target.dataset.authTab) { state.authMode = target.dataset.authTab; renderAuth(); }
  if (target.dataset.googleAuth !== undefined) await signInWithGoogle();
  if (target.dataset.passwordToggle !== undefined) { const field = document.querySelector("#password"); if (field) { field.type = field.type === "password" ? "text" : "password"; target.textContent = field.type === "password" ? "Show" : "Hide"; } }
  if (target.dataset.forgotPassword !== undefined) showPasswordReset();
  if (target.dataset.openResend !== undefined) showModal("Resend verification", '<form id="resendForm" class="form"><div class="field"><label for="resendEmail">Account email</label><input id="resendEmail" name="email" type="email" required autocomplete="email" placeholder="you@example.com"></div><button class="btn btn-primary">Send a fresh link</button></form>');
  if (target.dataset.resendEmail !== undefined) await resendVerification();
  if (target.dataset.toggleAccount !== undefined) { state.accountMenuOpen = !state.accountMenuOpen; state.chatMenuOpen = false; renderApp(); }
  if (target.dataset.toggleChat !== undefined) { state.chatMenuOpen = !state.chatMenuOpen; state.accountMenuOpen = false; renderApp(); }
  if (target.dataset.view) { state.view = target.dataset.view; state.mobileNav = false; state.accountMenuOpen = false; state.chatMenuOpen = false; renderApp(); }
  if (target.dataset.channel) { state.activeChannelId = target.dataset.channel; await loadChannelMessages(state.activeChannelId); renderCommunity(); }
  if (target.dataset.channelSlug) { const channel = state.communityChannels.find(function (item) { return item.slug === target.dataset.channelSlug; }); if (channel) { state.activeChannelId = channel.id; state.view = "community"; state.chatMenuOpen = false; await loadChannelMessages(channel.id); renderCommunity(); } }
  if (target.dataset.newBuddy !== undefined) showBuddyComposer();
  if (target.dataset.closeBuddy) await closeBuddy(target.dataset.closeBuddy);
  if (target.dataset.newFeedback !== undefined) showFeedbackComposer();
  if (target.dataset.feedbackVote) await voteFeedback(target.dataset.feedbackVote);
  if (target.dataset.feedbackSort) { state.feedbackSort = target.dataset.feedbackSort; await refreshFeedback(); renderFeedback(); }
  if (target.dataset.feedbackCategory) { state.feedbackCategory = target.dataset.feedbackCategory; await refreshFeedback(); renderFeedback(); }
  if (target.dataset.profileTab) { state.profileTab = target.dataset.profileTab; renderMemberProfile(); }
  if (target.dataset.memberProfile) await openMemberProfile(target.dataset.memberProfile);
  if (target.dataset.profileBack !== undefined) { state.view = state.profileReturnView || "encouragements"; state.memberProfile = null; renderApp(); }
  if (target.dataset.pinMember) await togglePin(target.dataset.pinMember, true);
  if (target.dataset.unpinMember) await togglePin(target.dataset.unpinMember, false);
  if (target.dataset.messageMember) await startConversation(target.dataset.messageMember);
  if (target.dataset.conversation) await openConversation(target.dataset.conversation);
  if (target.dataset.acceptDm) await acceptConversation(target.dataset.acceptDm);
  if (target.dataset.startDmCall) await startDmCallSetup(target.dataset.startDmCall);
  if (target.dataset.answerDmCall) await answerDmCall(target.dataset.answerDmCall, true);
  if (target.dataset.declineDmCall) await answerDmCall(target.dataset.declineDmCall, false);
  if (target.dataset.joinDmCall) await joinDmCall(target.dataset.joinDmCall);
  if (target.dataset.endDmCall) await endDmCall(target.dataset.endDmCall);
  if (target.dataset.recordVoice !== undefined) await toggleVoiceRecording();
  if (target.dataset.messageOptions) { state.messageMenuId = state.messageMenuId === target.dataset.messageOptions ? null : target.dataset.messageOptions; renderMessages(); }
  if (target.dataset.messageReaction) await toggleMessageReaction(target.dataset.messageReaction, target.dataset.emoji);
  if (target.dataset.copyMessage) await copyDmMessage(target.dataset.copyMessage);
  if (target.dataset.toggleMessageEmoji !== undefined) { state.messageEmojiOpen = !state.messageEmojiOpen; renderMessages(); }
  if (target.dataset.insertEmoji) {
    const input = document.querySelector('#dmForm textarea[name="message"]');
    if (input) { input.value += target.dataset.insertEmoji; state.messageDraft = input.value; input.focus(); }
    state.messageEmojiOpen = false;
    document.querySelector(".composer-emoji-picker")?.setAttribute("hidden", "");
  }
  if (target.dataset.profileOptions) showReportModal(target.dataset.profileOptions, null);
  if (target.dataset.reportMessage) showReportModal(target.dataset.reportUser, target.dataset.reportMessage);
  if (target.dataset.blockMember) await blockMember(target.dataset.blockMember);
  if (target.dataset.adminSavePlan) await saveAdminEntitlement(target.dataset.adminSavePlan);
  if (target.dataset.adminReport && target.dataset.reportStatus) await updateAdminReport(target.dataset.adminReport, target.dataset.reportStatus);
  if (target.dataset.adminRoom) await setAdminRoomActive(target.dataset.adminRoom, target.dataset.roomActive === "true");
  if (target.dataset.adminRefresh !== undefined) { await loadAdminData(state.adminSearch); renderAdmin(); showToast("Admin data refreshed."); }
  if (target.dataset.removeAvatar !== undefined) await removeAvatar();
  if (target.dataset.joinRoom) await joinPublicRoom(target.dataset.joinRoom);
  if (target.dataset.checkDevices !== undefined) await checkDevices();
  if (target.dataset.leaveMeeting !== undefined) await leaveMeeting();
  if (target.dataset.socialCommand) await runSocialCallCommand(target.dataset.socialCommand);
  if (target.dataset.socialFullscreen !== undefined) {
    const page = document.querySelector(".social-call-page");
    if (page) {
      if (document.fullscreenElement) await document.exitFullscreen().catch(function () {});
      else await page.requestFullscreen().catch(function () { showToast("Full screen is unavailable in this browser.", true); });
    }
  }
  if (target.dataset.socialEnd !== undefined) await leaveMeeting();
  if (target.dataset.callPlay !== undefined) await playRemoteCallMedia();
  if (target.dataset.callHelp !== undefined) document.querySelector("#callHelpSheet")?.removeAttribute("hidden");
  if (target.dataset.closeCallHelp !== undefined) document.querySelector("#callHelpSheet")?.setAttribute("hidden", "");
  if (target.dataset.celebrateAchievement) showAchievementCelebration(target.dataset.celebrateAchievement);
  if (target.dataset.roomCommand) await runRoomCommand(target.dataset.roomCommand);
  if (target.dataset.roomBoost) await sendEncouragement(target.dataset.roomBoost, "focus_boost");
  if (target.dataset.meetingFullscreen !== undefined) { const page = document.querySelector(".meeting-page"); if (page) { if (document.fullscreenElement) document.exitFullscreen(); else page.requestFullscreen(); } }
  if (target.dataset.meetingDecorate !== undefined) showMeetingDecorations();
  if (target.dataset.goalDelete) await deleteGoal(target.dataset.goalDelete);
  if (target.dataset.timerPreset) setTimerPreset(Number(target.dataset.timerPreset));
  if (target.dataset.customTimer !== undefined) showCustomTimer();
  if (target.dataset.timerToggle !== undefined) toggleTimer();
  if (target.dataset.timerReset !== undefined) resetTimer();
  if (target.dataset.encourage) await sendEncouragement(target.dataset.encourage, "encouragement");
  if (target.dataset.boost) await sendEncouragement(target.dataset.boost, "focus_boost");
  if (target.dataset.joinPrivate) await joinPrivateRoom(target.dataset.joinPrivate);
  if (target.dataset.copyInvite) await copyInvite(target.dataset.copyInvite);
  if (target.dataset.checkout) checkout(target.dataset.checkout);
  if (target.dataset.blog) showBlog(target.dataset.blog);
  if (target.dataset.privacy !== undefined) showPrivacy();
  if (target.dataset.themeToggle !== undefined) setTheme(state.theme === "dark" ? "light" : "dark");
  if (target.dataset.theme) setTheme(target.dataset.theme);
  if (target.dataset.ambient) setAmbient(target.dataset.ambient);
  if (target.dataset.toggleNav !== undefined) {
    if (window.matchMedia("(max-width: 760px)").matches) state.mobileNav = !state.mobileNav;
    else {
      state.navCollapsed = !state.navCollapsed;
      localStorage.setItem("mellow-nav-collapsed", String(state.navCollapsed));
    }
    renderApp();
  }
  if (target.dataset.signout !== undefined) await supabase.auth.signOut();
});

document.addEventListener("change", async function (event) {
  if (event.target.dataset.goalToggle) await toggleGoal(event.target.dataset.goalToggle, event.target.checked);
  if (event.target.dataset.mediaToggle) togglePreviewTrack(event.target.dataset.mediaToggle, event.target.checked);
  if (event.target.id === "avatarUpload") { await uploadAvatar(event.target.files && event.target.files[0]); event.target.value = ""; }
  if (event.target.id === "dmMediaInput") { await uploadDmAttachment(event.target.files && event.target.files[0], "image"); event.target.value = ""; }
  if (event.target.dataset.buddySearch !== undefined) { state.buddySearch = event.target.value; renderBuddies(); }
  if (event.target.dataset.feedbackSearch !== undefined) { state.feedbackSearch = event.target.value; await refreshFeedback(); renderFeedback(); }
});

document.addEventListener("input", function (event) {
  if (event.target.dataset.messageDraft !== undefined) state.messageDraft = event.target.value;
});

document.addEventListener("submit", async function (event) {
  event.preventDefault();
  const form = event.target;
  if (form.id === "authForm") await handleAuthSubmit(form);
  if (form.id === "resendForm") { const data = new FormData(form); await resendVerification(data.get("email")); }
  if (form.id === "passwordResetForm") await requestPasswordReset(form);
  if (form.id === "newPasswordForm") await updatePassword(form);
  if (form.id === "channelMessageForm") await sendChannelMessage(form);
  if (form.id === "feedbackForm") await submitFeedback(form);
  if (form.id === "buddyForm") await submitBuddy(form);
  if (form.id === "meetingDecorForm") saveMeetingDecorations(form);
  if (form.id === "customTimerForm") { const data = new FormData(form); setTimerPreset(data.get("minutes")); closeModal(); showToast("Custom timer set to " + state.timerPreset + " minutes."); }
  if (form.id === "roomDeviceForm") await applyRoomDevices(form);
  if (form.id === "roomChatForm") {
    const data = new FormData(form);
    const body = String(data.get("message") || "").trim();
    if (body && state.rtcSession) {
      const message = { body:body, display_name:state.profile.display_name, user_id:state.user.id, at:new Date().toISOString() };
      appendRoomChat(message, true);
      await state.rtcSession.sendEvent("room-chat", message);
      form.reset();
    }
  }
  if (form.id === "quickSessionForm") {
    const data = new FormData(form);
    state.joinDraft.intention = String(data.get("intention") || "").trim();
    state.joinDraft.duration = Math.min(240, Math.max(1, Number(data.get("duration") || 50)));
    const preferredRoom = state.rooms.find(function (room) { return room.slug === state.preferences.defaultRoom; }) || state.rooms[0];
    if (preferredRoom) showJoinLobby(preferredRoom, false);
  }
  if (form.id === "joinLobbyForm") {
    const data = new FormData(form);
    let room = state.pendingRoom;
    const isPrivate = state.pendingPrivate;
    const dmStart = state.pendingDmStart;
    state.joinDraft = {
      intention:String(data.get("intention") || "").trim(),
      duration:Math.min(240, Math.max(1, Number(data.get("duration") || 50))),
      camera:data.has("camera"),
      microphone:data.has("microphone"),
      cameraDeviceId:String(data.get("cameraDevice") || ""),
      microphoneDeviceId:String(data.get("microphoneDevice") || "")
    };
    stopDevicePreview();
    modalRoot.innerHTML = "";
    state.pendingRoom = null;
    state.pendingPrivate = false;
    state.pendingDmStart = null;
    if (dmStart) room = await createDmCall(dmStart);
    if (room) await mountMeeting(room, isPrivate, state.joinDraft);
  }
  if (form.id === "goalForm") { const data = new FormData(form); await saveGoal(String(data.get("title")).trim()); }
  if (form.id === "encouragementForm") await submitEncouragement(form);
  if (form.id === "dmForm") await submitDm(form);
  if (form.id === "reportMemberForm") await submitMemberReport(form);
  if (form.id === "privateRoomForm") await createPrivateRoom(form);
  if (form.id === "profileForm") await saveProfile(form, false);
  if (form.id === "privacyForm") await saveProfile(form, true);
  if (form.id === "studyPreferencesForm") saveStudyPreferences(form);
  if (form.id === "adminSearchForm") await searchAdminMembers(form);
});

window.addEventListener("beforeunload", function () {
  if (state.presenceChannel) state.presenceChannel.untrack();
  if (state.dmChannel) supabase.removeChannel(state.dmChannel);
  if (state.dmCallChannel) supabase.removeChannel(state.dmCallChannel);
  if (state.communityChannel) supabase.removeChannel(state.communityChannel);
  if (state.rtcSession) {
    if (state.activeDmCallId) state.rtcSession.sendEvent("hangup", { call_id:state.activeDmCallId });
    state.rtcSession.stop({ notify:true });
  }
  if (state.activeDmCallId) supabase.rpc("end_dm_call", { p_call_id:state.activeDmCallId });
  if (state.localCallStream) state.localCallStream.getTracks().forEach(function (track) { track.stop(); });
  if (state.focusVisitId) supabase.rpc("end_focus_room_visit", { p_visit_id:state.focusVisitId });
  if (state.voiceStream) state.voiceStream.getTracks().forEach(function (track) { track.stop(); });
  stopAmbient();
});

window.addEventListener("online", function () { if (state.focusVisitId) heartbeatFocusVisit(); });
document.addEventListener("visibilitychange", function () {
  if (document.visibilityState === "visible" && state.focusVisitId) heartbeatFocusVisit();
});

async function init() {
  document.documentElement.classList.toggle("compact-mode", state.preferences.compactMode);
  await loadPublicRooms();
  const current = await supabase.auth.getSession();
  state.session = current.data.session;
  state.user = state.session && state.session.user;
  if (state.session) await loadUserData();
  renderApp();
  if (state.session) { subscribeToDmCalls(); notifyNextIncomingCall(); }
  supabase.auth.onAuthStateChange(function (event, session) {
    setTimeout(async function () {
      if (event === "PASSWORD_RECOVERY") { state.session = session; state.user = session && session.user; showNewPassword(); return; }
      state.session = session; state.user = session && session.user;
      if (session) { await loadUserData(); state.view = "home"; }
      else {
        if (state.dmChannel) { await supabase.removeChannel(state.dmChannel); state.dmChannel = null; }
        if (state.dmCallChannel) { await supabase.removeChannel(state.dmCallChannel); state.dmCallChannel = null; }
        if (state.communityChannel) { await supabase.removeChannel(state.communityChannel); state.communityChannel = null; }
        state.profile = null; state.memberProfile = null; state.memberInsights = null; state.conversations = []; state.messages = []; state.dmCalls = []; state.pendingDmCalls = []; state.activeDmCallId = null; state.communityChannels = []; state.channelMessages = []; state.feedbackPosts = []; state.buddyPosts = []; state.admin = null; state.adminStats = null; state.adminMembers = []; state.adminReports = []; state.adminRooms = []; state.view = "home";
      }
      renderApp();
      if (session) { subscribeToDmCalls(); notifyNextIncomingCall(); }
    }, 0);
  });
}

init().catch(function (error) {
  console.error(error);
  app.innerHTML = baseBackground() + '<main class="auth-shell"><section class="card auth-card"><h1>Mellow Commons could not start</h1><p>' + esc(error.message) + '</p><button class="btn btn-primary" onclick="location.reload()">Try again</button></section></main>';
});
