"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import styles from "./BottomPanelLayout.module.css";

type BottomPanelLayoutProps = {
  children: ReactNode;
  panel: ReactNode;
  label: string;
  className?: string;
};

// Keeps document scrolling intact while reserving the fixed panel's real height.
// Set --bottom-panel-content-width on className to align controls with a page.
export function BottomPanelLayout({
  children,
  panel,
  label,
  className,
}: BottomPanelLayoutProps) {
  const layoutRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const layout = layoutRef.current;
    const element = panelRef.current;
    if (!layout || !element) return;

    const reserveSpace = () => {
      layout.style.setProperty(
        "--bottom-panel-height",
        `${Math.ceil(element.getBoundingClientRect().height)}px`,
      );
    };
    reserveSpace();
    const observer = new ResizeObserver(reserveSpace);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={layoutRef} className={`${styles.layout} ${className ?? ""}`}>
      <div className={styles.content}>{children}</div>
      <div className={styles.spacer} aria-hidden="true" />
      <section ref={panelRef} className={styles.panel} aria-label={label}>
        <div className={styles.inner}>{panel}</div>
      </section>
    </div>
  );
}
