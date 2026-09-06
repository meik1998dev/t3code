import {
  CURRENT_STATUS_LABELS,
  CURRENT_STATUS_PATHS,
  type CurrentStatus,
} from "@t3tools/client-runtime/current-status";
import { cn } from "~/lib/utils";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const subscribeVisibility = (notify: () => void) => {
  document.addEventListener("visibilitychange", notify);
  return () => document.removeEventListener("visibilitychange", notify);
};
const isDocumentVisible = () => document.visibilityState !== "hidden";
const visibleOnServer = () => false;

function CurrentMotionBead({ animate }: { animate: boolean }) {
  const visible = useSyncExternalStore(subscribeVisibility, isDocumentVisible, visibleOnServer);
  const ref = useRef<HTMLSpanElement>(null);
  const [inView, setInView] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const element = ref.current;
    if (!element || !animate) return;
    if (typeof IntersectionObserver === "undefined") {
      return;
    }
    const observer = new IntersectionObserver(([entry]) =>
      setInView(entry?.isIntersecting === true),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [animate]);
  return (
    <span
      ref={ref}
      aria-hidden
      className="current-status-bead"
      data-animate={animate && visible && inView}
    />
  );
}

/** A static path with a compositor-only bead while work is actually active. */
export function CurrentStatusIcon({
  status,
  animate = true,
  className,
}: {
  status: CurrentStatus;
  animate?: boolean;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={CURRENT_STATUS_LABELS[status]}
      className={cn("current-status-icon relative inline-flex size-5 shrink-0", className)}
    >
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="size-full"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {CURRENT_STATUS_PATHS[status].map((path) => (
          <path
            key={path.d}
            d={path.d}
            opacity={path.opacity}
            fill={path.filled ? "currentColor" : "none"}
            stroke={path.filled ? "none" : "currentColor"}
            strokeWidth={path.strokeWidth}
          />
        ))}
      </svg>
      {status === "working" ? <CurrentMotionBead animate={animate} /> : null}
    </span>
  );
}
