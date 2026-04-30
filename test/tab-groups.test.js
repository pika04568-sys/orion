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
