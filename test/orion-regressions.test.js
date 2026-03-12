const test = require("node:test");
const assert = require("node:assert/strict");

const appUtils = require("../app-utils");
const tabState = require("../main-tab-state");
const { FakeDocument } = require("../test-support/fake-dom");

test("tab metadata stays in sync for bookmarking after navigation", () => {
  const tabs = [
    { id: "tab-1", url: "https://old.example", title: "Old Title" }
  ];

  appUtils.syncTabRecord(tabs, "tab-1", { url: "https://new.example/path" });
  appUtils.syncTabRecord(tabs, "tab-1", { title: "Fresh Title" });

  assert.deepEqual(appUtils.getActiveTabBookmark(tabs, "tab-1"), {
    url: "https://new.example/path",
    title: "Fresh Title"
  });
});

test("bookmark removal updates the shared bookmark state used by both surfaces", () => {
  const bookmarks = [
    { id: 1, url: "https://remove.example", title: "Remove", target: "bar" },
    { id: 2, url: "https://keep-newtab.example", title: "Keep New Tab", target: "newtab" },
    { id: 3, url: "https://keep-both.example", title: "Keep Both", target: "both" }
  ];

  const updatedBookmarks = appUtils.removeBookmarkById(bookmarks, 1);
  const bookmarksBar = updatedBookmarks.filter((bookmark) => bookmark.target === "bar" || bookmark.target === "both");
  const newTabShortcuts = updatedBookmarks.filter((bookmark) => bookmark.target === "newtab" || bookmark.target === "both");

  assert.deepEqual(updatedBookmarks.map((bookmark) => bookmark.id), [2, 3]);
  assert.deepEqual(bookmarksBar.map((bookmark) => bookmark.id), [3]);
  assert.deepEqual(newTabShortcuts.map((bookmark) => bookmark.id), [2, 3]);
});

test("tab titles render as plain text instead of injected HTML", () => {
  const document = new FakeDocument();
  const injectedTitle = "<img src=x onerror=alert(1)>";

  const { element, titleEl, closeEl } = appUtils.createTabElement(document, {
    id: "tab-1",
    title: injectedTitle
  });

  assert.equal(element.className, "tab");
  assert.equal(element.dataset.id, "tab-1");
  assert.equal(titleEl.textContent, injectedTitle);
  assert.equal(closeEl.textContent, "×");
  assert.equal(element.children.length, 2);
});

test("extension cards render names and descriptions as plain text", () => {
  const document = new FakeDocument();
  const injectedName = "<script>alert('name')</script>";
  const injectedDescription = "<img src=x onerror=alert('desc')>";

  const { card, nameEl, versionEl, descriptionEl, removeBtn } = appUtils.createExtensionCard(document, {
    name: injectedName,
    version: "1.2.3",
    description: injectedDescription
  });

  assert.equal(card.className, "extension-card");
  assert.equal(nameEl.textContent, injectedName);
  assert.equal(versionEl.textContent, "v1.2.3");
  assert.equal(descriptionEl.textContent, injectedDescription);
  assert.equal(removeBtn.textContent, "Remove");
});

test("main-process tab records update before tab switch payloads are emitted", () => {
  const profileTabs = [
    { id: "tab-1", url: "https://old.example", title: "Old Title" }
  ];

  const navigatedTab = tabState.updateTabOnNavigate(profileTabs, "tab-1", "file:///tmp/extensions.html");
  assert.equal(navigatedTab.url, "chrome://extensions");
  assert.equal(profileTabs[0].url, "chrome://extensions");

  const titledTab = tabState.updateTabOnTitle(profileTabs, "tab-1", "Updated Title", "https://new.example");
  assert.equal(titledTab.url, "https://new.example");
  assert.equal(titledTab.title, "Updated Title");

  const payload = tabState.buildTabSwitchPayload(
    profileTabs,
    "tab-1",
    "https://final.example",
    "Final Title"
  );

  assert.deepEqual(payload, {
    tabId: "tab-1",
    url: "https://final.example",
    title: "Final Title"
  });
  assert.equal(profileTabs[0].url, "https://final.example");
  assert.equal(profileTabs[0].title, "Final Title");
});
