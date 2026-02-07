import iohook from "iohook-macos";

export type FnHookCallbacks = {
  onFnDown: () => void;
  onFnUp: () => void;
};

/**
 * Monitors the Fn key globally using iohook-macos.
 * Detects Fn press/release via flagsChanged events and modifier state.
 */
export class FnHook {
  private fnDown = false;
  private callbacks: FnHookCallbacks;
  private started = false;

  constructor(callbacks: FnHookCallbacks) {
    this.callbacks = callbacks;
  }

  start(): void {
    if (this.started) return;

    const perms = iohook.checkAccessibilityPermissions();
    if (!perms.hasPermissions) {
      console.log(
        "[FnHook] Accessibility permissions not granted. Requesting..."
      );
      iohook.requestAccessibilityPermissions();
      throw new Error(
        "Accessibility permissions required. Please grant access in System Preferences > Privacy & Security > Accessibility, then restart the app."
      );
    }

    // Only listen to keyboard events (flagsChanged is type 12)
    iohook.setEventFilter({
      filterByEventType: true,
      allowKeyboard: true,
      allowMouse: false,
      allowScroll: false,
    });

    iohook.enablePerformanceMode();

    // flagsChanged fires when any modifier key state changes (including Fn)
    iohook.on("flagsChanged", (event) => {
      const fnNow = event.modifiers.fn;
      if (fnNow && !this.fnDown) {
        this.fnDown = true;
        this.callbacks.onFnDown();
      } else if (!fnNow && this.fnDown) {
        this.fnDown = false;
        this.callbacks.onFnUp();
      }
    });

    iohook.startMonitoring();
    this.started = true;
    console.log("[FnHook] Started monitoring Fn key");
  }

  stop(): void {
    if (!this.started) return;
    iohook.stopMonitoring();
    this.started = false;
    this.fnDown = false;
    console.log("[FnHook] Stopped monitoring");
  }

  get isFnDown(): boolean {
    return this.fnDown;
  }
}
