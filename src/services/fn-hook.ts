import { uIOhook, UiohookKey } from "uiohook-napi";
import type { UiohookKeyboardEvent } from "uiohook-napi";
import { systemPreferences } from "electron";
import type { KeyBinding } from "./config.js";
import logger from "./logger.js";

export type FnHookCallbacks = {
  onFnDown: () => void;
  onFnUp: () => void;
};

/**
 * Resolve which UiohookKey codes should trigger "release" for a given modifier/key.
 * Returns an array because left/right variants both count.
 */
function getReleaseCodes(binding: KeyBinding): number[] {
  const codes: number[] = [binding.keycode];

  if (binding.ctrl) {
    codes.push(UiohookKey.Ctrl, UiohookKey.CtrlRight);
  }
  if (binding.shift) {
    codes.push(UiohookKey.Shift, UiohookKey.ShiftRight);
  }
  if (binding.alt) {
    codes.push(UiohookKey.Alt, UiohookKey.AltRight);
  }
  if (binding.meta) {
    codes.push(UiohookKey.Meta, UiohookKey.MetaRight);
  }

  return codes;
}

/**
 * Monitors a configurable key combination globally using uiohook-napi.
 * Triggers onFnDown when all keys are held, onFnUp when any is released.
 */
export class FnHook {
  private active = false;
  private callbacks: FnHookCallbacks;
  private started = false;
  private binding: KeyBinding;
  private releaseCodes: Set<number>;
  private displayName: string;

  constructor(callbacks: FnHookCallbacks, binding: KeyBinding, displayName: string) {
    this.callbacks = callbacks;
    this.binding = binding;
    this.releaseCodes = new Set(getReleaseCodes(binding));
    this.displayName = displayName;
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

      // Check: required modifiers + main key
      if (
        e.keycode === this.binding.keycode &&
        e.ctrlKey === this.binding.ctrl &&
        e.shiftKey === this.binding.shift &&
        e.altKey === this.binding.alt &&
        e.metaKey === this.binding.meta
      ) {
        this.active = true;
        this.callbacks.onFnDown();
      }
    });

    uIOhook.on("keyup", (e: UiohookKeyboardEvent) => {
      if (!this.active) return;

      // Release when any of the bound keys is lifted
      if (this.releaseCodes.has(e.keycode)) {
        this.active = false;
        this.callbacks.onFnUp();
      }
    });

    uIOhook.start();
    this.started = true;
    logger.info({ key: this.displayName }, "Started monitoring key");
  }

  stop(): void {
    if (!this.started) return;
    uIOhook.stop();
    this.started = false;
    this.active = false;
    logger.info("Stopped monitoring key");
  }

  get isFnDown(): boolean {
    return this.active;
  }
}
