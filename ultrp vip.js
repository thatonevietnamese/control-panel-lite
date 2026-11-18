// ==UserScript==
// @name         Ultra Popup Blocker
// @description  Configurable popup blocker that blocks window.open by default.
// @author       khanh
// @version      1.0.0
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// @grant        GM.listValues
// @grant        GM.registerMenuCommand
// ==/UserScript==

'use strict';

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const CONSTANTS = Object.freeze({
  TIMEOUT_SECONDS: 15,
  TRUNCATE_LENGTH: 180,
  STORAGE_PREFIX: 'upb:trusted:',
  LOG_PREFIX: '[UPB]'
});

/* -------------------------------------------------------------------------- */
/* Page window and original window.open                                       */
/* -------------------------------------------------------------------------- */

// unsafeWindow is explicitly granted in the userscript metadata.
// The fallback is useful in managers/environments that expose the page window
// directly, while keeping the script from failing during initialization.
const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
const realWindowOpen = typeof pageWindow.open === 'function' ? pageWindow.open : null;
const gm = typeof GM !== 'undefined' ? GM : null;

function createFakeWindow() {
  // A blocked popup does not create a real browsing context. Return a fresh,
  // harmless stand-in for each call so one website cannot mutate a shared one.
  const fakeLocation = {
    href: 'about:blank',
    assign() {},
    replace() {},
    reload() {}
  };

  return {
    closed: true,
    opener: null,
    name: '',
    location: fakeLocation,
    focus() {},
    blur() {},
    close() {},
    postMessage() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return false; },
    toString() { return '[object Window]'; }
  };
}

/* -------------------------------------------------------------------------- */
/* Storage and hostname management                                            */
/* -------------------------------------------------------------------------- */

class DomainManager {
  static getCurrentHostname() {
    return this.normalizeHostname(pageWindow.location.hostname);
  }

  /**
   * Normalize one hostname without guessing its registrable/root domain.
   *
   * Deliberately use exact hostnames for trust decisions. Deriving eTLD+1 by
   * taking the final two labels is unsafe for suffixes such as co.uk, and a
   * partial Public Suffix List can also produce false trust matches. With an
   * exact-host whitelist, example.com and shop.example.com are separate.
   */
  static normalizeHostname(value) {
    if (typeof value !== 'string') return '';

    const candidate = value.trim().toLowerCase().replace(/\.$/, '');
    if (!candidate || /[\s/@?#]/.test(candidate)) return '';

    try {
      const parsed = new URL(`http://${candidate}`);
      const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');

      // Reject values that URL() interpreted as a URL with credentials,
      // a port, a path, a query or a fragment rather than a hostname.
      if (!hostname) return '';
      if (parsed.username || parsed.password || parsed.port) return '';
      if (parsed.pathname !== '/' || parsed.search || parsed.hash) return '';
      if (hostname !== candidate) return '';

      return hostname;
    } catch (error) {
      return '';
    }
  }

  static storageKey(hostname) {
    return `${CONSTANTS.STORAGE_PREFIX}${encodeURIComponent(hostname)}`;
  }

  static async assertStorageAvailable() {
    if (!gm ||
        typeof gm.getValue !== 'function' ||
        typeof gm.setValue !== 'function' ||
        typeof gm.deleteValue !== 'function' ||
        typeof gm.listValues !== 'function') {
      throw new Error('Userscript storage API is unavailable. Check the GM grants and manager version.');
    }
  }

  static async isCurrentDomainTrusted() {
    await this.assertStorageAvailable();
    const hostname = this.getCurrentHostname();
    if (!hostname) return false;
    return Boolean(await gm.getValue(this.storageKey(hostname), false));
  }

  static async addTrustedDomain(hostname = this.getCurrentHostname()) {
    await this.assertStorageAvailable();
    const normalized = this.normalizeHostname(hostname);
    if (!normalized) throw new Error('Invalid hostname; it was not added to the whitelist.');
    await gm.setValue(this.storageKey(normalized), true);
    return normalized;
  }

  static async removeTrustedDomain(hostname) {
    await this.assertStorageAvailable();
    const normalized = this.normalizeHostname(hostname);
    if (!normalized) return;
    await gm.deleteValue(this.storageKey(normalized));
  }

  static async getTrustedDomains() {
    await this.assertStorageAvailable();
    const keys = await gm.listValues();
    const domains = [];

    for (const key of keys) {
      if (!key.startsWith(CONSTANTS.STORAGE_PREFIX)) continue;

      const encodedHostname = key.slice(CONSTANTS.STORAGE_PREFIX.length);
      let hostname = '';

      try {
        hostname = decodeURIComponent(encodedHostname);
      } catch (error) {
        continue;
      }

      const normalized = this.normalizeHostname(hostname);
      if (normalized) domains.push(normalized);
    }

    return [...new Set(domains)].sort((a, b) => a.localeCompare(b));
  }

  /**
   * Migrate the old v4.1 storage format, where the hostname itself was the key.
   * Only keys that look exactly like hostnames AND have a boolean true value
   * are migrated. Other userscript values are left untouched.
   */
  static async migrateLegacyValues() {
    await this.assertStorageAvailable();
    const keys = await gm.listValues();

    for (const key of keys) {
      if (key.startsWith(CONSTANTS.STORAGE_PREFIX)) continue;

      const hostname = this.normalizeHostname(key);
      if (!hostname || hostname !== key.toLowerCase()) continue;

      try {
        const oldValue = await gm.getValue(key, false);
        if (oldValue === true) {
          await gm.setValue(this.storageKey(hostname), true);
          await gm.deleteValue(key);
          console.info(`${CONSTANTS.LOG_PREFIX} Migrated trusted host: ${hostname}`);
        }
      } catch (error) {
        console.warn(`${CONSTANTS.LOG_PREFIX} Could not migrate legacy key:`, key, error);
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* UI                                                                         */
/* -------------------------------------------------------------------------- */

class UIComponents {
  static host = null;
  static shadowRoot = null;
  static notificationElements = null;
  static modalElements = null;

  static ensureRoot() {
    if (this.shadowRoot) {
      this.mountHostIfNeeded();
      return this.shadowRoot;
    }

    const host = document.createElement('div');
    host.id = 'upb-shadow-host';
    host.style.cssText = [
      'all: initial !important',
      'position: fixed !important',
      'inset: 0 !important',
      'width: 0 !important',
      'height: 0 !important',
      'z-index: 2147483647 !important',
      'pointer-events: none !important'
    ].join(';');

    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      *, *::before, *::after { box-sizing: border-box; }
      button, input { font: inherit; }
      button { cursor: pointer; }
      [hidden] { display: none !important; }

      #upb-notification-bar {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        width: 100%;
        padding: 12px 16px;
        color: #f8fafc;
        background: #111827;
        border-top: 2px solid #64748b;
        box-shadow: 0 -3px 18px rgba(0,0,0,.28);
        font: 14px/1.45 Arial, sans-serif;
        pointer-events: auto;
      }
      #upb-message { min-width: 0; flex: 1 1 auto; }
      #upb-count { display: block; font-weight: 700; margin-bottom: 3px; }
      #upb-url {
        display: block;
        max-width: 100%;
        overflow: hidden;
        color: #fde68a;
        white-space: nowrap;
        text-overflow: ellipsis;
        overflow-wrap: anywhere;
      }
      #upb-actions { display: flex; flex: 0 0 auto; flex-wrap: wrap; gap: 7px; align-items: center; }
      .upb-button {
        border: 1px solid rgba(255,255,255,.25);
        border-radius: 5px;
        padding: 7px 10px;
        color: #fff;
        font: 600 13px/1.2 Arial, sans-serif;
        background: #374151;
      }
      .upb-button:hover { filter: brightness(1.15); }
      .upb-allow { background: #15803d; }
      .upb-trust { background: #1d4ed8; }
      .upb-deny { background: #b91c1c; }
      .upb-config { background: #c2410c; }

      #upb-modal-overlay {
        position: fixed;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 18px;
        background: rgba(0,0,0,.58);
        pointer-events: auto;
        font: 14px/1.5 Arial, sans-serif;
      }
      #upb-modal {
        display: flex;
        flex-direction: column;
        width: min(460px, 100%);
        max-height: min( min(720px, 90vh), 90dvh );
        overflow: hidden;
        color: #111827;
        background: #fff;
        border: 1px solid #111827;
        border-radius: 9px;
        box-shadow: 0 12px 40px rgba(0,0,0,.4);
      }
      #upb-modal-header { padding: 18px 20px 14px; color: #fff; background: #111827; }
      #upb-modal-title { margin: 0; font-size: 20px; line-height: 1.25; }
      #upb-modal-subtitle { margin: 7px 0 0; color: #d1d5db; font-size: 13px; }
      #upb-domains-list {
        min-height: 70px;
        overflow: auto;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .upb-domain-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 11px 14px 11px 20px;
        border-bottom: 1px solid #e5e7eb;
        overflow-wrap: anywhere;
      }
      .upb-domain-name { min-width: 0; }
      .upb-remove {
        flex: 0 0 auto;
        min-width: 34px;
        padding: 5px 9px;
        border: 0;
        border-radius: 5px;
        color: #991b1b;
        background: #fee2e2;
        font-size: 19px;
        line-height: 1;
      }
      .upb-empty { margin: 0; padding: 22px 20px; color: #4b5563; }
      #upb-modal-footer {
        display: flex;
        justify-content: flex-end;
        padding: 12px 16px;
        background: #f3f4f6;
      }
      #upb-close-modal { padding: 8px 16px; border: 0; border-radius: 5px; color: #fff; background: #111827; }
      #upb-modal-error { margin: 0; padding: 8px 20px; color: #991b1b; background: #fef2f2; }

      @media (max-width: 650px) {
        #upb-notification-bar { align-items: stretch; flex-direction: column; gap: 9px; padding: 10px; }
        #upb-actions { justify-content: flex-start; }
        .upb-button { flex: 1 1 auto; }
      }
    `;
    shadow.appendChild(style);

    this.host = host;
    this.shadowRoot = shadow;
    this.mountHostIfNeeded();

    // At document-start the documentElement is normally available. Keep this
    // fallback for unusual document timing so the UI can still be mounted.
    if (!host.isConnected) {
      document.addEventListener('DOMContentLoaded', () => this.mountHostIfNeeded(), { once: true });
    }

    return shadow;
  }

  static mountHostIfNeeded() {
    if (!this.host || this.host.isConnected) return;
    const parent = document.documentElement || document.body;
    if (parent) parent.appendChild(this.host);
  }

  static createButton(label, className, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `upb-button ${className || ''}`;
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  static createNotificationElements() {
    const root = this.ensureRoot();
    if (this.notificationElements) return this.notificationElements;

    const bar = document.createElement('section');
    bar.id = 'upb-notification-bar';
    bar.hidden = true;
    bar.setAttribute('role', 'status');
    bar.setAttribute('aria-live', 'polite');

    const message = document.createElement('div');
    message.id = 'upb-message';

    const count = document.createElement('span');
    count.id = 'upb-count';
    count.textContent = 'Ultra Popup Blocker: 0 popup(s) blocked';

    const url = document.createElement('span');
    url.id = 'upb-url';
    url.textContent = '';

    message.append(count, url);

    const actions = document.createElement('div');
    actions.id = 'upb-actions';

    bar.append(message, actions);
    root.appendChild(bar);

    this.notificationElements = { bar, count, url, actions };
    return this.notificationElements;
  }

  static createModalElements() {
    const root = this.ensureRoot();
    if (this.modalElements) return this.modalElements;

    const overlay = document.createElement('div');
    overlay.id = 'upb-modal-overlay';
    overlay.hidden = true;

    const modal = document.createElement('section');
    modal.id = 'upb-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'upb-modal-title');

    const header = document.createElement('header');
    header.id = 'upb-modal-header';

    const title = document.createElement('h2');
    title.id = 'upb-modal-title';
    title.textContent = 'Ultra Popup Blocker';

    const subtitle = document.createElement('p');
    subtitle.id = 'upb-modal-subtitle';
    subtitle.textContent = 'Trusted hostnames (exact matches only):';
    header.append(title, subtitle);

    const error = document.createElement('p');
    error.id = 'upb-modal-error';
    error.hidden = true;

    const list = document.createElement('ul');
    list.id = 'upb-domains-list';

    const footer = document.createElement('footer');
    footer.id = 'upb-modal-footer';

    const close = document.createElement('button');
    close.id = 'upb-close-modal';
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', () => { overlay.hidden = true; });
    footer.appendChild(close);

    modal.append(header, error, list, footer);
    overlay.appendChild(modal);
    root.appendChild(overlay);

    this.modalElements = { overlay, error, list, close };
    return this.modalElements;
  }
}

/* -------------------------------------------------------------------------- */
/* Trusted domains modal                                                      */
/* -------------------------------------------------------------------------- */

class TrustedDomainsModal {
  constructor() {
    this.elements = UIComponents.createModalElements();
  }

  async show() {
    this.elements.overlay.hidden = false;
    await this.refreshDomainsList();
  }

  hide() {
    this.elements.overlay.hidden = true;
  }

  showError(message) {
    this.elements.error.textContent = message;
    this.elements.error.hidden = false;
  }

  clearError() {
    this.elements.error.textContent = '';
    this.elements.error.hidden = true;
  }

  async refreshDomainsList() {
    const list = this.elements.list;
    list.replaceChildren();
    this.clearError();

    try {
      const trustedDomains = await DomainManager.getTrustedDomains();

      if (trustedDomains.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'upb-empty';
        empty.textContent = 'No trusted websites yet.';
        list.appendChild(empty);
        return;
      }

      for (const hostname of trustedDomains) {
        const item = document.createElement('li');
        item.className = 'upb-domain-item';

        const name = document.createElement('span');
        name.className = 'upb-domain-name';
        name.textContent = hostname;

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'upb-remove';
        remove.textContent = '×';
        remove.title = `Remove ${hostname} from trusted hosts`;
        remove.setAttribute('aria-label', `Remove ${hostname}`);
        remove.addEventListener('click', async () => {
          remove.disabled = true;
          try {
            await DomainManager.removeTrustedDomain(hostname);
            await this.refreshDomainsList();
            PopupBlocker.initialize();
          } catch (error) {
            remove.disabled = false;
            this.showError(`Could not remove ${hostname}: ${error.message || error}`);
          }
        });

        item.append(name, remove);
        list.appendChild(item);
      }
    } catch (error) {
      this.showError(`Could not load trusted hosts: ${error.message || error}`);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Notification bar                                                           */
/* -------------------------------------------------------------------------- */

class NotificationBar {
  constructor() {
    this.elements = UIComponents.createNotificationElements();
    this.timeLeft = CONSTANTS.TIMEOUT_SECONDS;
    this.denyIntervalId = null;

    const { actions } = this.elements;
    actions.replaceChildren();

    actions.append(
      UIComponents.createButton('🟢 Allow Once', 'upb-allow', () => PopupBlocker.allowOne()),
      UIComponents.createButton('🔵 Always Allow', 'upb-trust', () => PopupBlocker.alwaysAllow()),
      UIComponents.createButton('🔴 Deny (15)', 'upb-deny', () => PopupBlocker.denyAll()),
      UIComponents.createButton('🟠 Config', 'upb-config', () => new TrustedDomainsModal().show())
    );

    this.denyButton = actions.querySelector('.upb-deny');
  }

  show(url, pendingCount) {
    this.elements.bar.hidden = false;
    this.update(url, pendingCount);
    this.startDenyTimeout();
  }

  update(url, pendingCount) {
    this.elements.count.textContent =
      `Ultra Popup Blocker: ${pendingCount} popup(s) waiting for your decision`;

    const displayUrl = this.truncate(String(url || '(empty URL)'));
    this.elements.url.textContent = displayUrl;
    this.elements.url.title = String(url || '(empty URL)');
  }

  truncate(value) {
    if (value.length <= CONSTANTS.TRUNCATE_LENGTH) return value;
    return `${value.slice(0, CONSTANTS.TRUNCATE_LENGTH - 1)}…`;
  }

  startDenyTimeout() {
    this.clearDenyTimeout();
    this.timeLeft = CONSTANTS.TIMEOUT_SECONDS;
    this.updateDenyButtonText();

    this.denyIntervalId = setInterval(() => {
      this.timeLeft -= 1;
      this.updateDenyButtonText();

      if (this.timeLeft <= 0) {
        this.clearDenyTimeout();
        PopupBlocker.denyAll();
      }
    }, 1000);
  }

  updateDenyButtonText() {
    if (this.denyButton) this.denyButton.textContent = `🔴 Deny (${this.timeLeft})`;
  }

  clearDenyTimeout() {
    if (this.denyIntervalId !== null) {
      clearInterval(this.denyIntervalId);
      this.denyIntervalId = null;
    }
  }

  hide() {
    this.clearDenyTimeout();
    this.elements.bar.hidden = true;
  }
}

/* -------------------------------------------------------------------------- */
/* Popup blocker                                                              */
/* -------------------------------------------------------------------------- */

class PopupBlocker {
  static trusted = false;
  static pendingPopups = [];
  static notification = null;
  static wrapper = null;
  static refreshPromise = null;

  static initialize() {
    this.installHook();
    // Install the hook immediately. Storage checks run asynchronously, and
    // unknown trust state fails closed (popups remain blocked until confirmed).
    void this.refreshTrustState();
  }

  static installHook() {
    if (!realWindowOpen) {
      console.warn(`${CONSTANTS.LOG_PREFIX} window.open is unavailable; blocker could not be installed.`);
      return;
    }

    if (!this.wrapper) {
      this.wrapper = function (...args) {
        if (PopupBlocker.trusted) {
          return Reflect.apply(realWindowOpen, this, args);
        }
        return PopupBlocker.blockPopup(args);
      };
    }

    // Reinstall the same wrapper if the page or another script replaced it.
    // Do not replace the saved native function, so repeated initialization is
    // safe and does not create a chain of nested blockers.
    if (pageWindow.open !== this.wrapper) {
      try {
        pageWindow.open = this.wrapper;
      } catch (error) {
        console.error(`${CONSTANTS.LOG_PREFIX} Could not replace window.open:`, error);
      }
    }
  }

  static async refreshTrustState() {
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = (async () => {
      try {
        await DomainManager.migrateLegacyValues();
        this.trusted = await DomainManager.isCurrentDomainTrusted();

        if (this.trusted) {
          console.info(`${CONSTANTS.LOG_PREFIX} Trusted hostname: ${DomainManager.getCurrentHostname()}`);
        }
      } catch (error) {
        // Fail closed if storage is unavailable or corrupt.
        this.trusted = false;
        console.warn(`${CONSTANTS.LOG_PREFIX} Could not read whitelist; popup blocking remains enabled.`, error);
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  static blockPopup(args) {
    const requestArgs = Array.from(args);
    const rawUrl = requestArgs.length > 0 && requestArgs[0] != null
      ? String(requestArgs[0])
      : 'about:blank';

    this.pendingPopups.push({ args: requestArgs, url: rawUrl });

    if (!this.notification) this.notification = new NotificationBar();

    // Every new request refreshes the visible count and the 15-second decision
    // timer. Buttons are built once, not appended again for every popup.
    this.notification.show(rawUrl, this.pendingPopups.length);
    console.info(`${CONSTANTS.LOG_PREFIX} Popup blocked:`, rawUrl);

    return createFakeWindow();
  }

  static openRequest(request) {
    if (!request || !realWindowOpen) return null;

    try {
      // Preserve the original argument list: URL, target and window features.
      // This method is called directly from a real button click, so the browser
      // has the best available chance to treat it as a user-initiated opening.
      return Reflect.apply(realWindowOpen, pageWindow, request.args);
    } catch (error) {
      console.warn(`${CONSTANTS.LOG_PREFIX} Could not open allowed popup:`, error);
      return null;
    }
  }

  static allowOne() {
    const request = this.pendingPopups.shift();
    if (request) this.openRequest(request);

    if (this.pendingPopups.length === 0) {
      if (this.notification) this.notification.hide();
      return;
    }

    const latest = this.pendingPopups[this.pendingPopups.length - 1];
    this.notification.update(latest.url, this.pendingPopups.length);
  }

  static alwaysAllow() {
    const hostname = DomainManager.getCurrentHostname();
    const requests = this.pendingPopups.splice(0);

    // Open synchronously before awaiting storage. Awaiting first would usually
    // lose the browser's transient user-activation permission for popups.
    this.trusted = true;
    for (const request of requests) this.openRequest(request);

    if (this.notification) this.notification.hide();

    void DomainManager.addTrustedDomain(hostname).then(() => {
      console.info(`${CONSTANTS.LOG_PREFIX} Added trusted hostname: ${hostname}`);
    }).catch(error => {
      // The current tab stays trusted for this session, but a reload will block
      // again because persistence failed.
      console.error(`${CONSTANTS.LOG_PREFIX} Could not save trusted hostname:`, error);
    });
  }

  static denyAll() {
    this.pendingPopups.length = 0;
    if (this.notification) this.notification.hide();
    // The wrapper remains installed; the next popup is blocked normally.
  }
}

/* -------------------------------------------------------------------------- */
/* Menu command and initialization                                            */
/* -------------------------------------------------------------------------- */

try {
  if (gm && typeof gm.registerMenuCommand === 'function') {
    gm.registerMenuCommand('Ultra Popup Blocker: Trusted hosts', () => {
      void new TrustedDomainsModal().show();
    });
  }
} catch (error) {
  console.warn(`${CONSTANTS.LOG_PREFIX} Could not register menu command:`, error);
}

// Initialize immediately rather than waiting only for window 'load'. A script
// injected after load therefore still installs the blocker correctly.
PopupBlocker.initialize();
