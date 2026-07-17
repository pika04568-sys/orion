function createReaderSession({
  tabId,
  profileIndex,
  incognito = false,
  sourceView = null,
  sourceUrl = "",
  sourceTitle = "",
  snapshot = null,
  snapshotUrl = ""
} = {}) {
  return {
    active: false,
    incognito: !!incognito,
    profileIndex,
    readerView: null,
    snapshot,
    snapshotUrl: snapshot ? (snapshotUrl || snapshot.sourceUrl || "") : "",
    sourceTitle,
    sourceUrl,
    sourceView,
    tabId
  };
}

function attachReaderView(session, readerView) {
  if (!session || typeof session !== "object") return session;
  session.readerView = readerView || null;
  return session;
}

function setReaderSnapshot(session, snapshot, snapshotUrl = "") {
  if (!session || typeof session !== "object") return session;
  session.snapshot = snapshot || null;
  session.snapshotUrl = snapshot ? (snapshotUrl || snapshot.sourceUrl || "") : "";
  return session;
}

function getReaderSnapshot(session, committedUrl = "") {
  if (!session || typeof session !== "object" || !session.snapshot) return null;
  if (typeof committedUrl === "string" && committedUrl && session.snapshotUrl !== committedUrl) return null;
  return session.snapshot;
}

function setSourceState(session, { sourceUrl, sourceTitle } = {}) {
  if (!session || typeof session !== "object") return session;
  if (typeof sourceUrl === "string") session.sourceUrl = sourceUrl;
  if (typeof sourceTitle === "string") session.sourceTitle = sourceTitle;
  return session;
}

function activateReaderSession(session) {
  if (!session || typeof session !== "object") return session;
  session.active = true;
  return session;
}

function deactivateReaderSession(session) {
  if (!session || typeof session !== "object") return session;
  session.active = false;
  return session;
}

function getVisibleView(session) {
  if (!session || typeof session !== "object") return null;
  return session.active ? session.readerView : session.sourceView;
}

function getRestoreState(session) {
  if (!session || typeof session !== "object") return { sourceTitle: "", sourceUrl: "" };
  return {
    sourceTitle: session.sourceTitle || "",
    sourceUrl: session.sourceUrl || ""
  };
}

module.exports = {
  activateReaderSession,
  attachReaderView,
  createReaderSession,
  deactivateReaderSession,
  getReaderSnapshot,
  getRestoreState,
  getVisibleView,
  setReaderSnapshot,
  setSourceState
};
