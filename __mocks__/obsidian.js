class Plugin {}

class ItemView {}

class Modal {
  constructor(app) {
    this.app = app;
    this.modalEl = { addClass() {}, querySelector() { return null; } };
    this.contentEl = {};
  }

  setTitle() {}

  open() {}

  close() {}
}

class Notice {
  constructor(message) {
    this.message = message;
  }
}

class Setting {
  constructor(containerEl) {
    this.containerEl = containerEl;
  }

  setName() { return this; }

  setDesc() { return this; }

  setClass() { return this; }

  addButton(callback) {
    callback({
      setButtonText() { return this; },
      setCta() { return this; },
      onClick() { return this; }
    });
    return this;
  }

  addText(callback) {
    callback({
      inputEl: {},
      setPlaceholder() { return this; },
      setValue() { return this; },
      onChange() { return this; }
    });
    return this;
  }

  addTextArea(callback) {
    callback({
      inputEl: {},
      setValue() { return this; }
    });
    return this;
  }

  addDropdown(callback) {
    callback({
      selectEl: {},
      addOption() { return this; },
      setValue() { return this; },
      onChange() { return this; }
    });
    return this;
  }

  addToggle(callback) {
    callback({
      setValue() { return this; },
      onChange() { return this; }
    });
    return this;
  }
}

class PluginSettingTab {}

function setIcon() {}

module.exports = { Plugin, ItemView, Notice, Modal, Setting, PluginSettingTab, setIcon };
