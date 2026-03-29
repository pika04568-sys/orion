const test = require("node:test");
const assert = require("node:assert/strict");

const readerSession = require("../reader-session");

test("reader sessions switch between source and reader views without losing restore state", () => {
  const sourceView = { name: "source" };
  const readerView = { name: "reader" };
  const session = readerSession.createReaderSession({
    tabId: "tab-1",
    profileIndex: 0,
    incognito: false,
    sourceView,
    sourceUrl: "https://example.com/story",
    sourceTitle: "Story"
  });

  readerSession.attachReaderView(session, readerView);
  assert.equal(readerSession.getVisibleView(session), sourceView);

  readerSession.activateReaderSession(session);
  assert.equal(readerSession.getVisibleView(session), readerView);
  assert.deepEqual(readerSession.getRestoreState(session), {
    sourceTitle: "Story",
    sourceUrl: "https://example.com/story"
  });

  readerSession.deactivateReaderSession(session);
  assert.equal(readerSession.getVisibleView(session), sourceView);
});
