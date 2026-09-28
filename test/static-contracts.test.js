import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const config = readFileSync(new URL("../config.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const buddyMigration = readFileSync(new URL("../supabase/migrations/20260925044500_fix_buddy_study_styles.sql", import.meta.url), "utf8");
const privacy = readFileSync(new URL("../privacy.html", import.meta.url), "utf8");
const terms = readFileSync(new URL("../terms.html", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../site.webmanifest", import.meta.url), "utf8"));
const socialPreview = readFileSync(new URL("../assets/social-preview.png", import.meta.url));
const appleTouchIcon = readFileSync(new URL("../assets/apple-touch-icon.png", import.meta.url));
const checkoutFunction = readFileSync(new URL("../supabase/functions/create-checkout/index.ts", import.meta.url), "utf8");
const portalFunction = readFileSync(new URL("../supabase/functions/create-portal/index.ts", import.meta.url), "utf8");
const webhookFunction = readFileSync(new URL("../supabase/functions/stripe-webhook/index.ts", import.meta.url), "utf8");
const stripeMigration = readFileSync(new URL("../supabase/migrations/20260928164134_stripe_subscription_sync.sql", import.meta.url), "utf8");
const functionConfig = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8");

test("ships no Jitsi runtime or interface references", () => {
  const shipped = [app, config, html, css].join("\n");
  assert.doesNotMatch(shipped, /jitsi|meet\.jit|external_api/i);
});

test("keeps browser code free of server secrets", () => {
  const shipped = [app, config, html].join("\n");
  assert.doesNotMatch(shipped, /service[_-]?role|sb_secret_/i);
});

test("study-buddy form values match the database contract", () => {
  const expected = ["quiet", "check-ins", "pomodoro", "discussion", "flexible"];
  expected.forEach((style) => {
    assert.match(app, new RegExp('option value="' + style.replace("-", "\\-") + '"'));
    assert.match(buddyMigration, new RegExp("'" + style.replace("-", "\\-") + "'"));
  });
});

test("all production assets use one cache version", () => {
  const versions = Array.from(html.matchAll(/(?:app\.js|styles\.css)\?v=([0-9-]+)/g), (match) => match[1]);
  const imports = Array.from(app.matchAll(/(?:config\.js|rtc-session\.js)\?v=([0-9-]+)/g), (match) => match[1]);
  assert.ok(versions.length >= 2);
  assert.equal(new Set(versions.concat(imports)).size, 1);
});

test("public rooms communicate open entry without confusing rhythm labels", () => {
  assert.match(app, /PUBLIC_STREAM_CIRCLE_SIZE = 6/);
  assert.match(app, /No join limit/i);
  assert.doesNotMatch(app, /preview-status[^\n]*50\/10/);
});

test("top navigation uses a styled accessible SVG chat control", () => {
  assert.match(app, /class="chat-launch/);
  assert.match(app, /const chatLabel = state\.chatMenuOpen \? "Close chats" : "Open chats"/);
  assert.match(app, /data-toggle-chat aria-label="' \+ chatLabel \+ '" aria-expanded=/);
  assert.match(app, /<svg viewBox="0 0 24 24"/);
  assert.match(css, /\.chat-launch:focus-visible/);
});

test("public occupancy reuses the subscribed count channel", () => {
  assert.match(app, /roomCountReady/);
  assert.match(app, /const readyChannel = state\.roomCountReady\[room\.slug\]/);
  assert.match(app, /member_key:await publicPresenceKey/);
  assert.doesNotMatch(app, /readyChannel\.track\(\{ user_id:/);
  assert.doesNotMatch(app, /state\.presenceChannel = supabase\.channel\(channelName/);
});

test("production legal pages are public, linked, and WebRTC-aware", () => {
  assert.match(app, /href="\.\/privacy\.html"/);
  assert.match(app, /href="\.\/terms\.html"/);
  assert.match(privacy, /Effective September 28, 2026/);
  assert.match(privacy, /WebRTC/);
  assert.match(privacy, /not recorded or stored/i);
  assert.match(terms, /Effective September 28, 2026/);
  assert.match(terms, /Do not record/i);
  assert.doesNotMatch(app, /data-privacy|showPrivacy/);
});

test("Google sign-in uses the official multicolor mark without exposing OAuth secrets", () => {
  assert.match(app, /class="google-auth-icon"/);
  ["#4285F4", "#34A853", "#FBBC05", "#EA4335"].forEach((color) => assert.match(app, new RegExp(color)));
  assert.match(app, />Continue with Google<\/span>/);
  assert.doesNotMatch([app, config, html].join("\n"), /client_secret|GOCSPX-/i);
});

test("social sharing and install metadata use production-sized branded assets", () => {
  assert.match(html, /property="og:image" content="https:\/\/joinfocusroomlive\.live\/assets\/social-preview\.png"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /rel="icon" type="image\/svg\+xml" href="\.\/assets\/favicon\.svg"/);
  assert.match(html, /rel="apple-touch-icon"/);
  assert.match(html, /rel="manifest"/);
  assert.equal(socialPreview.readUInt32BE(16), 1200);
  assert.equal(socialPreview.readUInt32BE(20), 630);
  assert.equal(appleTouchIcon.readUInt32BE(16), 180);
  assert.equal(appleTouchIcon.readUInt32BE(20), 180);
  assert.equal(manifest.name, "Mellow Commons");
  assert.equal(manifest.icons.length, 2);
});

test("Stripe billing stays server-side and derives entitlements from signed webhooks", () => {
  assert.match(app, /supabase\.functions\.invoke\("create-checkout"/);
  assert.match(app, /supabase\.functions\.invoke\("create-portal"/);
  assert.doesNotMatch([app, config, html].join("\n"), /sk_(?:test|live)_|whsec_|STRIPE_SECRET_KEY|SERVICE_ROLE/i);
  assert.match(checkoutFunction, /client_reference_id: user\.id/);
  assert.match(checkoutFunction, /subscription_data:/);
  assert.match(portalFunction, /billingPortal\.sessions\.create/);
  assert.match(webhookFunction, /req\.text\(\)/);
  assert.match(webhookFunction, /constructEventAsync/);
  assert.match(webhookFunction, /sync_stripe_subscription/);
  assert.match(stripeMigration, /to service_role/);
  assert.match(stripeMigration, /revoke all on function public\.sync_stripe_subscription[\s\S]*from public, anon, authenticated/);
  assert.match(functionConfig, /\[functions\.stripe-webhook\][\s\S]*verify_jwt = false/);
});
