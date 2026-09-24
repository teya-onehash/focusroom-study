import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.1/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, CHECKOUT_URLS } from "./config.js?v=20260924-7";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const app = document.querySelector("#app");
const modalRoot = document.querySelector("#modalRoot");
const toastEl = document.querySelector("#toast");
const savedPreferences = (function () {
  try { return JSON.parse(localStorage.getItem("focusroom-study-preferences") || "{}"); }
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
  encouragements: [],
  members: [],
  privateRooms: [],
  roomCounts: {},
  channels: [],
  presenceChannel: null,
  view: "home",
  activeRoom: null,
  jitsi: null,
  previewStream: null,
  previewAudioContext: null,
  previewAnimation: null,
  pendingRoom: null,
  pendingPrivate: false,
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
  mobileNav: false
};

const blogs = [
  {
    id: "body-doubling",
    tag: "Focus science",
    title: "Why studying beside someone can make starting easier",
    excerpt: "Body doubling adds gentle social structure without turning focus into a competition.",
    body: "<p>Body doubling means doing your own work while another person is present and working too. You are not expected to collaborate. The value is the quiet sense that someone else has also chosen to begin.</p><h3>Make the room work for you</h3><p>Choose one clear task before you join. Keep your microphone muted, put distractions out of reach, and use the first minute to write a tiny finish line: one page, ten questions, or twenty-five focused minutes.</p><h3>Camera choice and comfort</h3><p>Your camera is always your choice. A desk view, virtual background, or camera-off session can still provide structure. FocusRoom starts calls muted and with video off so you decide what to share.</p>"
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
  localStorage.setItem("focusroom-theme", state.theme);
  renderApp();
}

function publicHeader() {
  return '<header class="topbar"><a class="brand" href="#" data-public-home><span class="brand-mark"></span>FocusRoom</a><nav class="top-links"><a href="#rooms">Rooms</a><a href="#features">Features</a><a href="#pricing">Plans</a><a href="#journal">Journal</a>' + themeToggle() + '<button class="btn btn-sm" data-auth="login">Log in</button><button class="btn btn-primary btn-sm" data-auth="signup">Join free</button></nav></header>';
}

function roomCards(publicMode) {
  if (!state.rooms.length) return '<div class="skeleton"></div><div class="skeleton"></div>';
  return state.rooms.map(function (room) {
    const count = state.roomCounts[room.slug] || 0;
    return '<article class="card room-card"><div class="room-icon">' + esc(room.icon) + '</div><div><div class="room-title-line"><h3>' + esc(room.name) + '</h3><span class="room-mode">' + (room.slug === "study-cafe" ? "Social breaks" : "Quiet focus") + '</span></div><p>' + esc(room.description) + '</p><div class="live-dot"><span data-room-count="' + esc(room.slug) + '">' + count + '</span> connected now</div></div><button class="btn btn-sm ' + (publicMode ? '' : 'btn-primary') + '" data-join-room="' + esc(room.id) + '">' + (publicMode ? 'Preview' : 'Set up & join') + '</button></article>';
  }).join("");
}

function pricingCards() {
  const plans = [
    { key: "free", name: "Free", price: "$0", unit: "forever", note: "Start here", perks:["Unlimited public focus rooms","Timer, goals, history, and ambience","Text, image, and voice-note DMs","Up to 500 messages per day","30 encouragements per day"] },
    { key: "basic_month", name: "Basic", price: "$1.99", unit: "/ month", note: "More community", perks:["Everything in Free","Up to 1,000 messages per day","60 encouragements per day","Save up to 20 favorite study partners","Full access to student channels"] },
    { key: "premium_month", name: "Premium", price: "$6.99", unit: "/ month", note: "Recommended", popular:true, annual:true, perks:["Everything in Basic","Start private audio or video calls from DMs","Host invite-only rooms for up to 6 people","Up to 2,000 messages and 300 encouragements daily","Priority favorites and Premium badge"] },
    { key: "buddy_month", name: "Buddy", price: "$12.99", unit: "/ month", note: "For two", perks:["Premium for you and one friend","Separate private accounts and histories","Private audio and video calls","Shared study-circle access","One subscription manages both seats"] }
  ];
  return plans.map(function (plan) {
    return '<article class="card price-card' + (plan.popular ? ' popular' : '') + '">' +
      (plan.popular ? '<span class="popular-tag">Recommended</span>' : '') +
      '<span class="eyebrow">' + plan.note + '</span><h3>' + plan.name + '</h3><div class="price">' + plan.price + '<small>' + plan.unit + '</small></div>' +
      (plan.annual ? '<div class="annual-note"><strong>$5.83/month</strong> when billed yearly at $69.96</div>' : '') +
      '<ul class="perk-list">' + plan.perks.map(function (perk) { return '<li>' + perk + '</li>'; }).join("") + '</ul>' +
      (plan.key === "free" ? '<button class="btn" ' + (state.session ? 'data-view="rooms"' : 'data-auth="signup"') + '>Use FocusRoom free</button>' : '<button class="btn btn-primary" data-checkout="' + plan.key + '">Choose ' + plan.name + '</button>' + (plan.annual ? '<button class="btn btn-sm annual-button" data-checkout="premium_year">Choose annual Premium</button>' : '')) +
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
  const previewRooms = state.rooms.slice(0, 3).map(function (room, index) {
    return '<div class="preview-room"><span class="room-icon">' + esc(room.icon) + '</span><div><strong>' + esc(room.name) + '</strong><small><span data-room-count="' + esc(room.slug) + '">' + (state.roomCounts[room.slug] || 0) + '</span> connected</small></div><span class="preview-status">' + (index === 0 ? '50/10' : index === 1 ? 'Open' : 'Exam') + '</span></div>';
  }).join("");
  app.innerHTML = baseBackground() + '<div class="landing">' + publicHeader() +
    '<main><section class="hero"><div class="hero-copy"><span class="eyebrow">Live focus rooms · free to join</span><h1><span class="gradient-text">Open a room.</span><br>Start the work.</h1><p>Choose what you are working on, test your camera and microphone, and focus beside other students in an always-open study space.</p><div class="hero-actions"><button class="btn btn-primary" data-auth="signup">Create a free account</button><a class="btn" href="#rooms">See the live rooms</a></div><div class="trust-row"><span>Device check before joining</span><span>Camera always optional</span><span>Real live counts</span></div></div>' +
    '<div class="hero-visual product-preview" aria-label="FocusRoom product preview"><div class="preview-top"><div><span class="eyebrow">Live focus floor</span><h2>Choose your room</h2></div><span class="online-pill"><i></i>' + totalOnline + ' online</span></div><div class="preview-intention"><span>Today’s intention</span><strong>Finish one clear task</strong><div class="preview-progress"><i></i></div></div><div class="preview-room-list">' + (previewRooms || '<div class="skeleton"></div>') + '</div><div class="preview-footer"><span>25</span><span class="active">50</span><span>90 min</span><button class="btn btn-primary btn-sm" data-auth="signup">Start session</button></div></div></section>' +
    '<section class="section" id="rooms"><div class="section-head"><div><span class="eyebrow">Live rooms</span><h2>Find your focus atmosphere</h2></div><p>Every number is based on people actually connected to a room. Sign in to join with camera and microphone controls.</p></div><div class="room-grid">' + roomCards(true) + '</div></section>' +
    '<section class="section session-steps"><div class="section-head"><div><span class="eyebrow">A real session, not another feed</span><h2>From intention to finished work</h2></div></div><div class="grid-3"><article class="card step-card"><span>01</span><h3>Name the task</h3><p>Write one concrete intention and choose a 25, 50, or 90 minute block.</p></article><article class="card step-card"><span>02</span><h3>Check your setup</h3><p>Preview video, confirm microphone activity, and choose the exact devices you want.</p></article><article class="card step-card"><span>03</span><h3>Focus with others</h3><p>Join muted or camera-off, use the timer, and save finished sessions to your history.</p></article></div></section>' +
    '<section class="section" id="features"><div class="section-head"><div><span class="eyebrow">Made for momentum</span><h2>More than a video call</h2></div></div><div class="bento"><article class="card feature-card"><div class="feature-icon">◷</div><div><h3>Focus timer and goals</h3><p>Choose 25 or 50 minutes, write the next task, and save completed sessions to your history.</p></div></article><article class="card feature-card"><div class="feature-icon">♡</div><div><h3>Real encouragement</h3><p>Send a thoughtful nudge to someone who is showing up. Free members receive 5 sends each week.</p></div></article><article class="card feature-card"><div class="feature-icon">☾</div><div><h3>Cozy ambience</h3><p>Use generated rain, café, or fireside sound without opening another distracting tab.</p></div></article></div></section>' +
    '<section class="section" id="pricing"><div class="section-head"><div><span class="eyebrow">Simple student pricing</span><h2>Free for focus. Upgrade for connection.</h2></div><p>Public rooms and core study tools stay free. Private audio and video calls are reserved for Premium and Buddy.</p></div><div class="pricing-grid pricing-four">' + pricingCards() + '</div></section>' +
    '<section class="section" id="journal"><div class="section-head"><div><span class="eyebrow">Focus journal</span><h2>Small ideas that help</h2></div></div><div class="grid-3">' + blogCards() + '</div></section></main>' +
    '<footer class="footer"><div><div class="brand"><span class="brand-mark"></span>FocusRoom</div><p>Study together without the pressure.</p></div><div><button class="btn btn-sm" data-privacy>Privacy</button> <button class="btn btn-sm" data-auth="login">Member login</button></div></footer></div>';
}

function renderAuth() {
  const signup = state.authMode === "signup";
  app.innerHTML = baseBackground() + '<main class="auth-shell"><section class="card auth-card"><div class="auth-head"><a class="brand" href="#" data-public-home><span class="brand-mark"></span>FocusRoom</a>' + themeToggle() + '</div><div class="auth-tabs"><button class="' + (signup ? 'active' : '') + '" data-auth-tab="signup">Create account</button><button class="' + (!signup ? 'active' : '') + '" data-auth-tab="login">Log in</button></div>' +
    '<form class="form" id="authForm">' +
    (signup ? '<div class="field"><label for="displayName">Display name</label><input id="displayName" name="displayName" minlength="2" maxlength="40" required autocomplete="name" placeholder="How others will see you"></div>' : '') +
    '<div class="field"><label for="email">Email</label><input id="email" name="email" type="email" required autocomplete="email" placeholder="you@example.com"></div><div class="field"><label for="password">Password</label><input id="password" name="password" type="password" minlength="8" required autocomplete="' + (signup ? 'new-password' : 'current-password') + '" placeholder="At least 8 characters"></div>' +
    '<button class="btn btn-primary" type="submit">' + (signup ? 'Create free account' : 'Log in') + '</button><p class="form-note">' + (signup ? 'You may need to confirm your email. Camera and microphone remain off until you choose to join a call.' : 'Welcome back. Your saved goals and focus history will be restored.') + '</p></form>' + (!signup ? '<button class="btn btn-link" data-open-resend>Didn’t receive a verification email?</button>' : '') + '<button class="btn" data-public-home>← Back home</button></section></main>';
}

function navItems() {
  const items = [
    ["home","⌂","Home"], ["rooms","◎","Study rooms"], ["goals","✓","Goals & progress"],
    ["encouragements","♡","Encouragements"], ["private","♢","Private calls"], ["plus","✦","Membership"],
    ["blog","▤","Focus journal"], ["profile","●","Profile"], ["settings","⚙","Privacy & settings"]
  ];
  return items.map(function (item) {
    return '<button class="side-link ' + (state.view === item[0] ? 'active' : '') + '" data-view="' + item[0] + '"><span class="nav-icon">' + item[1] + '</span>' + item[2] + '</button>';
  }).join("");
}

function appShell(content, title) {
  const name = state.profile ? state.profile.display_name : "Student";
  const plan = state.allowance.plan === "plus" ? "premium" : state.allowance.plan;
  app.innerHTML = baseBackground() + '<div class="app-layout"><aside class="sidebar ' + (state.mobileNav ? 'open' : '') + '"><div class="brand"><span class="brand-mark"></span>FocusRoom</div><nav class="side-nav">' + navItems() + '</nav><div class="side-profile"><div class="avatar" style="background:' + esc(state.profile && state.profile.avatar_color || "#7c6cff") + '">' + initials(name) + '</div><div><strong>' + esc(name) + '</strong><small>' + (plan !== "free" ? '<span class="plus-badge">✦ ' + esc(String(plan).toUpperCase()) + '</span>' : 'Free member') + '</small></div></div></aside><main class="main"><header class="app-top"><div style="display:flex;align-items:center;gap:12px"><button class="btn icon-btn mobile-menu" data-toggle-nav>☰</button><h2>' + esc(title) + '</h2></div><div class="app-top-actions">' + themeToggle() + '<button class="btn btn-sm" data-view="rooms">Join a room</button></div></header><div class="app-content">' + content + '</div></main>' + ambientDock() + '</div>';
}

function ambientDock() {
  return '<div class="ambient-dock" aria-label="Focus ambience"><button data-ambient="none" class="' + (state.ambient === "none" ? "active" : "") + '">Quiet</button><button data-ambient="rain" class="' + (state.ambient === "rain" ? "active" : "") + '">🌧 Rain</button><button data-ambient="cafe" class="' + (state.ambient === "cafe" ? "active" : "") + '">☕ Café</button><button data-ambient="fire" class="' + (state.ambient === "fire" ? "active" : "") + '">🔥 Fire</button></div>';
}

function completedMinutes() {
  return state.sessions.reduce(function (sum, row) { return sum + Number(row.minutes || 0); }, 0);
}

function streakDays() {
  const days = new Set(state.sessions.map(function (s) { return new Date(s.completed_at).toISOString().slice(0,10); }));
  let streak = 0;
  const date = new Date();
  while (days.has(date.toISOString().slice(0,10))) { streak += 1; date.setUTCDate(date.getUTCDate() - 1); }
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
    '<section class="card start-session-card"><div class="session-copy"><span class="eyebrow">Start a focus block</span><h2>Set one target. Join when ready.</h2><p>Your intention appears only in this setup and helps you start with a clear finish line.</p></div><form id="quickSessionForm" class="quick-session"><div class="field"><label for="quickIntention">Session intention</label><input id="quickIntention" name="intention" maxlength="100" required placeholder="e.g. Finish chapter 4 notes"></div><div class="field duration-field"><label for="quickDuration">Time</label><select id="quickDuration" name="duration"><option value="25"' + (state.preferences.defaultDuration === 25 ? ' selected' : '') + '>25 min</option><option value="50"' + (state.preferences.defaultDuration === 50 ? ' selected' : '') + '>50 min</option><option value="90"' + (state.preferences.defaultDuration === 90 ? ' selected' : '') + '>90 min</option></select></div><button class="btn btn-primary"' + (leadRoom ? '' : ' disabled') + '>Choose a room</button></form></section>' +
    '<div class="dashboard-layout"><div class="stack"><section class="card focus-floor"><div class="card-title-row"><div><span class="eyebrow">Live focus floor</span><h3>Open rooms</h3></div><button class="btn btn-sm" data-view="rooms">View all</button></div><div class="focus-floor-list">' + (roomStrip || '<div class="empty">Rooms are loading.</div>') + '</div></section><section class="card"><div class="card-title-row"><div><span class="eyebrow">Your plan</span><h3>Today’s goals</h3></div><strong>' + complete + '/' + state.goals.length + '</strong></div><div class="progress"><span style="width:' + progress + '%"></span></div><div style="height:16px"></div>' + goalsList(4) + '<button class="btn btn-sm goals-link" data-view="goals">Manage goals</button></section></div><div class="stack">' + timerCard() + '<section class="card activity-card"><span class="eyebrow">Your momentum</span><div class="mini-stats"><div><strong>' + fmtMinutes(completedMinutes()) + '</strong><span>focused</span></div><div><strong>' + state.sessions.length + '</strong><span>sessions</span></div><div><strong>' + streakDays() + '</strong><span>day streak</span></div></div></section></div></div>';
  appShell(content, "Today");
}

function timerCard() {
  return '<aside class="card timer-card"><span class="eyebrow">Focus timer</span><div class="pills" style="justify-content:center;margin-top:18px"><button class="pill ' + (state.timerPreset === 25 ? 'active' : '') + '" data-timer-preset="25">25 min</button><button class="pill ' + (state.timerPreset === 50 ? 'active' : '') + '" data-timer-preset="50">50 min</button><button class="pill ' + (state.timerPreset === 90 ? 'active' : '') + '" data-timer-preset="90">90 min</button></div><div class="timer-display" id="timerDisplay">' + formatTimer() + '</div><p>Stay with one task until the bell.</p><div class="timer-actions"><button class="btn btn-primary" data-timer-toggle>' + (state.timerRunning ? 'Pause' : 'Start') + '</button><button class="btn" data-timer-reset>Reset</button></div></aside>';
}

function renderRooms() {
  const online = Object.values(state.roomCounts).reduce(function (sum, count) { return sum + count; }, 0);
  appShell('<div class="page-head"><div><span class="eyebrow">Live focus floor</span><h1>Pick your room</h1><p>Choose an atmosphere, set your task, and check your devices before entering.</p></div><span class="online-pill"><i></i>' + online + ' connected</span></div><div class="room-grid">' + roomCards(false) + '</div><div class="room-info-grid"><section class="card"><span class="eyebrow">Before you enter</span><h3>You control what others see and hear</h3><p>The setup screen shows your local preview first. Camera is optional, and you can join muted.</p></section><section class="card"><span class="eyebrow">Community standard</span><h3>Keep the room useful</h3><p>No recording, harassment, disruptive audio, or sharing private information. Leave if anything feels unsafe.</p></section><section class="card"><span class="eyebrow">Your data</span><h3>Calls are not stored here</h3><p>FocusRoom tracks room presence only after connection. It does not record your Jitsi video or audio.</p></section></div>', "Study rooms");
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
    const sender = item.sender || {};
    return '<div class="inbox-item"><div class="avatar" style="background:' + esc(sender.avatar_color || "#7c6cff") + '">' + initials(sender.display_name) + '</div><div><strong>' + esc(sender.display_name || "FocusRoom member") + '</strong> sent ' + (item.kind === "focus_boost" ? '<span class="plus-badge">✦ FOCUS BOOST</span>' : 'an encouragement') + '<p>' + esc(item.message || "Keep going — you’ve got this.") + '</p><span class="meta">' + new Date(item.created_at).toLocaleString() + '</span></div></div>';
  }).join("");
  const members = state.members.map(function (member) {
    return '<article class="card member-card"><div class="avatar" style="background:' + esc(member.avatar_color) + '">' + initials(member.display_name) + '</div><h3>' + esc(member.display_name) + '</h3><p>' + esc(member.subject || "Working toward a goal") + '</p><div class="actions"><button class="btn btn-sm" data-encourage="' + member.id + '">♡ Encourage</button><button class="btn btn-sm btn-primary" data-boost="' + member.id + '">✦ Boost</button></div></article>';
  }).join("");
  appShell('<div class="page-head"><div><span class="eyebrow">Kind energy, not popularity</span><h1>Encouragements</h1><p>Credits reset every Monday. Focus Boosts are a Plus feature.</p></div></div><div class="allowance"><div><span>Encouragements left</span><strong>' + state.allowance.encouragements_remaining + '</strong></div><div><span>Focus Boosts left</span><strong>' + state.allowance.boosts_remaining + '</strong></div><div><span>Your plan</span><strong>' + (state.allowance.plan === "plus" ? "Plus" : "Free") + '</strong></div></div><h2 style="margin-top:34px">Encourage someone</h2><div class="member-grid">' + (members || '<div class="empty">More public profiles will appear as the community grows.</div>') + '</div><h2 style="margin-top:34px">Your inbox</h2><div class="card inbox-list">' + (inbox || '<div class="empty">Encouragements you receive will appear here.</div>') + '</div>', "Encouragements");
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
  appShell('<div class="page-head"><div><span class="eyebrow">Membership</span><h1>Choose what fits</h1><p>Public rooms, timers, goals, focus history, ambience, and appearance settings remain free.</p></div>' + (active ? '<span class="plus-badge">✦ ' + esc(String(state.allowance.plan).toUpperCase()) + ' ACTIVE</span>' : '') + '</div><div class="pricing-grid pricing-four">' + pricingCards() + '</div><section class="card" style="margin-top:24px"><h3>The important difference</h3><p>Text, image, and voice-note messaging are available on every plan with generous anti-spam limits. Starting a private audio or video call from a DM—and hosting invite-only call rooms—requires Premium or Buddy.</p></section>', "Membership");
}

function renderBlog() {
  appShell('<div class="page-head"><div><span class="eyebrow">Focus journal</span><h1>Guides for better sessions</h1><p>Practical, calm advice you can use today.</p></div></div><div class="grid-3">' + blogCards() + '</div><section class="card" style="margin-top:18px"><h3>Weekly reflection</h3><p>What helped you focus this week? What got in the way? Choose one small adjustment for your next session.</p></section>', "Focus journal");
}

function renderProfile() {
  const p = state.profile;
  appShell('<div class="page-head"><div><span class="eyebrow">Show up as yourself</span><h1>Your profile</h1><p>Only details allowed by your privacy settings can be seen by other members.</p></div></div><form class="card form" id="profileForm"><div class="field"><label>Display name</label><input name="display_name" minlength="2" maxlength="40" required value="' + esc(p.display_name) + '"></div><div class="field"><label>What are you studying?</label><input name="subject" maxlength="80" value="' + esc(p.subject) + '" placeholder="Biology, design, coding…"></div><div class="field"><label>Bio</label><textarea name="bio" maxlength="240" placeholder="A short introduction">' + esc(p.bio) + '</textarea></div><div class="field"><label>Country or region</label><input name="country" maxlength="60" value="' + esc(p.country) + '"></div><div class="field"><label>Profile color</label><input name="avatar_color" type="color" value="' + esc(p.avatar_color) + '"></div><button class="btn btn-primary">Save profile</button></form>', "Profile");
}

function toggleRow(name, title, description, checked) {
  return '<div class="check-row"><div><strong>' + title + '</strong><p style="margin:3px 0 0">' + description + '</p></div><label class="switch"><input type="checkbox" name="' + name + '" ' + (checked ? "checked" : "") + '><span></span></label></div>';
}

function renderSettings() {
  const p = state.profile;
  const prefs = state.preferences;
  const roomOptions = state.rooms.map(function (room) { return '<option value="' + esc(room.slug) + '"' + (prefs.defaultRoom === room.slug ? ' selected' : '') + '>' + esc(room.name) + '</option>'; }).join("");
  appShell('<div class="page-head"><div><span class="eyebrow">You stay in control</span><h1>Privacy & settings</h1><p>Video and audio are handled by the call provider and are not stored by FocusRoom.</p></div></div><section class="card appearance-card"><div><span class="eyebrow">Website ambience</span><h3>Appearance</h3><p>Choose the atmosphere that feels best for your study space.</p></div><div class="theme-choice" role="group" aria-label="Website appearance"><button class="btn ' + (state.theme === "light" ? "active" : "") + '" data-theme="light">☀ Light</button><button class="btn ' + (state.theme === "dark" ? "active" : "") + '" data-theme="dark">☾ Dark</button></div></section><form class="card form" id="privacyForm" style="margin-top:18px">' +
    toggleRow("show_profile", "Public member profile", "Allow signed-in members to see your name, bio, and subject.", p.show_profile) +
    toggleRow("show_country", "Show country", "Display your country or region on your profile.", p.show_country) +
    toggleRow("allow_invites", "Allow private-room invites", "Let other members invite you to private study calls.", p.allow_invites) +
    toggleRow("accepting_encouragements", "Receive encouragements", "Allow members to send you supportive messages.", p.accepting_encouragements) +
    '<button class="btn btn-primary">Save privacy settings</button></form><form class="card form advanced-settings" id="studyPreferencesForm"><div><span class="eyebrow">Session defaults</span><h3>Study preferences</h3><p>These choices are saved in this browser and prefill your room setup.</p></div><div class="settings-grid"><div class="field"><label>Default focus block</label><select name="defaultDuration"><option value="25"' + (prefs.defaultDuration === 25 ? ' selected' : '') + '>25 minutes</option><option value="50"' + (prefs.defaultDuration === 50 ? ' selected' : '') + '>50 minutes</option><option value="90"' + (prefs.defaultDuration === 90 ? ' selected' : '') + '>90 minutes</option></select></div><div class="field"><label>Quick-start room</label><select name="defaultRoom">' + roomOptions + '</select></div></div>' + toggleRow("defaultCamera", "Camera ready by default", "Keep camera selected when opening the device lobby. You still approve browser access.", prefs.defaultCamera) + toggleRow("defaultMicrophone", "Microphone ready by default", "Keep microphone selected in the device lobby. Public rooms should usually stay muted.", prefs.defaultMicrophone) + toggleRow("soundCues", "Timer sound cues", "Allow a short sound when a focus block finishes.", prefs.soundCues) + toggleRow("compactMode", "Compact dashboard", "Fit more study information on screen with tighter spacing.", prefs.compactMode) + '<button class="btn btn-primary">Save study preferences</button></form><section class="card" style="margin-top:18px"><h3>Account</h3><p>Signed in as ' + esc(state.user.email) + '</p><button class="btn btn-danger" data-signout>Sign out</button> <button class="btn" data-privacy>Read privacy summary</button></section>', "Privacy & settings");
}

function renderApp() {
  if (!state.session) return renderLanding();
  const renderers = { home:renderHome, rooms:renderRooms, goals:renderGoals, encouragements:renderEncouragements, private:renderPrivate, plus:renderPlus, blog:renderBlog, profile:renderProfile, settings:renderSettings };
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
      state.roomCounts[room.slug] = Object.values(presence).reduce(function (sum, entries) {
        return sum + entries.filter(function (entry) { return entry && entry.user_id; }).length;
      }, 0);
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
    supabase.from("encouragements").select("*,sender:profiles!encouragements_sender_id_fkey(display_name,avatar_color)").eq("receiver_id", userId).order("created_at", { ascending:false }).limit(30),
    supabase.from("profiles").select("id,display_name,subject,avatar_color").neq("id", userId).eq("show_profile", true).limit(12),
    supabase.from("private_rooms").select("*").order("created_at", { ascending:false })
  ]);
  if (results[0].error) showToast(results[0].error.message, true);
  state.profile = results[0].data || { id:userId, display_name:state.user.email.split("@")[0], bio:"", country:"", subject:"", avatar_color:"#7c6cff", show_profile:true, show_country:false, allow_invites:true, accepting_encouragements:true };
  state.goals = results[1].data || [];
  state.sessions = results[2].data || [];
  state.subscription = results[3].data || null;
  if (results[4].data && results[4].data[0]) state.allowance = results[4].data[0];
  state.encouragements = results[5].data || [];
  state.members = results[6].data || [];
  state.privateRooms = results[7].data || [];
  await processInvite();
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

async function handleAuthSubmit(form) {
  const data = new FormData(form);
  const email = String(data.get("email")).trim();
  const password = String(data.get("password"));
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  button.textContent = "Please wait…";
  if (state.authMode === "signup") {
    const displayName = String(data.get("displayName")).trim();
    const result = await supabase.auth.signUp({ email:email, password:password, options:{ data:{ display_name:displayName }, emailRedirectTo:location.origin + location.pathname } });
    if (result.error) showToast(result.error.message, true);
    else if (!result.data.session) {
      state.pendingVerificationEmail = email;
      showModal("Check your email", '<p>We sent a confirmation link to <strong>' + esc(email) + '</strong>. Open it to activate your FocusRoom account.</p><p class="form-note">Check Spam and Promotions. If the link says it was already used, request a fresh one below—some email security scanners can open single-use links before you do.</p><button class="btn" data-resend-email>Resend verification</button> <button class="btn btn-primary" data-close-modal>Got it</button>');
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
  const result = await supabase.auth.resend({ type:"signup", email:address, options:{ emailRedirectTo:location.origin + location.pathname } });
  if (result.error) return showToast(result.error.message, true);
  state.pendingVerificationEmail = address;
  closeModal();
  showToast("A fresh verification email was sent. Check Spam and Promotions too.");
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
  state.timerPreset = minutes; state.timerSeconds = minutes * 60; state.timerRunning = false;
  clearInterval(state.timerId); renderApp();
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

function showJoinLobby(room, isPrivate) {
  state.pendingRoom = room;
  state.pendingPrivate = Boolean(isPrivate);
  const draft = state.joinDraft;
  showModal("Set up your session", '<form id="joinLobbyForm" class="join-lobby"><div class="lobby-grid"><div class="device-panel"><div class="video-preview-wrap"><video id="devicePreview" autoplay muted playsinline></video><div class="video-placeholder" id="videoPlaceholder"><span>◉</span><strong>Preview is off</strong><small>Nothing is shared until you join</small></div><div class="mic-meter" aria-label="Microphone level"><i id="micLevel"></i></div></div><button class="btn device-check-btn" type="button" data-check-devices>Test camera & microphone</button><p class="device-status" id="deviceStatus">You can also join with both off.</p></div><div class="lobby-options"><span class="eyebrow">' + (isPrivate ? 'Private room' : 'Public focus room') + '</span><h3>' + esc(room.name || room.title) + '</h3><p>' + esc(room.description || (room.call_mode === "audio" ? "Invite-only audio study call." : "Invite-only video study call.")) + '</p><div class="field"><label for="sessionIntention">What will you finish?</label><input id="sessionIntention" name="intention" maxlength="100" value="' + esc(draft.intention) + '" placeholder="One clear task"></div><div class="field"><label for="sessionDuration">Focus block</label><select id="sessionDuration" name="duration"><option value="25"' + (draft.duration === 25 ? ' selected' : '') + '>25 minutes</option><option value="50"' + (draft.duration === 50 ? ' selected' : '') + '>50 minutes</option><option value="90"' + (draft.duration === 90 ? ' selected' : '') + '>90 minutes</option></select></div><div class="device-switches"><label><input type="checkbox" name="camera" data-media-toggle="camera"' + (draft.camera ? ' checked' : '') + '><span>Camera</span><small id="cameraState">' + (draft.camera ? 'On' : 'Off') + '</small></label><label><input type="checkbox" name="microphone" data-media-toggle="microphone"' + (draft.microphone ? ' checked' : '') + '><span>Microphone</span><small id="microphoneState">' + (draft.microphone ? 'On' : 'Off') + '</small></label></div><div class="device-selects" id="deviceSelects"><div class="field"><label>Camera</label><select name="cameraDevice" disabled><option>Run device test first</option></select></div><div class="field"><label>Microphone</label><select name="microphoneDevice" disabled><option>Run device test first</option></select></div></div></div></div><div class="lobby-footer"><p><strong>Privacy:</strong> your preview stays on this device. FocusRoom does not record calls.</p><div><button type="button" class="btn" data-close-modal>Cancel</button> <button class="btn btn-primary" type="submit">Join room →</button></div></div></form>', true);
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
  if (state.joinDraft.cameraId) cameraSelect.value = state.joinDraft.cameraId;
  if (state.joinDraft.microphoneId) micSelect.value = state.joinDraft.microphoneId;
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
    const stream = await navigator.mediaDevices.getUserMedia({ video:true, audio:true });
    state.previewStream = stream;
    const video = document.querySelector("#devicePreview");
    if (video) { video.srcObject = stream; await video.play().catch(function () {}); }
    document.querySelector("#videoPlaceholder")?.classList.add("hidden");
    state.joinDraft.camera = Boolean(stream.getVideoTracks().length);
    state.joinDraft.microphone = Boolean(stream.getAudioTracks().length);
    const cameraToggle = document.querySelector('[name="camera"]');
    const micToggle = document.querySelector('[name="microphone"]');
    if (cameraToggle) cameraToggle.checked = state.joinDraft.camera;
    if (micToggle) micToggle.checked = state.joinDraft.microphone;
    const cameraState = document.querySelector("#cameraState");
    const microphoneState = document.querySelector("#microphoneState");
    if (cameraState) cameraState.textContent = state.joinDraft.camera ? "On" : "Unavailable";
    if (microphoneState) microphoneState.textContent = state.joinDraft.microphone ? "On" : "Unavailable";
    await populateDeviceSelectors();
    startMicMeter(stream);
    if (status) { status.textContent = "Devices are working. Choose what to keep on when you enter."; status.classList.remove("error"); }
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

async function ensureJitsi() {
  if (typeof window.JitsiMeetExternalAPI === "function") return true;
  return new Promise(function (resolve) {
    const script = document.createElement("script");
    const finish = function () { resolve(typeof window.JitsiMeetExternalAPI === "function"); };
    script.src = "https://meet.jit.si/external_api.js?v=focusroom";
    script.async = true;
    script.onload = finish;
    script.onerror = function () { resolve(false); };
    document.head.appendChild(script);
    setTimeout(finish, 8000);
  });
}

async function mountMeeting(room, isPrivate, joinOptions) {
  const options = joinOptions || state.joinDraft;
  state.activeRoom = room;
  state.timerPreset = Number(options.duration || 50);
  state.timerSeconds = state.timerPreset * 60;
  const directUrl = "https://meet.jit.si/" + encodeURIComponent(room.jitsi_room);
  app.insertAdjacentHTML("beforeend", '<section class="meeting-page"><header class="meeting-head"><button class="btn btn-sm" data-leave-meeting>← Leave</button><div class="meeting-context"><h3>' + esc(room.name || room.title) + '</h3><span>' + esc(options.intention || "Focus session") + ' · ' + state.timerPreset + ' min</span></div><span class="meeting-status" id="meetingStatus">Opening room…</span><a class="btn btn-sm" href="' + directUrl + '" target="_blank" rel="noopener noreferrer">Open separately ↗</a></header><div id="jitsiMount"></div></section>');
  const ready = await ensureJitsi();
  if (!ready) {
    document.querySelector("#jitsiMount").innerHTML = '<div class="meeting-error"><h2>Open the room directly</h2><p>Your browser blocked the embedded call. The same live camera room can still open securely in Jitsi.</p><a class="btn btn-primary" href="' + directUrl + '" target="_blank" rel="noopener noreferrer">Open camera room</a><p class="form-note">Camera and microphone permissions are controlled by your browser.</p></div>'; return;
  }
  try {
    state.jitsi = new window.JitsiMeetExternalAPI("meet.jit.si", {
      roomName: room.jitsi_room,
      parentNode: document.querySelector("#jitsiMount"),
      width: "100%",
      height: "100%",
      userInfo: { displayName:state.profile.display_name },
      configOverwrite: {
        prejoinPageEnabled: false,
        startWithAudioMuted: !options.microphone,
        startWithVideoMuted: !options.camera,
        disableDeepLinking: true,
        enableWelcomePage: false,
        useHostPageLocalStorage: true
      },
      interfaceConfigOverwrite: { MOBILE_APP_PROMO:false, SHOW_JITSI_WATERMARK:false }
    });
    state.jitsi.addListener("videoConferenceJoined", function () {
      const status = document.querySelector("#meetingStatus"); if (status) status.textContent = "Connected";
      if (options.cameraDeviceId) state.jitsi.executeCommand("setVideoInputDevice", "Selected camera", options.cameraDeviceId);
      if (options.microphoneDeviceId) state.jitsi.executeCommand("setAudioInputDevice", "Selected microphone", options.microphoneDeviceId);
      trackPresence(room, isPrivate);
    });
    state.jitsi.addListener("videoConferenceLeft", leaveMeeting);
    state.jitsi.addListener("readyToClose", leaveMeeting);
    state.jitsi.addListener("cameraError", function () { showToast("Jitsi could not open the camera. Check the site permission or use Open separately.", true); });
    state.jitsi.addListener("micError", function () { showToast("Jitsi could not open the microphone. Check the site permission or use Open separately.", true); });
  } catch (error) {
    document.querySelector("#jitsiMount").innerHTML = '<div class="meeting-error"><h2>Could not start the call</h2><p>' + esc(error.message) + '</p></div>';
  }
}

function trackPresence(room, isPrivate) {
  if (state.presenceChannel) supabase.removeChannel(state.presenceChannel);
  const channelName = isPrivate ? "private-presence:" + room.id : "presence:" + room.slug;
  state.presenceChannel = supabase.channel(channelName, { config:{ presence:{ key:state.user.id } } });
  state.presenceChannel.subscribe(async function (status) {
    if (status === "SUBSCRIBED") await state.presenceChannel.track({ user_id:state.user.id, display_name:state.profile.display_name, joined_at:new Date().toISOString() });
  });
}

async function leaveMeeting() {
  if (state.presenceChannel) { await state.presenceChannel.untrack(); await supabase.removeChannel(state.presenceChannel); state.presenceChannel = null; }
  if (state.jitsi) { state.jitsi.dispose(); state.jitsi = null; }
  state.activeRoom = null;
  document.querySelector(".meeting-page")?.remove();
}

async function sendEncouragement(userId, kind) {
  if (kind === "focus_boost" && state.allowance.plan !== "plus") { state.view = "plus"; renderPlus(); return showToast("Focus Boosts are included with Plus."); }
  showModal(kind === "focus_boost" ? "Send a Focus Boost" : "Send encouragement", '<form id="encouragementForm" class="form"><input type="hidden" name="receiver" value="' + esc(userId) + '"><input type="hidden" name="kind" value="' + kind + '"><div class="field"><label>Supportive message</label><textarea name="message" maxlength="160" placeholder="You’re doing great — keep going!"></textarea></div><button class="btn btn-primary">Send</button></form>');
}

async function submitEncouragement(form) {
  const data = new FormData(form);
  const result = await supabase.rpc("send_encouragement", { p_receiver_id:data.get("receiver"), p_kind:data.get("kind"), p_message:data.get("message") || "" });
  if (result.error) return showToast(result.error.message, true);
  closeModal();
  const allowance = await supabase.rpc("get_weekly_allowance");
  if (allowance.data && allowance.data[0]) state.allowance = allowance.data[0];
  showToast(data.get("kind") === "focus_boost" ? "Focus Boost sent." : "Encouragement sent.");
  renderEncouragements();
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
    update = { show_profile:data.has("show_profile"), show_country:data.has("show_country"), allow_invites:data.has("allow_invites"), accepting_encouragements:data.has("accepting_encouragements") };
  } else {
    update = { display_name:String(data.get("display_name")).trim(), subject:String(data.get("subject")).trim(), bio:String(data.get("bio")).trim(), country:String(data.get("country")).trim(), avatar_color:data.get("avatar_color") };
  }
  const result = await supabase.from("profiles").update(update).eq("id", state.user.id).select().single();
  if (result.error) return showToast(result.error.message, true);
  state.profile = result.data; showToast("Settings saved."); renderApp();
}

function saveStudyPreferences(form) {
  const data = new FormData(form);
  state.preferences = {
    defaultDuration:Number(data.get("defaultDuration") || 50),
    defaultRoom:String(data.get("defaultRoom") || "deep-focus"),
    defaultCamera:data.has("defaultCamera"),
    defaultMicrophone:data.has("defaultMicrophone"),
    soundCues:data.has("soundCues"),
    compactMode:data.has("compactMode")
  };
  state.joinDraft.duration = state.preferences.defaultDuration;
  state.joinDraft.camera = state.preferences.defaultCamera;
  state.joinDraft.microphone = state.preferences.defaultMicrophone;
  localStorage.setItem("focusroom-study-preferences", JSON.stringify(state.preferences));
  document.documentElement.classList.toggle("compact-mode", state.preferences.compactMode);
  showToast("Study preferences saved.");
  renderSettings();
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
  showModal("FocusRoom privacy summary", '<div class="article-body"><h3>Your account data</h3><p>FocusRoom stores your account, profile, goals, sessions, plan status, privacy choices, and encouragement activity in Supabase. Row-level rules limit personal data to the correct account.</p><h3>Camera and microphone</h3><p>Calls are provided through Jitsi. FocusRoom does not record or store your call video or audio. Your browser asks for permission, and calls begin with camera and microphone off.</p><h3>Public and private rooms</h3><p>Public study rooms are open to signed-in members. Private rooms require an unguessable invite and expire after 24 hours. Do not share an invite publicly.</p><h3>Payments</h3><p>When enabled, Stripe processes card and Apple Pay details. FocusRoom stores subscription status but never stores full payment-card details.</p></div>', true);
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
  renderApp();
}

document.addEventListener("click", async function (event) {
  const target = event.target.closest("button,a,article");
  if (!target) return;
  if (target.matches("[data-close-modal]") || event.target.matches("[data-close-modal]")) return closeModal();
  if (target.dataset.publicHome !== undefined) { event.preventDefault(); state.session ? (state.view = "home", renderApp()) : renderLanding(); }
  if (target.dataset.auth) { state.authMode = target.dataset.auth; renderAuth(); }
  if (target.dataset.authTab) { state.authMode = target.dataset.authTab; renderAuth(); }
  if (target.dataset.openResend !== undefined) showModal("Resend verification", '<form id="resendForm" class="form"><div class="field"><label for="resendEmail">Account email</label><input id="resendEmail" name="email" type="email" required autocomplete="email" placeholder="you@example.com"></div><button class="btn btn-primary">Send a fresh link</button></form>');
  if (target.dataset.resendEmail !== undefined) await resendVerification();
  if (target.dataset.view) { state.view = target.dataset.view; state.mobileNav = false; renderApp(); }
  if (target.dataset.joinRoom) await joinPublicRoom(target.dataset.joinRoom);
  if (target.dataset.checkDevices !== undefined) await checkDevices();
  if (target.dataset.leaveMeeting !== undefined) await leaveMeeting();
  if (target.dataset.goalDelete) await deleteGoal(target.dataset.goalDelete);
  if (target.dataset.timerPreset) setTimerPreset(Number(target.dataset.timerPreset));
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
  if (target.dataset.toggleNav !== undefined) { state.mobileNav = !state.mobileNav; renderApp(); }
  if (target.dataset.signout !== undefined) await supabase.auth.signOut();
});

document.addEventListener("change", async function (event) {
  if (event.target.dataset.goalToggle) await toggleGoal(event.target.dataset.goalToggle, event.target.checked);
  if (event.target.dataset.mediaToggle) togglePreviewTrack(event.target.dataset.mediaToggle, event.target.checked);
});

document.addEventListener("submit", async function (event) {
  event.preventDefault();
  const form = event.target;
  if (form.id === "authForm") await handleAuthSubmit(form);
  if (form.id === "resendForm") { const data = new FormData(form); await resendVerification(data.get("email")); }
  if (form.id === "quickSessionForm") {
    const data = new FormData(form);
    state.joinDraft.intention = String(data.get("intention") || "").trim();
    state.joinDraft.duration = Number(data.get("duration") || 50);
    const preferredRoom = state.rooms.find(function (room) { return room.slug === state.preferences.defaultRoom; }) || state.rooms[0];
    if (preferredRoom) showJoinLobby(preferredRoom, false);
  }
  if (form.id === "joinLobbyForm") {
    const data = new FormData(form);
    const room = state.pendingRoom;
    const isPrivate = state.pendingPrivate;
    state.joinDraft = {
      intention:String(data.get("intention") || "").trim(),
      duration:Number(data.get("duration") || 50),
      camera:data.has("camera"),
      microphone:data.has("microphone"),
      cameraDeviceId:String(data.get("cameraDevice") || ""),
      microphoneDeviceId:String(data.get("microphoneDevice") || "")
    };
    stopDevicePreview();
    modalRoot.innerHTML = "";
    state.pendingRoom = null;
    state.pendingPrivate = false;
    if (room) await mountMeeting(room, isPrivate, state.joinDraft);
  }
  if (form.id === "goalForm") { const data = new FormData(form); await saveGoal(String(data.get("title")).trim()); }
  if (form.id === "encouragementForm") await submitEncouragement(form);
  if (form.id === "privateRoomForm") await createPrivateRoom(form);
  if (form.id === "profileForm") await saveProfile(form, false);
  if (form.id === "privacyForm") await saveProfile(form, true);
  if (form.id === "studyPreferencesForm") saveStudyPreferences(form);
});

window.addEventListener("beforeunload", function () { if (state.presenceChannel) state.presenceChannel.untrack(); stopAmbient(); });

async function init() {
  document.documentElement.classList.toggle("compact-mode", state.preferences.compactMode);
  await loadPublicRooms();
  const current = await supabase.auth.getSession();
  state.session = current.data.session;
  state.user = state.session && state.session.user;
  if (state.session) await loadUserData();
  renderApp();
  supabase.auth.onAuthStateChange(function (event, session) {
    setTimeout(async function () {
      state.session = session; state.user = session && session.user;
      if (session) { await loadUserData(); state.view = "home"; }
      else { state.profile = null; state.view = "home"; }
      renderApp();
    }, 0);
  });
}

init().catch(function (error) {
  console.error(error);
  app.innerHTML = baseBackground() + '<main class="auth-shell"><section class="card auth-card"><h1>FocusRoom could not start</h1><p>' + esc(error.message) + '</p><button class="btn btn-primary" onclick="location.reload()">Try again</button></section></main>';
});
