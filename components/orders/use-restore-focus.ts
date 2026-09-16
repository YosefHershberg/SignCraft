'use client';

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

// The capture below has to beat Radix's FocusScope, which moves focus into the
// overlay from a passive effect on mount. Layout effects all run first, so the
// opener is still the active element when we read it.
const useCaptureEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * The first on-screen element matching `selector`. The board renders a mobile
 * and a desktop tree at the same time, so a card selector matches a hidden copy
 * too; `getClientRects` (not `offsetParent`) is used so `position: fixed`
 * elements such as the mobile FAB still count as visible.
 */
export function visibleElement(selector: string): HTMLElement | null {
  const matches = Array.from(document.querySelectorAll<HTMLElement>(selector));
  return matches.find((element) => element.getClientRects().length > 0) ?? null;
}

/**
 * Restores focus to whatever opened a controlled overlay.
 *
 * Radix returns focus to the overlay's `Trigger` when it closes; these overlays
 * are controlled with no Trigger, so Radix's own close handler prevents default
 * and focuses a `null` ref — focus lands on `<body>`. This captures the active
 * element when `open` flips true and returns an `onCloseAutoFocus` handler that
 * puts focus back, falling back to `fallback()` when the opener is gone (a
 * menu item that unmounted with its menu, a button the transition removed).
 */
export function useRestoreFocus(open: boolean, fallback?: () => HTMLElement | null): (event: Event) => void {
  const opener = useRef<HTMLElement | null>(null);

  useCaptureEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
  }, [open]);

  return useCallback(
    (event: Event) => {
      const target = opener.current?.isConnected ? opener.current : (fallback?.() ?? null);
      if (!target) return;
      event.preventDefault();
      target.focus();
    },
    [fallback]
  );
}
