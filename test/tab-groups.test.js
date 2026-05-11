const test = require("node:test");
const assert = require("node:assert/strict");

const tabGroups = require("../tab-groups");

test("recovery state sanitizes profiles, tabs, groups, and excludes incognito tabs", () => {
  const state = tabGroups.sanitizeRecoveryState({
    profiles: [{
      id: 0,
      name: "Default",
      activeTabId: "tab-2",
      groups: [{ id: "g1", name: "Work", color: "#16a34a", collapsed: true }],
      tabs: [
        { id: "tab-1", url: "chrome://newtab", title: "New Tab", groupId: "g1" },
        { id: "tab-2", url: "https://example.com", title: "Example", groupId: "missing" },
        { id: "private", url: "https://secret.example", title: "Private", incognito: true, groupId: "g1" }
      ]
    }]
  });

  assert.equal(state.version, tabGroups.RECOVERY_VERSION);
  assert.equal(state.profiles.length, 1);
  assert.equal(state.profiles[0].tabs.length, 2);
  assert.equal(state.profiles[0].tabs[0].groupId, "g1");
  assert.equal(Object.hasOwn(state.profiles[0].tabs[1], "groupId"), false);
  assert.equal(state.profiles[0].activeTabId, "tab-2");
  assert.deepEqual(state.profiles[0].groups[0], {
    id: "g1",
    name: "Work",
    color: "#16a34a",
    collapsed: true,
    createdAt: state.profiles[0].groups[0].createdAt
  });
});

test("group operations create, rename, assign, collapse, and delete without closing tabs", () => {
  const groups = [];
  const tabs = [
    { id: "tab-1", url: "chrome://newtab", title: "One" },
    { id: "tab-2", url: "https://example.com", title: "Two" }
  ];

  const group = tabGroups.createGroup(groups, { id: "g1", name: "Work", color: "#0f6bff" });
  groups.push(group);

  assert.equal(tabGroups.assignTabToGroup(tabs, groups, "tab-1", "g1"), true);
  assert.equal(tabs[0].groupId, "g1");
  assert.equal(tabGroups.renameGroup(groups, "g1", "Deep Work"), true);
  assert.equal(groups[0].name, "Deep Work");
  assert.equal(tabGroups.toggleGroupCollapsed(groups, "g1", true), true);
  assert.deepEqual(tabGroups.getVisibleTabIds(tabs, groups, "tab-2"), ["tab-2"]);
  assert.deepEqual(tabGroups.getVisibleTabIds(tabs, groups, "tab-1"), ["tab-1", "tab-2"]);
  assert.equal(tabGroups.deleteGroup(groups, tabs, "g1"), true);
  assert.deepEqual(groups, []);
  assert.equal(Object.hasOwn(tabs[0], "groupId"), false);
  assert.equal(tabs.length, 2);
});

test("on-device AI creates tab groups and sorts tabs by title and URL", () => {
  const groups = [{ id: "old", name: "Old Group", color: "#0f6bff" }];
  const tabs = [
    { id: "tab-1", url: "https://github.com/openai/codex", title: "Codex repository" },
    { id: "tab-2", url: "https://docs.electronjs.org/api/browser-window", title: "BrowserWindow Docs" },
    { id: "tab-3", url: "https://mail.google.com/mail/u/0/#inbox", title: "Inbox" },
    { id: "tab-4", url: "https://github.com/electron/electron", title: "Electron repository" },
    { id: "private", url: "https://github.com/private", title: "Private", incognito: true }
  ];

  const result = tabGroups.createOnDeviceTabGroups(tabs, groups, { createdAt: 123 });

  assert.deepEqual(result, { created: 3, grouped: 4 });
  assert.deepEqual(groups.map((group) => group.name), ["Code", "Docs", "Mail"]);
  assert.deepEqual(tabs.map((tab) => tab.id), ["tab-1", "tab-4", "tab-2", "tab-3", "private"]);
  assert.equal(tabs[0].groupId, groups[0].id);
  assert.equal(tabs[1].groupId, groups[0].id);
  assert.equal(tabs[2].groupId, groups[1].id);
  assert.equal(tabs[3].groupId, groups[2].id);
  assert.equal(Object.hasOwn(tabs[4], "groupId"), false);
});

test("on-device SML fallback groups unknown sites by tab title and URL words", () => {
  assert.equal(tabGroups.inferOnDeviceGroupName({
    title: "Kubernetes rollout patterns for container release safety",
    url: "https://example-one.invalid/posts/rollout-patterns"
  }), "Code");
  assert.equal(tabGroups.inferOnDeviceGroupName({
    title: "Quarterly runway forecast and portfolio review",
    url: "https://example-two.invalid/board-pack"
  }), "Finance");
  assert.equal(tabGroups.inferOnDeviceGroupName({
    title: "Hotel reservation itinerary for Zurich trip",
    url: "https://example-three.invalid/confirmation"
  }), "Travel");
});
