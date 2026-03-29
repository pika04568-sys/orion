function createReaderSession({
  tabId,
  profileIndex,
  incognito = false,
  sourceView = null,
  sourceUrl = "",
  sourceTitle = "",
  snapshot = null
} = {}) {
  return {
    active: false,
    incognito: !!incognito,
    profileIndex,
    readerView: null,
    snapshot,
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

function setReaderSnapshot(session, snapshot) {
  if (!session || typeof session !== "object") return session;
  session.snapshot = snapshot || null;
  return session;
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
  getRestoreState,
  getVisibleView,
  setReaderSnapshot,
  setSourceState
};
