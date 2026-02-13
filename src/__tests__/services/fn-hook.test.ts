import { describe, test, expect, beforeEach, mock } from "bun:test";

// Mock logger
mock.module("../../services/logger.js", () => ({
  default: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}));

// Mock electron
mock.module("electron", () => ({
  systemPreferences: {
    isTrustedAccessibilityClient: mock(() => true),
  },
}));

// Mock uiohook-napi
type KeyCallback = (event: any) => void;
const keydownCallbacks: KeyCallback[] = [];
const keyupCallbacks: KeyCallback[] = [];
let uiohookStarted = false;

const mockUIOhook = {
  on: mock((event: string, cb: KeyCallback) => {
    if (event === "keydown") keydownCallbacks.push(cb);
    if (event === "keyup") keyupCallbacks.push(cb);
  }),
  start: mock(() => {
    uiohookStarted = true;
  }),
  stop: mock(() => {
    uiohookStarted = false;
  }),
};

mock.module("uiohook-napi", () => ({
  uIOhook: mockUIOhook,
  UiohookKey: {
    A: 30, B: 48, C: 46, D: 32, E: 18, F: 33, G: 34, H: 35,
    I: 23, J: 36, K: 37, L: 38, M: 50, N: 49, O: 24, P: 25,
    Q: 16, R: 19, S: 31, T: 20, U: 22, V: 47, W: 17, X: 45,
    Y: 21, Z: 44,
    0: 11, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7, 7: 8, 8: 9, 9: 10,
    F1: 59, F2: 60, F3: 61, F4: 62, F5: 63, F6: 64,
    F7: 65, F8: 66, F9: 67, F10: 68, F11: 87, F12: 88,
    Space: 57, Enter: 28, Escape: 1, Tab: 15,
    Backspace: 14, Delete: 111, Insert: 110,
    Home: 102, End: 107, PageUp: 104, PageDown: 109,
    ArrowUp: 103, ArrowDown: 108, ArrowLeft: 105, ArrowRight: 106,
    Ctrl: 29, CtrlRight: 97, Shift: 42, ShiftRight: 54,
    Alt: 56, AltRight: 100, Meta: 125, MetaRight: 126,
    Semicolon: 39, Equal: 13, Comma: 51, Minus: 12,
    Period: 52, Slash: 53, Backquote: 41,
    BracketLeft: 26, Backslash: 43, BracketRight: 27, Quote: 40,
  },
}));

const { FnHook } = await import("../../services/fn-hook.js");

function simulateKeyDown(keycode: number, modifiers: { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean } = {}) {
  for (const cb of keydownCallbacks) {
    cb({
      keycode,
      ctrlKey: modifiers.ctrlKey ?? false,
      shiftKey: modifiers.shiftKey ?? false,
      altKey: modifiers.altKey ?? false,
      metaKey: modifiers.metaKey ?? false,
    });
  }
}

function simulateKeyUp(keycode: number) {
  for (const cb of keyupCallbacks) {
    cb({ keycode });
  }
}

describe("FnHook", () => {
  beforeEach(() => {
    keydownCallbacks.length = 0;
    keyupCallbacks.length = 0;
    uiohookStarted = false;
    mockUIOhook.on.mockClear();
    mockUIOhook.start.mockClear();
    mockUIOhook.stop.mockClear();
  });

  test("starts uiohook on start()", () => {
    const callbacks = { onFnDown: mock(() => {}), onFnUp: mock(() => {}) };
    const binding = { keycode: 20, ctrl: true, shift: false, alt: false, meta: false }; // ctrl+t
    const hook = new FnHook(callbacks, binding, "ctrl+t");

    hook.start();
    expect(mockUIOhook.start).toHaveBeenCalled();
    expect(mockUIOhook.on).toHaveBeenCalled();
  });

  test("does not double-start", () => {
    const callbacks = { onFnDown: mock(() => {}), onFnUp: mock(() => {}) };
    const binding = { keycode: 20, ctrl: false, shift: false, alt: false, meta: false };
    const hook = new FnHook(callbacks, binding, "t");

    hook.start();
    hook.start(); // second call should be no-op
    expect(mockUIOhook.start).toHaveBeenCalledTimes(1);
  });

  test("calls onFnDown when key combo matches", () => {
    const onFnDown = mock(() => {});
    const onFnUp = mock(() => {});
    const binding = { keycode: 20, ctrl: true, shift: false, alt: false, meta: false };
    const hook = new FnHook({ onFnDown, onFnUp }, binding, "ctrl+t");

    hook.start();
    simulateKeyDown(20, { ctrlKey: true });

    expect(onFnDown).toHaveBeenCalledTimes(1);
  });

  test("does not call onFnDown when modifiers don't match", () => {
    const onFnDown = mock(() => {});
    const onFnUp = mock(() => {});
    const binding = { keycode: 20, ctrl: true, shift: false, alt: false, meta: false };
    const hook = new FnHook({ onFnDown, onFnUp }, binding, "ctrl+t");

    hook.start();

    // Wrong modifier: shift instead of ctrl
    simulateKeyDown(20, { shiftKey: true });
    expect(onFnDown).not.toHaveBeenCalled();

    // Right key, no modifier
    simulateKeyDown(20, {});
    expect(onFnDown).not.toHaveBeenCalled();
  });

  test("calls onFnUp when release key matches", () => {
    const onFnDown = mock(() => {});
    const onFnUp = mock(() => {});
    const binding = { keycode: 20, ctrl: true, shift: false, alt: false, meta: false };
    const hook = new FnHook({ onFnDown, onFnUp }, binding, "ctrl+t");

    hook.start();

    // Press
    simulateKeyDown(20, { ctrlKey: true });
    expect(onFnDown).toHaveBeenCalledTimes(1);

    // Release main key
    simulateKeyUp(20);
    expect(onFnUp).toHaveBeenCalledTimes(1);
  });

  test("calls onFnUp when modifier key is released", () => {
    const onFnDown = mock(() => {});
    const onFnUp = mock(() => {});
    const binding = { keycode: 20, ctrl: true, shift: false, alt: false, meta: false };
    const hook = new FnHook({ onFnDown, onFnUp }, binding, "ctrl+t");

    hook.start();
    simulateKeyDown(20, { ctrlKey: true });

    // Release ctrl (left) instead of main key
    simulateKeyUp(29); // UiohookKey.Ctrl
    expect(onFnUp).toHaveBeenCalledTimes(1);
  });

  test("does not fire onFnUp when unrelated key released", () => {
    const onFnDown = mock(() => {});
    const onFnUp = mock(() => {});
    const binding = { keycode: 20, ctrl: false, shift: false, alt: false, meta: false };
    const hook = new FnHook({ onFnDown, onFnUp }, binding, "t");

    hook.start();
    simulateKeyDown(20, {});

    // Release unrelated key (e.g., 'a' = 30)
    simulateKeyUp(30);
    expect(onFnUp).not.toHaveBeenCalled();

    // Release actual key
    simulateKeyUp(20);
    expect(onFnUp).toHaveBeenCalledTimes(1);
  });

  test("ignores repeat keydowns while active", () => {
    const onFnDown = mock(() => {});
    const onFnUp = mock(() => {});
    const binding = { keycode: 20, ctrl: false, shift: false, alt: false, meta: false };
    const hook = new FnHook({ onFnDown, onFnUp }, binding, "t");

    hook.start();
    simulateKeyDown(20, {});
    simulateKeyDown(20, {}); // repeat
    simulateKeyDown(20, {}); // repeat

    expect(onFnDown).toHaveBeenCalledTimes(1);
  });

  test("does not call onFnUp when not active", () => {
    const onFnDown = mock(() => {});
    const onFnUp = mock(() => {});
    const binding = { keycode: 20, ctrl: false, shift: false, alt: false, meta: false };
    const hook = new FnHook({ onFnDown, onFnUp }, binding, "t");

    hook.start();

    // Release without press
    simulateKeyUp(20);
    expect(onFnUp).not.toHaveBeenCalled();
  });

  test("stop() stops uiohook", () => {
    const callbacks = { onFnDown: mock(() => {}), onFnUp: mock(() => {}) };
    const binding = { keycode: 20, ctrl: false, shift: false, alt: false, meta: false };
    const hook = new FnHook(callbacks, binding, "t");

    hook.start();
    hook.stop();
    expect(mockUIOhook.stop).toHaveBeenCalled();
  });

  test("stop() is no-op when not started", () => {
    const callbacks = { onFnDown: mock(() => {}), onFnUp: mock(() => {}) };
    const binding = { keycode: 20, ctrl: false, shift: false, alt: false, meta: false };
    const hook = new FnHook(callbacks, binding, "t");

    hook.stop(); // should not throw
    expect(mockUIOhook.stop).not.toHaveBeenCalled();
  });

  test("isFnDown tracks active state", () => {
    const callbacks = { onFnDown: mock(() => {}), onFnUp: mock(() => {}) };
    const binding = { keycode: 20, ctrl: false, shift: false, alt: false, meta: false };
    const hook = new FnHook(callbacks, binding, "t");

    expect(hook.isFnDown).toBe(false);

    hook.start();
    simulateKeyDown(20, {});
    expect(hook.isFnDown).toBe(true);

    simulateKeyUp(20);
    expect(hook.isFnDown).toBe(false);
  });

  test("handles meta+shift+i binding (default)", () => {
    const onFnDown = mock(() => {});
    const onFnUp = mock(() => {});
    // meta+shift+i: keycode=23 (I), meta=true, shift=true
    const binding = { keycode: 23, ctrl: false, shift: true, alt: false, meta: true };
    const hook = new FnHook({ onFnDown, onFnUp }, binding, "meta+shift+i");

    hook.start();
    simulateKeyDown(23, { metaKey: true, shiftKey: true });
    expect(onFnDown).toHaveBeenCalledTimes(1);

    // Release shift triggers release
    simulateKeyUp(42); // UiohookKey.Shift
    expect(onFnUp).toHaveBeenCalledTimes(1);
  });
});
