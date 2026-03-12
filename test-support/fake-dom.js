class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName || "").toUpperCase();
    this.children = [];
    this.className = "";
    this.dataset = {};
    this.style = {};
    this.textContent = "";
    this.type = "";
    this.parentElement = null;
    this.onclick = null;
    this._listeners = {};
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  addEventListener(type, listener) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(listener);
  }

  dispatchEvent(type, event = {}) {
    const listeners = this._listeners[type] || [];
    listeners.forEach((listener) => listener(event));
    if (type === "click" && typeof this.onclick === "function") this.onclick(event);
  }
}

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(tagName);
  }
}

module.exports = {
  FakeDocument,
  FakeElement
};
