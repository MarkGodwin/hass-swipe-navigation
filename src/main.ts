import { z } from "zod";
import { LogLevel, Logger } from "./logger";
import { exceptions } from "./swipeExceptions";
import { isLessThan2023_4 } from "./versionUtils";


// Console tag
console.info("%c↔️ Swipe navigation ↔️ - VERSION_PLACEHOLDER", "color: #2980b9; font-weight: 700;");


const LOG_TAG = "↔️ Swipe navigation:";


const SwipeNavigationConfigSchema = z.object({
  animate: z
    .union([
      z.literal("none"),
      z.literal("swipe"),
      z.literal("fade"),
      z.literal("flip"),
    ]).optional(),
  animate_duration: z.number().optional(),
  enable: z.boolean().optional(),
  enable_mouse_swipe: z.boolean().optional(),
  logger_level: z
    .union([
      z.literal("verbose"),
      z.literal("debug"),
      z.literal("info"),
      z.literal("warn"),
      z.literal("error")
    ])
    .optional(),
  prevent_default: z.boolean().optional(),
  skip_hidden: z.boolean().optional(),
  skip_tabs: z.coerce.string().optional(),
  swipe_amount: z.number().optional(),
  wrap: z.boolean().optional()
});

type SwipeNavigationConfig = z.infer<typeof SwipeNavigationConfigSchema>;

function instanceOfSwipeNavigationConfig(obj: unknown): obj is SwipeNavigationConfig {
  return SwipeNavigationConfigSchema.safeParse(obj).success;
}

class ConfigObserver {
  callback: () => void;

  constructor(callback: () => void) {
    this.callback = callback;
  }
}

class Config {
  private animate: "none" | "swipe" | "fade" | "flip" = "none";
  private animate_duration = 200;
  private enable = true;
  private enable_mouse_swipe = false;
  // Note that this is the level that is in force before the config is parsed.
  // This means that all logs below this level will be ignored until the config is parsed.
  private logger_level: LogLevel = LogLevel.WARN;
  private prevent_default = false;
  private skip_hidden = true;
  private skip_tabs: readonly number[] = [];
  private swipe_amount = 0.15;
  private wrap = true;

  private static currentConfig: Config = new Config();
  private static rawConfig: unknown | null = null;
  private static configObservers: ConfigObserver[] = [];

  public static current(): Config {
    return Config.currentConfig;
  }

  public static async readAndMonitorConfig() {
    // When changing dashboards and when updating the config via the UI, the hui-root element is
    // replaced. We therefore listen for its changes.
    PageObjectManager.huiRoot.watchChanges({
      onDomNodeRefreshedCallback: () => {
        void Config.readConfig();
      },
      onDomNodeRemovedCallback: null
    });

    await Config.readConfig();
  }

  public static registerConfigObserver(configObserver: ConfigObserver) {
    Config.configObservers.push(configObserver);
  }

  public static unregisterConfigObserver(configObserver: ConfigObserver) {
    const index = Config.configObservers.indexOf(configObserver);
    if (index > -1) {
      Config.configObservers.splice(index, 1);
    } else {
      Logger.loge(LOG_TAG, "Internal error while unregistering a configObserver: not found.");
    }
  }

  public getAnimate(): "none" | "swipe" | "fade" | "flip" {
    return this.animate;
  }

  public getAnimateDuration(): number {
    return this.animate_duration;
  }

  public getEnable(): boolean {
    return this.enable;
  }

  public getEnableMouseSwipe(): boolean {
    return this.enable_mouse_swipe;
  }

  public getLoggerLevel(): LogLevel {
    return this.logger_level;
  }

  public getPreventDefault(): boolean {
    return this.prevent_default;
  }

  public getSkipHidden(): boolean {
    return this.skip_hidden;
  }

  public getSkipTabs(): readonly number[] {
    return this.skip_tabs;
  }

  public getSwipeAmount(): number {
    return this.swipe_amount;
  }

  public getWrap(): boolean {
    return this.wrap;
  }

  private static async readConfig() {
    Logger.logd(LOG_TAG, "Attempting to read config...");

    const rawConfig = await Config.getRawConfigOrNull();

    if (JSON.stringify(rawConfig) == JSON.stringify(Config.rawConfig)) {
      Logger.logd(LOG_TAG, "Config is identical.");
      return;
    }

    // Save the new raw config.
    Config.rawConfig = rawConfig;

    const newConfig = Config.parseConfig(rawConfig);
    if (newConfig == null) {
      // Couldn't parse config, error already logged.
      return;
    }

    if (JSON.stringify(newConfig) == JSON.stringify(Config.currentConfig)) {
      Logger.logd(LOG_TAG, "Config is equivalent.");
      return;
    }

    // Save the new config.
    Config.currentConfig = newConfig;

    // Notify all observers that the config has changed.
    Config.configObservers.forEach((configObserver) => {
      configObserver.callback();
    });
  }

  private static parseConfig(rawConfig: unknown): Config | null {
    if (!instanceOfSwipeNavigationConfig(rawConfig)) {
      Logger.loge(LOG_TAG, "Found invalid configuration.");
      // TODO log why the config is wrong

      return null;
    }

    const newConfig = new Config();

    if (rawConfig.animate != null) { newConfig.animate = rawConfig.animate; }

    if (rawConfig.animate_duration != null) { newConfig.animate_duration = rawConfig.animate_duration; }

    if (rawConfig.enable != null) { newConfig.enable = rawConfig.enable; }

    if (rawConfig.enable_mouse_swipe != null) { newConfig.enable_mouse_swipe = rawConfig.enable_mouse_swipe; }

    switch (rawConfig.logger_level) {
      case "verbose":
        newConfig.logger_level = LogLevel.VERBOSE;
        break;
      case "debug":
        newConfig.logger_level = LogLevel.DEBUG;
        break;
      case "info":
        newConfig.logger_level = LogLevel.INFO;
        break;
      case "warn":
        newConfig.logger_level = LogLevel.WARN;
        break;
      case "error":
        newConfig.logger_level = LogLevel.ERROR;
        break;
      case null:
      case undefined:
        break;
      default: {
        const exhaustiveCheck: never = rawConfig.logger_level;
        throw new Error(`Unhandled case: ${exhaustiveCheck}`);
        break;
      }
    }
    if (rawConfig.prevent_default != null) { newConfig.prevent_default = rawConfig.prevent_default; }
    if (rawConfig.skip_hidden != null) { newConfig.skip_hidden = rawConfig.skip_hidden; }
    if (rawConfig.skip_tabs != undefined) {
      newConfig.skip_tabs =
        String(rawConfig.skip_tabs)
          .replace(/\s+/g, "")
          .split(",")
          .map((item) => { return parseInt(item); });
    }
    if (rawConfig.swipe_amount != null) { newConfig.swipe_amount = rawConfig.swipe_amount / 100.0; }
    if (rawConfig.wrap != null) { newConfig.wrap = rawConfig.wrap; }

    return newConfig;
  }

  /**
   * Tries to get the raw config from the config file until it succeed or until a timeout is
   * reached.
   *
   * @returns the swipe_nav raw config if the section can be read from the config file. An empty
   * object if the swipe_nav section is missing in the config file. `null` if the config file cannot
   * be read.
   */
  private static async getRawConfigOrNull(): Promise<unknown | null> {
    const timeout = new Date(Date.now() + 15 * 1000);  // 15 seconds
    let configContainer = null;

    while (configContainer == null && Date.now() < timeout.getTime()) {
      if (PageObjectManager.haPanelLovelace.getDomNode() != null) {
        configContainer = (
          (
            PageObjectManager.haPanelLovelace.getDomNode() as (
              HTMLElement & { lovelace: undefined | { config: undefined | { swipe_nav: unknown } } }
            )
          )?.lovelace?.config
        ) ?? null;
      }

      if (configContainer == null) {
        await new Promise(resolve => setTimeout(resolve, 1000));  // Sleep 1s
      }
    }

    let rawConfig = null;
    if (configContainer != null) {
      rawConfig = configContainer.swipe_nav ?? {};
    } else {
      Logger.loge(LOG_TAG, "Can't find dashboard configuration");
    }

    return rawConfig;
  }
}

class PageObject {
  #domNode: HTMLElement | null = null;
  #parent: PageObject | HTMLElement | Document;
  #selectors: string[];
  #isSelectorsRootedInShadow: boolean;
  #keepAlive = false;
  #onDomNodeRefreshedCallback: (() => void) | null = null;
  #onDomNodeRemovedCallback: (() => void) | null = null;

  #keepAliveChildren = new Map<PageObject, MutationObserver>();

  constructor(parent: PageObject | HTMLElement | Document, selectors: string[], isSelectorsRootedInShadow: boolean) {
    this.#parent = parent;
    this.#selectors = selectors;
    this.#isSelectorsRootedInShadow = isSelectorsRootedInShadow;
  }

  invalidateDomNode() {
    this.#disconnectAllChildrenObservers();
    if (this.#onDomNodeRemovedCallback != null) {
      this.#onDomNodeRemovedCallback();
    }
    this.#domNode = null;
  }

  watchChanges(callbacks: { onDomNodeRefreshedCallback: (() => void), onDomNodeRemovedCallback: (() => void) | null }) {
    this.#setKeepAlive();
    this.#onDomNodeRefreshedCallback = callbacks.onDomNodeRefreshedCallback;
    this.#onDomNodeRemovedCallback = callbacks.onDomNodeRemovedCallback;
  }

  #setKeepAlive() {
    if (!this.#keepAlive) {
      this.#keepAlive = true;
      this.#ensureKeepAliveWhenNeeded();
    }
  }

  #ensureKeepAliveWhenNeeded() {
    if (this.#keepAlive && this.#parent != null && this.#parent instanceof PageObject) {
      this.#parent.#addPageObjectToKeepAlive(this);
    }
  }

  #addPageObjectToKeepAlive(pageObject: PageObject) {
    if (!(this.#keepAliveChildren.has(pageObject))) {
      this.#keepAliveChildren.set(
        pageObject,
        new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
              Logger.logv(LOG_TAG,
                mutation.addedNodes.length + " new element(s) appeared under \""
                + (this.#domNode?.nodeName?.toLowerCase() ?? "unknown") + "\". Checking..."
              );
              pageObject.getDomNode();
            }
          }
        })
      );

      // Keep alive self since it must be alive to revive its children
      this.#setKeepAlive();

      // Connect child if possible, otherwise it should be reconnected when refreshed.
      this.#connectChildObserver(pageObject);
    }
  }

  getDomNode() {
    // Refresh if object is not in cache
    if (this.#domNode == null) {
      this.#refreshDomNode();
    } else {
      // Stale detection
      if (this.#isStale()) {
        Logger.logd(LOG_TAG, "Stale object in cache: \"" + this.#domNode.nodeName.toLowerCase() + "\". Invalidating...");
        this.invalidateDomNode();
        this.getDomNode();
      }
    }

    return this.#domNode;
  }

  getParentNode() {
    let parentNode: HTMLElement | Document | ShadowRoot | null =
      (this.#parent instanceof PageObject) ?
        this.#parent.getDomNode()
        : this.#parent;

    if (parentNode != null && this.#isSelectorsRootedInShadow) {
      if ("shadowRoot" in parentNode) {
        parentNode = parentNode.shadowRoot;
      } else {
        Logger.loge(LOG_TAG, parentNode.nodeName + " is expected to have a shadowRoot, but it is missing.");
        parentNode = null;
      }
    }

    return parentNode;
  }

  #isStale() {
    return !(this.#domNode?.isConnected ?? false);
  }

  #refreshDomNode() {
    const parentNode = this.getParentNode();

    this.#domNode = (parentNode == null) ?
      null
      : (() => {
        for (const selector of this.#selectors) {
          const node = parentNode.querySelector(selector);
          if (node != null && node instanceof HTMLElement) {
            return node;
          }
        }
        return null;
      })();

    if (this.#domNode != null) {
      Logger.logd(LOG_TAG, "Object refreshed: \"" + (this.#domNode?.nodeName?.toLowerCase() ?? "unknown") + "\".");

      this.#ensureKeepAliveWhenNeeded();
      this.#connectAllChildrenObservers();

      if (this.#onDomNodeRefreshedCallback != null) {
        this.#onDomNodeRefreshedCallback();
      }
    }
  }

  #connectAllChildrenObservers() {
    if (this.#domNode != null && this.#keepAliveChildren.size > 0) {
      Logger.logv(LOG_TAG, "Reconnecting " + this.#keepAliveChildren.size + " observers to " + (this.#domNode?.nodeName?.toLowerCase() ?? "unknown"));

      this.#keepAliveChildren.forEach((value, key) => {
        this.#connectChildObserver(key);
      });
    }
  }

  #connectChildObserver(pageObject: PageObject) {
    if (this.#domNode != null) {
      const observer = this.#keepAliveChildren.get(pageObject);

      // Note: pageObject is a child of this object, so parentNode is this object (with or without
      // the shadowRoot depending on where the child is placed)
      const parentNode = pageObject.getParentNode();

      if (observer == null) {
        Logger.loge(LOG_TAG, "Illegal state: observer is not defined when connecting a child observer.");
      } else if (parentNode == null) {
        Logger.loge(LOG_TAG, "Illegal state: parent is not defined when connecting a child observer.");
      } else {
        observer.observe(parentNode, { childList: true });
      }

      pageObject.getDomNode();
    }
  }

  #disconnectAllChildrenObservers() {
    if (this.#keepAliveChildren.size > 0) {
      Logger.logv(LOG_TAG,
        "Disconnecting " + this.#keepAliveChildren.size + " observers from \""
        + (this.#domNode?.nodeName?.toLowerCase() ?? "unknown") + "\""
      );

      this.#keepAliveChildren.forEach((value) => {
        value.disconnect();
      });
    }
  }
}

class PageObjectManager {
  static ha = new PageObject(
    document,
    ["home-assistant"],
    false,
  );
  static haMain = new PageObject(
    PageObjectManager.ha,
    ["home-assistant-main"],
    true,
  );
  static partialPanelResolver = new PageObject(
    PageObjectManager.haMain,
    ["partial-panel-resolver"],
    true,
  );
  static haPanelLovelace = new PageObject(
    PageObjectManager.partialPanelResolver,
    ["ha-panel-lovelace"],
    false,
  );
  static huiRoot = new PageObject(
    PageObjectManager.haPanelLovelace,
    ["hui-root"],
    true,
  );
  static haAppLayout = new PageObject(
    PageObjectManager.huiRoot,
    [(isLessThan2023_4() ? "ha-app-layout" : "div")],
    true,
  );
  static haAppLayoutView = new PageObject(
    PageObjectManager.haAppLayout,
    ["[id=\"view\"]"],
    false,
  );
  static tabsContainer = new PageObject(
    PageObjectManager.haAppLayout,
    [
      "paper-tabs",  // When in edit mode
      "ha-tabs"  // When in standard mode
    ],
    false,
  );
}

class SwipeManager {
  static #xDown: number | null;
  static #yDown: number | null;
  static #xDiff: number | null;
  static #yDiff: number | null;

  static #pointerEventsAbortController: AbortController | null = null;

  static init() {
    this.#pointerEventsAbortController?.abort();
    this.#pointerEventsAbortController = new AbortController();

    PageObjectManager.haAppLayout.watchChanges({
      onDomNodeRefreshedCallback: () => {
        SwipeManager.init();
      },
      onDomNodeRemovedCallback: null
    });

    const haAppLayoutDomNode = PageObjectManager.haAppLayout.getDomNode();
    if (haAppLayoutDomNode != null) {
      Logger.logd(LOG_TAG, "Initializing SwipeManger...");

      haAppLayoutDomNode.addEventListener(
        "touchstart",
        (event) => { this.#handlePointerStart(event); },
        { signal: this.#pointerEventsAbortController.signal, passive: true }
      );
      haAppLayoutDomNode.addEventListener(
        "touchmove",
        (event) => { this.#handlePointerMove(event); },
        { signal: this.#pointerEventsAbortController.signal, passive: false }
      );
      haAppLayoutDomNode.addEventListener(
        "touchend",
        () => { this.#handlePointerEnd(); },
        { signal: this.#pointerEventsAbortController.signal, passive: true }
      );
      haAppLayoutDomNode.addEventListener(
        "mousedown",
        (event) => { this.#handlePointerStart(event); },
        { signal: this.#pointerEventsAbortController.signal, passive: true }
      );
      if (Config.current().getEnableMouseSwipe()) {
        haAppLayoutDomNode.addEventListener(
          "mousemove",
          (event) => { this.#handlePointerMove(event); },
          { signal: this.#pointerEventsAbortController.signal, passive: false }
        );
        haAppLayoutDomNode.addEventListener(
          "mouseup",
          () => { this.#handlePointerEnd(); },
          { signal: this.#pointerEventsAbortController.signal, passive: true }
        );
      }
    }
  }

  static #handlePointerStart(event: TouchEvent | MouseEvent) {

    let interactionType;
    if (window.TouchEvent != null && event instanceof TouchEvent) {
      interactionType = "touch";
    } else if (event instanceof MouseEvent) {
      interactionType = "click";
    } else {
      const eventCheck/*: never*/ = event; // Firefox doesn't always set TouchEvent type
      throw new Error(`Unhandled case: ${eventCheck}`);
    }

    if (Config.current().getEnable() == false) {
      Logger.logd(LOG_TAG, "Ignoring " + interactionType + ": Swipe navigation is disabled in the config.");
      return; // Ignore swipe: Swipe is disabled in the config
    }

    if (window.TouchEvent != null && event instanceof TouchEvent && event.touches.length > 1) {
      this.#xDown = null;
      this.#yDown = null;
      Logger.logd(LOG_TAG, "Ignoring " + interactionType + ": multiple touchpoints detected.");
      return; // Ignore swipe: Multitouch detected
    } else if (event instanceof MouseEvent && !Config.current().getEnableMouseSwipe()) {
      this.#xDown = null;
      this.#yDown = null;
      Logger.logd(LOG_TAG, "Ignoring " + interactionType + ": swiping via mouse is disabled.");
      return;
    }

    if (typeof event.composedPath() == "object") {
      for (const element of event.composedPath()) {
        if (element instanceof Element) {
          if (element.nodeName == "HUI-VIEW") {
            // hui-view is the root element of the Home Assistant dashboard, so we can stop here.
            break;
          } else {
            if (element.matches && element.matches(exceptions)) {
              Logger.logd(LOG_TAG, "Ignoring " + interactionType + " on \""
                + (element.nodeName != null ? element.nodeName.toLowerCase() : "unknown")
                + "\".");
              return; // Ignore swipe
            }
          }
        }
      }
    }
    if (window.TouchEvent != null && event instanceof TouchEvent) {
      this.#xDown = event.touches[0].clientX;
      this.#yDown = event.touches[0].clientY;
    } else if (event instanceof MouseEvent) {
      this.#xDown = event.clientX;
      this.#yDown = event.clientY;
    } else {
      const eventCheck/*: never*/ = event; // Firefox doesn't always set TouchEvent type
      throw new Error(`Unhandled case: ${eventCheck}`);
    }
  }

  static #handlePointerMove(event: TouchEvent | MouseEvent) {
    if (this.#xDown && this.#yDown) {
      if (window.TouchEvent != null && event instanceof TouchEvent) {
        this.#xDiff = this.#xDown - event.touches[0].clientX;
        this.#yDiff = this.#yDown - event.touches[0].clientY;
      } else if (event instanceof MouseEvent) {
        this.#xDiff = this.#xDown - event.clientX;
        this.#yDiff = this.#yDown - event.clientY;
      } else {
        const eventCheck/*: never*/ = event; // Firefox doesn't always set TouchEvent type
        throw new Error(`Unhandled case: ${eventCheck}`);
      }

      const configAnimate = Config.current().getAnimate();
      const view = PageObjectManager.haAppLayoutView.getDomNode();
      if (view == null) {
        Logger.loge(LOG_TAG, "view is null when attempting to change tab.");
      }
      else if (configAnimate == "swipe") {
        const haAppLayoutDomNode = PageObjectManager.haAppLayout.getDomNode();
        if (haAppLayoutDomNode != null) {
          haAppLayoutDomNode.style.overflow = "hidden";
        }
        let dist = Math.min(Math.abs(this.#xDiff), 250);
        let offset = (dist - (dist * dist)/500)/2;
        
        view.style.transform = `translate(${offset * Math.sign(-this.#xDiff)}px, 0)`;

      }

      if (Math.abs(this.#xDiff) > Math.abs(this.#yDiff) && Config.current().getPreventDefault()) event.preventDefault();
    }
  }

  static #handlePointerEnd() {

    let resetSwipe = true;
    if (this.#xDiff != null && this.#yDiff != null) {
      if (Math.abs(this.#xDiff) < Math.abs(this.#yDiff)) {
        Logger.logd(LOG_TAG, "Swipe ignored, vertical movement.");

      } else {  // Horizontal movement
        if (Math.abs(this.#xDiff) < Math.abs(screen.width * Config.current().getSwipeAmount())) {
          Logger.logd(LOG_TAG, "Swipe ignored, too short.");
    
        } else {
          const directionLeft = this.#xDiff < 0;

          Logger.logi(LOG_TAG, "Swipe detected, changing tab to the " + (directionLeft ? "left" : "right") + ".");

          const rtl = PageObjectManager.ha.getDomNode()?.style.direction == "rtl";
          const nextTabIndex = this.#getNextTabIndex(rtl ? !directionLeft : directionLeft);
          if (nextTabIndex >= 0) {
            resetSwipe = false; // Animate swipe from current offset
            this.#click(nextTabIndex, directionLeft);
          }
        }
      }
    }

    if(resetSwipe)
    {
      const configAnimate = Config.current().getAnimate();
      const view = PageObjectManager.haAppLayoutView.getDomNode();
      if (view != null && configAnimate == "swipe") {
        view.style.transition = `transform 200ms ease-out`;
        const haAppLayoutDomNode = PageObjectManager.haAppLayout.getDomNode();
        if (haAppLayoutDomNode != null) {
          haAppLayoutDomNode.style.overflow = "hidden";
        }
        view.style.transform = `translate(0, 0)`;

      }
    }

    this.#xDown = this.#yDown = this.#xDiff = this.#yDiff = null;
  }

  static #getTabsArray() {
    return Array.from(PageObjectManager.tabsContainer.getDomNode()?.querySelectorAll("paper-tab") ?? []);
  }

  static #getNextTabIndex(directionLeft: boolean) {
    const tabs = this.#getTabsArray();
    const activeTab = PageObjectManager.tabsContainer.getDomNode()?.querySelector(".iron-selected");
    const activeTabIndex = activeTab != null ? tabs.indexOf(activeTab) : -1;
    let nextTabIndex = activeTabIndex;
    let stopReason = null;

    if (activeTabIndex == -1) {
      stopReason = "Can't determine the active tab";

    } else {
      const increment = directionLeft ? -1 : 1;
      do {
        nextTabIndex += increment;

        if (nextTabIndex == -1) {
          nextTabIndex = Config.current().getWrap() ? tabs.length - 1 : -1;
        } else if (nextTabIndex == tabs.length) {
          nextTabIndex = Config.current().getWrap() ? 0 : -1;
        }

        if (nextTabIndex == activeTabIndex) {
          // A complete cycle has been done. Stop to avoid infinite loop.
          stopReason = "Error, no viable tabs found for swiping.";
        } else if (nextTabIndex == -1) {
          stopReason = "Edge has been reached and wrap is disabled.";
        }

      } while (
        // Note: stopReason must be the first condition to short circuit the rest that will probably
        // raise exception due to they dirty state.
        //
        // Cycle if...
        // ...the is no reason to stop and...
        stopReason == null
        && (
          // ...the current tab should be skipped or...
          Config.current().getSkipTabs().includes(nextTabIndex)
          || (
            // ...if skip hidden is enabled and the tab is hidden
            Config.current().getSkipHidden()
            && getComputedStyle(tabs[nextTabIndex], null).display == "none"
          )
        )
      );
    }

    if (stopReason != null) {
      Logger.logw(LOG_TAG, stopReason);
      return -1;
    } else {
      return nextTabIndex;
    }
  }

  static #click(index: number, directionLeft: boolean) {
    if (index < 0) {
      Logger.loge(LOG_TAG, "Invalid tab index: " + index + ".");

    } else {
      const view = PageObjectManager.haAppLayoutView.getDomNode();
      const tabs = this.#getTabsArray();

      if (view == null) {
        Logger.loge(LOG_TAG, "view is null when attempting to change tab.");

      } else {
        const configAnimate = Config.current().getAnimate();
        if (configAnimate == "none") {
          tabs[index].dispatchEvent(new MouseEvent("click", { bubbles: false, cancelable: true }));

        } else {
          const duration = Config.current().getAnimateDuration();
          view.style.transition = `transform ${duration}ms ease-in, opacity ${duration}ms ease-in`;

          if (configAnimate == "swipe") {
            const haAppLayoutDomNode = PageObjectManager.haAppLayout.getDomNode();
            if (haAppLayoutDomNode != null) {
              haAppLayoutDomNode.style.overflow = "hidden";
            }
            const _in = directionLeft ? `${screen.width / 2}px` : `-${screen.width / 2}px`;
            const _out = directionLeft ? `-${screen.width / 2}px` : `${screen.width / 2}px`;
            view.style.opacity = "0";
            view.style.transform = `translate(${_in}, 0)`;
            setTimeout(function () {
              view.style.transition = "";
              view.style.transform = `translate(${_out}, 0)`;
              tabs[index].dispatchEvent(new MouseEvent("click", { bubbles: false, cancelable: true }));
            }, duration + 10);

          } else if (configAnimate == "fade") {
            view.style.opacity = "0";
            setTimeout(function () {
              view.style.transition = "";
              tabs[index].dispatchEvent(new MouseEvent("click", { bubbles: false, cancelable: true }));
              view.style.opacity = "0";
            }, duration + 10);

          } else if (configAnimate == "flip") {
            view.style.transform = "rotatey(90deg)";
            view.style.opacity = "0.25";
            setTimeout(function () {
              view.style.transition = "";
              tabs[index].dispatchEvent(new MouseEvent("click", { bubbles: false, cancelable: true }));
            }, duration + 10);

          } else {
            const exhaustiveCheck: never = configAnimate;
            throw new Error(`Unhandled case: ${exhaustiveCheck}`);
          }

          setTimeout(function () {
            view.style.transition = `transform ${duration}ms ease-out, opacity ${duration}ms ease-out`;
            view.style.opacity = "1";
            view.style.transform = "";
          }, duration + 50);

          if (configAnimate == "swipe") {
            setTimeout(function () {
              const haAppLayoutDomNode = PageObjectManager.haAppLayout.getDomNode();
              if (haAppLayoutDomNode != null) {
                haAppLayoutDomNode.style.overflow = "";
              }
            }, duration * 2 + 100);
          }
        }
      }
    }
  }
}



async function run() {

  Logger.setLoggerLevel(Config.current().getLoggerLevel());
  Config.registerConfigObserver(new ConfigObserver(() => {
    Logger.setLoggerLevel(Config.current().getLoggerLevel());
    Logger.logi(LOG_TAG, "New configuration loaded.");
  }));

  await Config.readAndMonitorConfig();

  SwipeManager.init();
}



// Initial run
void run();
