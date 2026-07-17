const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");

test("new-tab card-orb animations pause while hidden and resume only when ready", () => {
  const html = fs.readFileSync(path.join(projectRoot, "newtab.html"), "utf8");

  assert.match(html, /body\.effects-paused \.card-orbs span\s*\{[^}]*animation-play-state:\s*paused/s);
  assert.match(html, /body\.effects-ready:not\(\.effects-paused\) \.card-orbs span\s*\{[^}]*animation-play-state:\s*running/s);
  assert.doesNotMatch(html, /\.card-orb(?!s)/);
});

test("deferred panel initialization completes before painted readiness is signaled", () => {
  const source = fs.readFileSync(path.join(projectRoot, "renderer.js"), "utf8");
  const ensureStart = source.indexOf("function ensurePanelInitialized");
  const ensureEnd = source.indexOf("function cancelPanelPaintSignal", ensureStart);
  const ensureSource = source.slice(ensureStart, ensureEnd);

  assert.ok(ensureSource.indexOf("mountDeferredPanel(panel)") < ensureSource.indexOf("initializer()"));
  assert.ok(ensureSource.indexOf("initializer()") < ensureSource.indexOf("panel.dataset.initialized = 'true'"));
  assert.match(source, /requestAnimationFrame\(\(\) => \{\s*requestAnimationFrame\(\(\) => \{/);
  assert.match(source, /panel\.dataset\.orionPanelReady = 'true'/);
  assert.match(source, /performance\.mark\(`orion-panel-ready:\$\{panel\.id\}`\)/);
});

test("hidden panel bodies remain inert until the panel registry mounts them", () => {
  const html = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");
  const source = fs.readFileSync(path.join(projectRoot, "renderer.js"), "utf8");

  assert.equal((html.match(/<template data-panel-template>/g) || []).length, 6);
  assert.match(source, /template\.content\.cloneNode\(true\)/);
  assert.match(source, /template\.remove\(\)/);
  assert.match(source, /panel\.dataset\.mounted = 'true'/);
  assert.match(source, /initializeAdblockPanel\(adblockSidebar\)/);
  assert.match(source, /initializeSettingsPanelActions\(\)/);
});
