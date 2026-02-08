import { uIOhook, UiohookKey } from "uiohook-napi";
import type { UiohookKeyboardEvent } from "uiohook-napi";
import { systemPreferences } from "electron";

export type FnHookCallbacks = {
  onFnDown: () => void;
  onFnUp: () => void;
};

// The "I" key code in uiohook-napi
const KEY_I = UiohookKey.I;

/**
 * Monitors Meta+Shift+I globally using uiohook-napi.
 * Triggers onFnDown when all three keys are held, onFnUp when any is released.
 */
export class FnHook {
  private active = false;
  private callbacks: FnHookCallbacks;
  private started = false;

  constructor(callbacks: FnHookCallbacks) {
    this.callbacks = callbacks;
  }

  start(): void {
    if (this.started) return;

    // macOS requires accessibility permissions for global keyboard hooks
    if (process.platform === "darwin") {
      const trusted = systemPreferences.isTrustedAccessibilityClient(true);
      if (!trusted) {
        throw new Error(
          "Accessibility permissions required. Please grant access in System Preferences > Privacy & Security > Accessibility, then restart the app."
        );
      }
    }

    uIOhook.on("keydown", (e: UiohookKeyboardEvent) => {
      if (this.active) return; // already recording, ignore repeats

      // Check: Meta (left or right) + Shift (left or right) + I
      if (e.metaKey && e.shiftKey && e.keycode === KEY_I) {
        this.active = true;
        this.callbacks.onFnDown();
      }
    });

    uIOhook.on("keyup", (e: UiohookKeyboardEvent) => {
      if (!this.active) return;

      // Release when any of the three keys is lifted
      const isRelevantKey =
        e.keycode === KEY_I ||
        e.keycode === UiohookKey.Meta ||
        e.keycode === UiohookKey.MetaRight ||
        e.keycode === UiohookKey.Shift ||
        e.keycode === UiohookKey.ShiftRight;

      if (isRelevantKey) {
        this.active = false;
        this.callbacks.onFnUp();
      }
    });

    uIOhook.start();
    this.started = true;
    console.log("[FnHook] Started monitoring Meta+Shift+I");
  }

  stop(): void {
    if (!this.started) return;
    uIOhook.stop();
    this.started = false;
    this.active = false;
    console.log("[FnHook] Stopped monitoring");
  }

  get isFnDown(): boolean {
    return this.active;
  }
}
