"use client";

import {
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import {
  type AnalyzerPopoverPosition,
  getAnalyzerPopoverPosition,
} from "@/lib/analyzer/popoverPosition";
import styles from "./AnalyzerPopover.module.css";

type AnalyzerPopoverProps = {
  id: string;
  readerRef: RefObject<HTMLDivElement | null>;
  tokenIds: number[];
  onClose: () => void;
  focusOnOpen?: boolean;
  compact?: boolean;
  children: ReactNode;
};

const subscribeToDocument = () => () => {};
const getDocumentBody = () => document.body;
const getServerDocumentBody = () => null;

export function AnalyzerPopover({
  id,
  readerRef,
  tokenIds,
  onClose,
  focusOnOpen = false,
  compact = false,
  children,
}: AnalyzerPopoverProps) {
  const portalRoot = useSyncExternalStore(
    subscribeToDocument,
    getDocumentBody,
    getServerDocumentBody,
  );
  const [position, setPosition] = useState<
    (AnalyzerPopoverPosition & { compact: boolean }) | null
  >(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const contentInnerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const anchorElementRef = useRef<HTMLElement | null>(null);
  const closeCallbackRef = useRef(onClose);
  const keyboardOpeningRef = useRef(focusOnOpen);
  const focusedSelectionRef = useRef<string | null>(null);
  const measureRef = useRef<(() => void) | null>(null);
  const selectionKey = tokenIds.join(",");
  const openingKey = `${compact ? "actions" : "translation"}:${selectionKey}`;
  const popoverWidth = compact ? 256 : 480;
  const currentPosition = position?.compact === compact ? position : null;

  useLayoutEffect(() => {
    closeCallbackRef.current = onClose;
    keyboardOpeningRef.current = focusOnOpen;
  }, [onClose, focusOnOpen]);

  useLayoutEffect(() => {
    if (!portalRoot) return;
    const reader = readerRef.current;
    const popup = popupRef.current;
    const content = contentRef.current;
    const contentInner = contentInnerRef.current;
    if (!reader || !popup || !content || !contentInner) return;

    let frame = 0;
    let dismissed = false;
    const selectedIds = new Set(selectionKey.split(","));
    const measure = () => {
      frame = 0;
      if (dismissed) return;
      const anchors = Array.from(
        reader.querySelectorAll<HTMLElement>("[data-token-id]"),
      )
        .filter((element) => selectedIds.has(element.dataset.tokenId ?? ""))
        .flatMap((element) =>
          Array.from(element.getClientRects(), (rect) => ({ element, rect })),
        );
      const viewport = window.visualViewport;
      const next = getAnalyzerPopoverPosition(
        anchors.map((anchor) => anchor.rect),
        {
          left: viewport?.offsetLeft ?? 0,
          top: viewport?.offsetTop ?? 0,
          width: viewport?.width ?? window.innerWidth,
          height: viewport?.height ?? window.innerHeight,
        },
        {
          width: popoverWidth,
          height: content.scrollHeight,
        },
      );
      if (!next) {
        dismissed = true;
        setPosition(null);
        closeCallbackRef.current();
        return;
      }
      anchorElementRef.current = anchors[next.anchorIndex].element;
      setPosition((previous) =>
        previous &&
        previous.compact === compact &&
        previous.left === next.left &&
        previous.top === next.top &&
        previous.width === next.width &&
        previous.maxHeight === next.maxHeight &&
        previous.placement === next.placement &&
        previous.anchorIndex === next.anchorIndex
          ? previous
          : { ...next, compact },
      );
    };
    const scheduleMeasure = () => {
      if (!frame && !dismissed) frame = window.requestAnimationFrame(measure);
    };
    measureRef.current = () => {
      window.cancelAnimationFrame(frame);
      measure();
    };
    const onScroll = (event: Event) => {
      // Scrolling a translation or its Anki picker must keep its anchor fixed.
      if (event.target instanceof Node && popup.contains(event.target)) return;
      scheduleMeasure();
    };
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleMeasure);
    observer?.observe(reader);
    observer?.observe(popup);
    // Observe the unconstrained inner box: its content can grow while the
    // scrolling viewport itself keeps the same constrained height.
    observer?.observe(contentInner);
    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("scroll", onScroll, true);
    window.visualViewport?.addEventListener("resize", scheduleMeasure);
    window.visualViewport?.addEventListener("scroll", scheduleMeasure);
    measure();

    return () => {
      dismissed = true;
      measureRef.current = null;
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("scroll", onScroll, true);
      window.visualViewport?.removeEventListener("resize", scheduleMeasure);
      window.visualViewport?.removeEventListener("scroll", scheduleMeasure);
    };
  }, [portalRoot, readerRef, selectionKey, compact, popoverWidth]);

  useLayoutEffect(() => {
    // Results can be taller than the loading message. Position them before paint.
    measureRef.current?.();
  }, [children, compact]);

  const positioned = currentPosition !== null;
  useEffect(() => {
    if (!focusOnOpen) {
      focusedSelectionRef.current = null;
      return;
    }
    if (positioned && focusedSelectionRef.current !== openingKey) {
      const firstAction = compact
        ? contentInnerRef.current?.querySelector<HTMLElement>(
            'button:not([disabled]), a[href], [tabindex="0"]',
          )
        : null;
      (firstAction ?? closeButtonRef.current)?.focus({ preventScroll: true });
      focusedSelectionRef.current = openingKey;
    }
  }, [focusOnOpen, positioned, openingKey, compact]);

  useEffect(() => {
    if (!portalRoot) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (
        popupRef.current?.contains(event.target) ||
        readerRef.current?.contains(event.target)
      ) {
        return;
      }
      // Mobile selection handles can dispatch touch events outside the reader.
      const selection = window.getSelection();
      if (
        event.pointerType === "touch" &&
        selection &&
        !selection.isCollapsed &&
        (readerRef.current?.contains(selection.anchorNode) ||
          readerRef.current?.contains(selection.focusNode))
      ) {
        return;
      }
      closeCallbackRef.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const popup = popupRef.current;
      if (!popup) return;
      const nestedDialogs = popup.querySelectorAll('[role="dialog"]');
      if (
        Array.from(nestedDialogs).some(
          (dialog) =>
            (event.target instanceof Node && dialog.contains(event.target)) ||
            dialog.contains(document.activeElement),
        )
      ) {
        return;
      }
      event.preventDefault();
      if (
        popup.contains(document.activeElement) ||
        keyboardOpeningRef.current
      ) {
        anchorElementRef.current?.focus({ preventScroll: true });
      }
      closeCallbackRef.current();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [portalRoot, readerRef]);

  if (!portalRoot) return null;
  return createPortal(
    <div
      ref={popupRef}
      id={id}
      role="dialog"
      aria-label={
        compact ? "Selected text actions" : "Selected text translation"
      }
      className={`${styles.popover}${compact ? ` ${styles.compact}` : ""}`}
      data-placement={currentPosition?.placement}
      style={{
        left: currentPosition?.left ?? 12,
        top: currentPosition?.top ?? 12,
        width:
          currentPosition?.width ??
          `min(${popoverWidth}px, calc(100vw - 24px))`,
        maxHeight: currentPosition?.maxHeight ?? "calc(100dvh - 24px)",
        visibility: positioned ? "visible" : "hidden",
      }}
    >
      <button
        ref={closeButtonRef}
        type="button"
        aria-label={compact ? "Close actions" : "Close translation"}
        className={styles.closeButton}
        onClick={() => {
          anchorElementRef.current?.focus({ preventScroll: true });
          closeCallbackRef.current();
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="m6 6 12 12M18 6 6 18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <div ref={contentRef} className={styles.content}>
        <div ref={contentInnerRef}>{children}</div>
      </div>
    </div>,
    portalRoot,
  );
}
