"use client";

import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import { type ReaderTextRange } from "@/lib/audio/readerText";
import { getReadingFollowTarget } from "@/lib/analyzer/readingFollow";

type ReadingFollowOptions = {
  readerRef: RefObject<HTMLDivElement | null>;
  range: ReaderTextRange | null;
  active: boolean;
  suspended?: boolean;
};

const MANUAL_QUIET_MS = 2500;
const scrollKeys = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
  "Spacebar",
]);

function matchesControl(target: EventTarget | null, selector: string) {
  return (
    typeof (target as Element | null)?.closest === "function" &&
    Boolean((target as Element).closest(selector))
  );
}

function hasSelection() {
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed);
}

function getSentenceRects(reader: HTMLDivElement, range: ReaderTextRange) {
  let offset = 0;
  return Array.from(reader.children).flatMap((element) => {
    const length = element.textContent?.length ?? 0;
    const span = element as HTMLElement;
    const start =
      span.dataset.textStart === undefined
        ? offset
        : Number(span.dataset.textStart);
    const end =
      span.dataset.textEnd === undefined
        ? start + length
        : Number(span.dataset.textEnd);
    offset += length;
    return start < range.end && end > range.start
      ? Array.from(element.getClientRects())
      : [];
  });
}

export function useReadingFollow(options: ReadingFollowOptions) {
  const { readerRef, range, active, suspended = false } = options;
  const rangeStart = range?.start;
  const rangeEnd = range?.end;
  const optionsRef = useRef(options);
  const refreshRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    optionsRef.current = {
      readerRef,
      range:
        rangeStart === undefined || rangeEnd === undefined
          ? null
          : { start: rangeStart, end: rangeEnd },
      active,
      suspended,
    };
    refreshRef.current?.();
  }, [readerRef, rangeStart, rangeEnd, active, suspended]);

  useEffect(() => {
    let frame = 0;
    let quietTimer: number | undefined;
    let automaticTimer: number | undefined;
    let automatic = false;
    let manualSession = false;
    let quietUntil = 0;
    let touchHeld = false;
    let selectionHeld = hasSelection();
    let lastRangeKey: string | null = null;
    let lastReaderText: string | null = null;
    let observedReader: HTMLDivElement | null = null;
    const pointers = new Set<number>();

    const stopAutomatic = () => {
      window.clearTimeout(automaticTimer);
      const wasAutomatic = automatic;
      automatic = false;
      if (wasAutomatic)
        window.scrollTo({
          top: window.scrollY,
          left: window.scrollX,
          behavior: "instant",
        });
    };
    const blocked = () => {
      const current = optionsRef.current;
      return (
        !current.active ||
        !current.range ||
        current.suspended ||
        document.hidden ||
        touchHeld ||
        pointers.size > 0 ||
        hasSelection() ||
        matchesControl(
          document.activeElement,
          'input,textarea,select,[contenteditable]:not([contenteditable="false"])',
        )
      );
    };
    const schedule = () => {
      if (!frame && !blocked()) frame = window.requestAnimationFrame(follow);
    };
    const armQuietTimer = () => {
      window.clearTimeout(quietTimer);
      if (!optionsRef.current.active || document.hidden) return;
      quietTimer = window.setTimeout(
        () => {
          quietTimer = undefined;
          if (Date.now() < quietUntil) armQuietTimer();
          else schedule();
        },
        Math.max(0, quietUntil - Date.now()),
      );
    };
    const markManual = () => {
      manualSession = true;
      quietUntil = Date.now() + MANUAL_QUIET_MS;
      stopAutomatic();
      window.cancelAnimationFrame(frame);
      frame = 0;
      armQuietTimer();
    };
    function follow() {
      frame = 0;
      if (blocked()) return;
      if (manualSession && Date.now() < quietUntil) {
        armQuietTimer();
        return;
      }
      manualSession = false;
      const current = optionsRef.current;
      const reader = current.readerRef.current;
      if (!reader || !current.range) return;
      if (reader !== observedReader) {
        if (observedReader) observer?.unobserve(observedReader);
        observer?.observe(reader);
        observedReader = reader;
      }
      const style = window.getComputedStyle(reader);
      const lineHeight =
        Number.parseFloat(style.lineHeight) ||
        (Number.parseFloat(style.fontSize) || 16) * 1.6;
      const viewport = window.visualViewport;
      const key = `${current.range.start}:${current.range.end}`;
      const readerText = reader.textContent;
      const target = getReadingFollowTarget({
        rects: getSentenceRects(reader, current.range),
        viewport: {
          top: viewport?.offsetTop ?? 0,
          height: viewport?.height ?? window.innerHeight,
        },
        lineHeight,
        scrollY: window.scrollY,
        maxScroll:
          Math.max(
            document.documentElement.scrollHeight,
            document.body.scrollHeight,
          ) - window.innerHeight,
        newSentence: key !== lastRangeKey || readerText !== lastReaderText,
      });
      lastRangeKey = key;
      lastReaderText = readerText;
      if (target === null) return;
      automatic = true;
      window.scrollTo({
        top: target,
        left: window.scrollX,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
      automaticTimer = window.setTimeout(() => {
        automatic = false;
      }, 1000);
    }
    const refresh = () => {
      stopAutomatic();
      window.cancelAnimationFrame(frame);
      frame = 0;
      window.clearTimeout(quietTimer);
      // Buffering between chunks can temporarily clear the range while the
      // next chunk still belongs to the same long sentence. Keep its identity.
      schedule();
    };
    const onScroll = () => {
      if (manualSession) markManual();
      else if (automatic) {
        window.clearTimeout(automaticTimer);
        automaticTimer = window.setTimeout(() => {
          automatic = false;
        }, 160);
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (matchesControl(event.target, "button,a")) return;
      pointers.add(event.pointerId);
      markManual();
    };
    const onPointerUp = (event: PointerEvent) => {
      if (pointers.delete(event.pointerId)) markManual();
    };
    const onTouchStart = (event: TouchEvent) => {
      if (matchesControl(event.target, "button,a")) return;
      touchHeld = true;
      markManual();
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (!touchHeld || event.touches.length) return;
      touchHeld = false;
      markManual();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "Tab" ||
        (scrollKeys.has(event.key) &&
          !matchesControl(
            event.target,
            'input,textarea,select,button,[contenteditable]:not([contenteditable="false"])',
          ))
      )
        markManual();
    };
    const onSelectionChange = () => {
      const selected = hasSelection();
      if (selected || selectionHeld) {
        selectionHeld = selected;
        markManual();
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (
        matchesControl(
          event.target,
          'input,textarea,select,[contenteditable]:not([contenteditable="false"])',
        )
      )
        markManual();
    };
    const onViewportScroll = () => {
      if (!automatic) schedule();
    };
    const onBlur = () => {
      if (pointers.size || touchHeld) {
        pointers.clear();
        touchHeld = false;
        markManual();
      }
    };
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedule);
    refreshRef.current = refresh;
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("wheel", markManual, {
      passive: true,
      capture: true,
    });
    window.addEventListener("resize", refresh);
    window.addEventListener("blur", onBlur);
    window.visualViewport?.addEventListener("resize", refresh);
    window.visualViewport?.addEventListener("scroll", onViewportScroll);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", onPointerUp, true);
    document.addEventListener("touchstart", onTouchStart, {
      passive: true,
      capture: true,
    });
    document.addEventListener("touchend", onTouchEnd, true);
    document.addEventListener("touchcancel", onTouchEnd, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onFocus);
    document.addEventListener("visibilitychange", refresh);
    refresh();

    return () => {
      refreshRef.current = null;
      stopAutomatic();
      window.cancelAnimationFrame(frame);
      window.clearTimeout(quietTimer);
      observer?.disconnect();
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("wheel", markManual, true);
      window.removeEventListener("resize", refresh);
      window.removeEventListener("blur", onBlur);
      window.visualViewport?.removeEventListener("resize", refresh);
      window.visualViewport?.removeEventListener("scroll", onViewportScroll);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("pointercancel", onPointerUp, true);
      document.removeEventListener("touchstart", onTouchStart, true);
      document.removeEventListener("touchend", onTouchEnd, true);
      document.removeEventListener("touchcancel", onTouchEnd, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onFocus);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [readerRef]);
}
