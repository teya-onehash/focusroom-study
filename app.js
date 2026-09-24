import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.1/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, CHECKOUT_URLS } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const app = document.querySelector("#app");
const modalRoot = document.querySelector("#modalRoot");
const toastEl = document.querySelector("#toast");

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
  timerSeconds: 25 * 60,
  timerPreset: 25,
  timerRunning: false,
  timerId: null,
  ambient: "none",
  audio: null,
  authMode: "signup",
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

function closeModal() { modalRoot.innerHTML = ""; }

function showModal(title, content, large) {
  modalRoot.innerHTML = '<div class="modal-backdrop" data-close-modal><div class="modal' + (large ? ' modal-lg' : '') + '" role="dialog" aria-modal="true"><div class="modal-head"><h2>' + esc(title) + '</h2><button class="btn icon-btn" data-close-modal aria-label="Close">×</button></div>' + content + '</div></div>';
}

function baseBackground() {
  return '<div class="ambient-bg" aria-hidden="true"></div>';
}

function publicHeader() {
  return '<header class="topbar"><a class="brand" href="#" data-public-home><span class="brand-mark"></span>FocusRoom</a><nav class="top-links"><a href="#rooms">Rooms</a><a href="#features">Features</a><a href="#pricing">Plus</a><a href="#journal">Journal</a><button class="btn btn-sm" data-auth="login">Log in</button><button class="btn btn-primary btn-sm" data-auth="signup">Join free</button></nav></header>';
}

function roomCards(publicMode) {
  if (!state.rooms.length) return '<div class="skeleton"></div><div class="skeleton"></div>';
  return state.rooms.map(function (room) {
    const count = state.roomCounts[room.slug] || 0;
    return '<article class="card room-card"><div class="room-icon">' + esc(room.icon) + '</div><div><h3>' + esc(room.name) + '</h3><p>' + esc(room.description) + '</p><div class="live-dot"><span data-room-count="' + esc(room.slug) + '">' + count + '</span> studying now</div></div><button class="btn btn-sm ' + (publicMode ? '' : 'btn-primary') + '" data-join-room="' + esc(room.id) + '">' + (publicMode ? 'View room' : 'Join') + '</button></article>';
  }).join("");
}

function pricingCards() {
  const plans = [
    { key: "week", name: "Weekly", price: "$3.99", unit: "/ week", note: "Flexible access" },
    { key: "month", name: "Monthly", price: "$14", unit: "/ month", note: "Most popular", popular: true },
    { key: "year", name: "Yearly", price: "$160", unit: "/ year", note: "Best for committed students" }
  ];
  return plans.map(function (plan) {
    return '<article class="card price-card' + (plan.popular ? ' popular' : '') + '">' +
      (plan.popular ? '<span class="popular-tag">Most popular</span>' : '') +
      '<span class="eyebrow">' + plan.note + '</span><h3>' + plan.name + ' Plus</h3><div class="price">' + plan.price + '<small>' + plan.unit + '</small></div>' +
      '<ul class="perk-list"><li>Host private video and audio rooms</li><li>50 encouragements every week</li><li>5 highlighted Focus Boosts weekly</li><li>Private groups for up to 6 people</li><li>Full focus history and premium themes</li><li>Plus profile badge and no ads</li></ul>' +
      '<button class="btn btn-primary" data-checkout="' + plan.key + '">Choose ' + plan.name + '</button><span class="apple-pay"> Pay available at checkout</span></article>';
  }).join("");
}

function blogCards() {
  return blogs.map(function (post) {
    return '<article class="card blog-card" data-blog="' + post.id + '"><span class="tag">' + post.tag + '</span><h3>' + post.title + '</h3><p>' + post.excerpt + '</p><span class="read">Read article →</span></article>';
  }).join("");
}

function renderLanding() {
  app.innerHTML = baseBackground() + '<div class="landing">' + publicHeader() +
    '<main><section class="hero"><div class="hero-copy"><span class="eyebrow">A calmer place to get things done</span><h1><span class="gradient-text">Focus together.</span><br>Grow every day.</h1><p>Join real live study rooms, set a goal, and work alongside people who are showing up too. Camera and microphone always start off.</p><div class="hero-actions"><button class="btn btn-primary" data-auth="signup">Start studying free</button><a class="btn" href="#rooms">Explore live rooms</a></div><div class="trust-row"><span>Free public rooms</span><span>Real camera and audio controls</span><span>Privacy settings</span></div></div>' +
    '<div class="hero-visual" aria-label="Cozy nighttime desk illustration"><div class="moon"></div><div class="desk-scene"></div><div class="scene-card"><span class="pulse"></span><div><strong>' + (Object.values(state.roomCounts).reduce(function(a,b){return a+b;},0)) + ' people focusing</strong><small>Live presence only — no made-up users</small></div></div></div></section>' +
    '<section class="section" id="rooms"><div class="section-head"><div><span class="eyebrow">Live rooms</span><h2>Find your focus atmosphere</h2></div><p>Every number is based on people actually connected to a room. Sign in to join with camera and microphone controls.</p></div><div class="room-grid">' + roomCards(true) + '</div></section>' +
    '<section class="section" id="features"><div class="section-head"><div><span class="eyebrow">Made for momentum</span><h2>More than a video call</h2></div></div><div class="bento"><article class="card feature-card"><div class="feature-icon">◷</div><div><h3>Focus timer and goals</h3><p>Choose 25 or 50 minutes, write the next task, and save completed sessions to your history.</p></div></article><article class="card feature-card"><div class="feature-icon">♡</div><div><h3>Real encouragement</h3><p>Send a thoughtful nudge to someone who is showing up. Free members receive 5 sends each week.</p></div></article><article class="card feature-card"><div class="feature-icon">☾</div><div><h3>Cozy ambience</h3><p>Use generated rain, café, or fireside sound without opening another distracting tab.</p></div></article></div></section>' +
    '<section class="section" id="pricing"><div class="section-head"><div><span class="eyebrow">FocusRoom Plus</span><h2>A more personal focus space</h2></div><p>All public rooms and essential focus tools stay free. Plus is for students who want private calls and extra ways to connect.</p></div><div class="pricing-grid">' + pricingCards() + '</div></section>' +
    '<section class="section" id="journal"><div class="section-head"><div><span class="eyebrow">Focus journal</span><h2>Small ideas that help</h2></div></div><div class="grid-3">' + blogCards() + '</div></section></main>' +
    '<footer class="footer"><div><div class="brand"><span class="brand-mark"></span>FocusRoom</div><p>Study together without the pressure.</p></div><div><button class="btn btn-sm" data-privacy>Privacy</button> <button class="btn btn-sm" data-auth="login">Member login</button></div></footer></div>';
}

function renderAuth() {
  const signup = state.authMode === "signup";
  app.innerHTML = baseBackground() + '<main class="auth-shell"><section class="card auth-card"><a class="brand" href="#" data-public-home><span class="brand-mark"></span>FocusRoom</a><div class="auth-tabs"><button class="' + (signup ? 'active' : '') + '" data-auth-tab="signup">Create account</button><button class="' + (!signup ? 'active' : '') + '" data-auth-tab="login">Log in</button></div>' +
    '<form class="form" id="authForm">' +
    (signup ? '<div class="field"><label for="displayName">Display name</label><input id="displayName" name="displayName" minlength="2" maxlength="40" required autocomplete="name" placeholder="How others will see you"></div>' : '') +
    '<div class="field"><label for="email">Email</label><input id="email" name="email" type="email" required autocomplete="email" placeholder="you@example.com"></div><div class="field"><label for="password">Password</label><input id="password" name="password" type="password" minlength="8" required autocomplete="' + (signup ? 'new-password' : 'current-password') + '" placeholder="At least 8 characters"></div>' +
    '<button class="btn btn-primary" type="submit">' + (signup ? 'Create free account' : 'Log in') + '</button><p class="form-note">' + (signup ? 'You may need to confirm your email. Camera and microphone remain off until you choose to join a call.' : 'Welcome back. Your saved goals and focus history will be restored.') + '</p></form><button class="btn" data-public-home>← Back home</button></section></main>';
}

function navItems() {
  const items = [
    ["home","⌂","Home"], ["rooms","◎","Study rooms"], ["goals","✓","Goals & progress"],
    ["encouragements","♡","Encouragements"], ["private","♢","Private calls"], ["plus","✦","FocusRoom Plus"],
    ["blog","▤","Focus journal"], ["profile","●","Profile"], ["settings","⚙","Privacy & settings"]
  ];
  return items.map(function (item) {
    return '<button class="side-link ' + (state.view === item[0] ? 'active' : '') + '" data-view="' + item[0] + '"><span class="nav-icon">' + item[1] + '</span>' + item[2] + '</button>';
  }).join("");
}

function appShell(content, title) {
  const name = state.profile ? state.profile.display_name : "Student";
  const plus = state.allowance.plan === "plus";
  app.innerHTML = baseBackground() + '<div class="app-layout"><aside class="sidebar ' + (state.mobileNav ? 'open' : '') + '"><div class="brand"><span class="brand-mark"></span>FocusRoom</div><nav class="side-nav">' + navItems() + '</nav><div class="side-profile"><div class="avatar" style="background:' + esc(state.profile && state.profile.avatar_color || "#7c6cff") + '">' + initials(name) + '</div><div><strong>' + esc(name) + '</strong><small>' + (plus ? '<span class="plus-badge">✦ PLUS</span>' : 'Free member') + '</small></div></div></aside><main class="main"><header class="app-top"><div style="display:flex;align-items:center;gap:12px"><button class="btn icon-btn mobile-menu" data-toggle-nav>☰</button><h2>' + esc(title) + '</h2></div><div><button class="btn btn-sm" data-view="rooms">Join a room</button></div></header><div class="app-content">' + content + '</div></main>' + ambientDock() + '</div>';
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
  const prompt = prompts[Math.floor(Date.now() / 86400000) % prompts.length];
  const complete = state.goals.filter(function (g) { return g.complete; }).length;
  const progress = state.goals.length ? Math.round(complete / state.goals.length * 100) : 0;
  const content = '<div class="page-head"><div><span class="eyebrow">Welcome back</span><h1>Ready for a good session?</h1><p>Set one clear intention, then choose the room that fits your energy.</p></div><button class="btn btn-primary" data-view="rooms">Find a live room</button></div>' +
    '<div class="stat-grid"><div class="card stat"><span class="label">Focus time</span><div class="value">' + fmtMinutes(completedMinutes()) + '</div></div><div class="card stat"><span class="label">Sessions</span><div class="value">' + state.sessions.length + '</div></div><div class="card stat"><span class="label">Current streak</span><div class="value">' + streakDays() + ' days</div></div><div class="card stat"><span class="label">Weekly sends</span><div class="value">' + state.allowance.encouragements_remaining + ' left</div></div></div>' +
    '<div class="dashboard-grid"><div class="stack"><article class="card daily-card"><span class="eyebrow">Today’s focus prompt</span><blockquote>“' + esc(prompt) + '”</blockquote><button class="btn" data-view="goals">Turn it into a goal</button></article><section class="card"><div class="section-head"><div><h3>Your goals</h3><p>' + complete + ' of ' + state.goals.length + ' completed</p></div><strong>' + progress + '%</strong></div><div class="progress"><span style="width:' + progress + '%"></span></div><div style="height:16px"></div>' + goalsList(4) + '</section></div>' + timerCard() + '</div>';
  appShell(content, "Home");
}

function timerCard() {
  return '<aside class="card timer-card"><span class="eyebrow">Focus timer</span><div class="pills" style="justify-content:center;margin-top:18px"><button class="pill ' + (state.timerPreset === 25 ? 'active' : '') + '" data-timer-preset="25">25 min</button><button class="pill ' + (state.timerPreset === 50 ? 'active' : '') + '" data-timer-preset="50">50 min</button><button class="pill ' + (state.timerPreset === 90 ? 'active' : '') + '" data-timer-preset="90">90 min</button></div><div class="timer-display" id="timerDisplay">' + formatTimer() + '</div><p>Stay with one task until the bell.</p><div class="timer-actions"><button class="btn btn-primary" data-timer-toggle>' + (state.timerRunning ? 'Pause' : 'Start') + '</button><button class="btn" data-timer-reset>Reset</button></div></aside>';
}

function renderRooms() {
  appShell('<div class="page-head"><div><span class="eyebrow">24/7 public spaces</span><h1>Study rooms</h1><p>Camera and microphone begin off. You control when they are enabled.</p></div></div><div class="room-grid">' + roomCards(false) + '</div><div class="card" style="margin-top:18px"><strong>Respect the room</strong><p style="margin-bottom:0">No recording, harassment, or disruptive audio. Leave immediately if anything feels unsafe. FocusRoom does not store your call video or audio.</p></div>', "Study rooms");
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
  const plus = state.allowance.plan === "plus";
  const list = state.privateRooms.map(function (room) {
    return '<div class="private-room"><div><strong>' + esc(room.title) + '</strong><p>' + (room.call_mode === "audio" ? "Audio call" : "Video call") + ' · expires ' + new Date(room.expires_at).toLocaleString() + '</p></div><div><button class="btn btn-sm" data-copy-invite="' + room.invite_token + '">Copy invite</button> <button class="btn btn-sm btn-primary" data-join-private="' + room.id + '">Open</button></div></div>';
  }).join("");
  const create = plus ? '<form class="card form" id="privateRoomForm"><h3>Create a private room</h3><div class="field"><label>Room title</label><input name="title" minlength="2" maxlength="80" required placeholder="Evening study call"></div><div class="field"><label>Call type</label><select name="mode"><option value="video">Video call</option><option value="audio">Audio call</option></select></div><button class="btn btn-primary">Create private room</button><p class="form-note">Rooms expire after 24 hours and support up to 6 authenticated members.</p></form>' : '<article class="card daily-card"><span class="eyebrow">Plus feature</span><h2>Private calls for your study circle</h2><p>Create an invite-only audio or video room for up to six people. Your invite uses a random private token and expires after 24 hours.</p><button class="btn btn-primary" data-view="plus">See Plus plans</button></article>';
  appShell('<div class="page-head"><div><span class="eyebrow">Your study circle</span><h1>Private calls</h1><p>Host access requires Plus. Invited members can join with a free account.</p></div>' + (plus ? '<span class="plus-badge">✦ PLUS ACTIVE</span>' : '') + '</div><div class="dashboard-grid"><div class="stack"><section class="card"><h3>Your rooms</h3><div class="stack">' + (list || '<div class="empty">You have no active private rooms.</div>') + '</div></section></div>' + create + '</div>', "Private calls");
}

function renderPlus() {
  const active = state.allowance.plan === "plus";
  appShell('<div class="page-head"><div><span class="eyebrow">A little more room to connect</span><h1>FocusRoom Plus</h1><p>Public rooms and core focus tools always remain free.</p></div>' + (active ? '<span class="plus-badge">✦ YOUR PLAN IS ACTIVE</span>' : '') + '</div><div class="pricing-grid">' + pricingCards() + '</div><section class="card" style="margin-top:24px"><h3>Why these perks?</h3><p>Plus is built around privacy and connection—not artificial status. Private calls, higher encouragement limits, Focus Boosts, full history, themes, and an ad-free experience make the membership useful without weakening the free study experience.</p></section>', "FocusRoom Plus");
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
  appShell('<div class="page-head"><div><span class="eyebrow">You stay in control</span><h1>Privacy & settings</h1><p>Video and audio are handled by the call provider and are not stored by FocusRoom.</p></div></div><form class="card form" id="privacyForm">' +
    toggleRow("show_profile", "Public member profile", "Allow signed-in members to see your name, bio, and subject.", p.show_profile) +
    toggleRow("show_country", "Show country", "Display your country or region on your profile.", p.show_country) +
    toggleRow("allow_invites", "Allow private-room invites", "Let other members invite you to private study calls.", p.allow_invites) +
    toggleRow("accepting_encouragements", "Receive encouragements", "Allow members to send you supportive messages.", p.accepting_encouragements) +
    '<button class="btn btn-primary">Save privacy settings</button></form><section class="card" style="margin-top:18px"><h3>Account</h3><p>Signed in as ' + esc(state.user.email) + '</p><button class="btn btn-danger" data-signout>Sign out</button> <button class="btn" data-privacy>Read privacy summary</button></section>', "Privacy & settings");
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
      showModal("Check your email", '<p>We sent a confirmation link to <strong>' + esc(email) + '</strong>. Open it to activate your FocusRoom account.</p><button class="btn btn-primary" data-close-modal>Got it</button>');
      button.disabled = false; button.textContent = "Create free account";
    }
  } else {
    const result = await supabase.auth.signInWithPassword({ email:email, password:password });
    if (result.error) { showToast(result.error.message, true); button.disabled = false; button.textContent = "Log in"; }
  }
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
        showToast("Focus session complete. Great work.");
        renderApp();
      }
    }, 1000);
  } else clearInterval(state.timerId);
  renderApp();
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
  state.activeRoom = room;
  await mountMeeting(room, false);
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

async function mountMeeting(room, isPrivate) {
  app.insertAdjacentHTML("beforeend", '<section class="meeting-page"><header class="meeting-head"><button class="btn btn-sm" data-leave-meeting>← Leave</button><h3>' + esc(room.name || room.title) + '</h3><span class="meeting-status" id="meetingStatus">Preparing secure controls…</span></header><div id="jitsiMount"></div></section>');
  const ready = await ensureJitsi();
  if (!ready) {
    const directUrl = "https://meet.jit.si/" + encodeURIComponent(room.jitsi_room);
    document.querySelector("#jitsiMount").innerHTML = '<div class="meeting-error"><h2>Open the room directly</h2><p>Your browser blocked the embedded call. The same live camera room can still open securely in Jitsi.</p><a class="btn btn-primary" href="' + directUrl + '" target="_blank" rel="noopener noreferrer">Open camera room</a><p class="form-note">Camera and microphone permissions are controlled by your browser.</p></div>'; return;
  }
  try {
    state.jitsi = new window.JitsiMeetExternalAPI("meet.jit.si", {
      roomName: room.jitsi_room,
      parentNode: document.querySelector("#jitsiMount"),
      width: "100%",
      height: "100%",
      userInfo: { displayName:state.profile.display_name, email:state.user.email },
      configOverwrite: {
        prejoinPageEnabled: true,
        startWithAudioMuted: true,
        startWithVideoMuted: true,
        disableDeepLinking: true,
        enableWelcomePage: false
      },
      interfaceConfigOverwrite: { MOBILE_APP_PROMO:false, SHOW_JITSI_WATERMARK:false }
    });
    state.jitsi.addListener("videoConferenceJoined", function () {
      const status = document.querySelector("#meetingStatus"); if (status) status.textContent = "Connected · media is controlled inside the call";
      trackPresence(room, isPrivate);
    });
    state.jitsi.addListener("readyToClose", leaveMeeting);
    state.jitsi.addListener("cameraError", function () { showToast("Camera access failed. Check your browser permission and device settings.", true); });
    state.jitsi.addListener("micError", function () { showToast("Microphone access failed. Check your browser permission and device settings.", true); });
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
  if (room) await mountMeeting(room, true);
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

function checkout(interval) {
  const url = CHECKOUT_URLS[interval];
  if (!url) {
    showModal("Apple Pay–ready checkout", '<p>The membership design and secure plan rules are ready. To take real payments, the site owner must connect a Stripe account and create the three recurring prices.</p><p>After connection, Stripe Checkout can show Apple Pay automatically on eligible Apple devices.</p><div class="card"><strong>Selected plan</strong><p>' + (interval === "week" ? "$3.99 weekly" : interval === "month" ? "$14 monthly" : "$160 yearly") + '</p></div><button class="btn btn-primary" data-close-modal>Got it</button>');
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
  if (target.dataset.view) { state.view = target.dataset.view; state.mobileNav = false; renderApp(); }
  if (target.dataset.joinRoom) await joinPublicRoom(target.dataset.joinRoom);
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
  if (target.dataset.ambient) setAmbient(target.dataset.ambient);
  if (target.dataset.toggleNav !== undefined) { state.mobileNav = !state.mobileNav; renderApp(); }
  if (target.dataset.signout !== undefined) await supabase.auth.signOut();
});

document.addEventListener("change", async function (event) {
  if (event.target.dataset.goalToggle) await toggleGoal(event.target.dataset.goalToggle, event.target.checked);
});

document.addEventListener("submit", async function (event) {
  event.preventDefault();
  const form = event.target;
  if (form.id === "authForm") await handleAuthSubmit(form);
  if (form.id === "goalForm") { const data = new FormData(form); await saveGoal(String(data.get("title")).trim()); }
  if (form.id === "encouragementForm") await submitEncouragement(form);
  if (form.id === "privateRoomForm") await createPrivateRoom(form);
  if (form.id === "profileForm") await saveProfile(form, false);
  if (form.id === "privacyForm") await saveProfile(form, true);
});

window.addEventListener("beforeunload", function () { if (state.presenceChannel) state.presenceChannel.untrack(); stopAmbient(); });

async function init() {
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
