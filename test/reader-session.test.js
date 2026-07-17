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

test("reader sessions only expose snapshots for the matching committed URL", () => {
  const session = readerSession.createReaderSession({
    tabId: "tab-2",
    sourceUrl: "https://example.com/old"
  });
  const snapshot = { readable: true, sourceUrl: "https://example.com/old", title: "Old" };

  readerSession.setReaderSnapshot(session, snapshot, "https://example.com/old");
  assert.equal(readerSession.getReaderSnapshot(session, "https://example.com/old"), snapshot);
  assert.equal(readerSession.getReaderSnapshot(session, "https://example.com/new"), null);

  readerSession.setReaderSnapshot(session, null);
  assert.equal(readerSession.getReaderSnapshot(session, "https://example.com/old"), null);
  assert.equal(session.snapshotUrl, "");
});
