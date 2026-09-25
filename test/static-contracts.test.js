import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const config = readFileSync(new URL("../config.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const buddyMigration = readFileSync(new URL("../supabase/migrations/20260925044500_fix_buddy_study_styles.sql", import.meta.url), "utf8");

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
  assert.doesNotMatch(app, /state\.presenceChannel = supabase\.channel\(channelName/);
});
