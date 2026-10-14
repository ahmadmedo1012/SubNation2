import { useEffect } from "react";

// R146 (components audit F11): trimmed to the surface the single caller
// (admin/topups' Escape-only shortcut) actually uses — description was
// read nowhere and no caller ever set a modifier flag (the unspecified-
// modifier matcher quirk died with them). Re-grow a field only when a
// second consumer needs it.
export interface KeyboardShortcut {
  key: string;
  handler: () => void;
}

export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[], enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      for (const shortcut of shortcuts) {
        if (e.key.toLowerCase() === shortcut.key.toLowerCase()) {
          e.preventDefault();
          shortcut.handler();
          break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [shortcuts, enabled]);
}
