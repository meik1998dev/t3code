export const COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX = 620;
export const COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX = 780;
const RESTING_COMPOSER_IMAGE_THUMBNAIL_LIMIT = 3;

export function getRestingComposerImagePreviewCounts(imageCount: number): {
  visibleCount: number;
  overflowCount: number;
} {
  const visibleCount = Math.min(imageCount, RESTING_COMPOSER_IMAGE_THUMBNAIL_LIMIT);
  return {
    visibleCount,
    overflowCount: Math.max(0, imageCount - visibleCount),
  };
}

export function shouldUseCompactComposerFooter(
  width: number | null,
  options?: { hasWideActions?: boolean },
): boolean {
  const breakpoint = options?.hasWideActions
    ? COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX
    : COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX;
  return width !== null && width < breakpoint;
}

export function shouldUseRestingComposerLayout(input: {
  isExistingThread: boolean;
  isMobileViewport: boolean;
  isScrollCollapsed: boolean;
  hasExpandedChrome: boolean;
  hasMultilinePrompt: boolean;
  /** Whether the timeline has more content than fits above the composer. */
  timelineOverflows: boolean;
}): boolean {
  // Multiline drafts stay readable. Resting only clamps a single prompt
  // line and overlays its actions; non-image attachment and context
  // rows keep their natural height above it while image previews move inline.
  // Banners and the tasks badge dock above the surface, so they are absent
  // too. Whether the context strip can host the relocated controls is
  // deliberately absent here: resting reclaims vertical space at every
  // desktop width, and where the strip is missing or too narrow the controls
  // simply return when the composer is focused.
  //
  // Only a timeline scroll rests the composer: the user asked for it with the
  // gesture, and it lifts on the next composer interaction. Losing focus never
  // rests it, so clicking a message, copying output, or selecting text for a
  // citation leaves the composer where it was.
  //
  // Resting exists to give reading space back to the timeline. A thread that
  // fits above the composer has nothing to reclaim, so it stays expanded and
  // never shows the collapsed row that a fresh thread would otherwise open on.
  return (
    input.isExistingThread &&
    !input.isMobileViewport &&
    input.timelineOverflows &&
    input.isScrollCollapsed &&
    !input.hasMultilinePrompt &&
    !input.hasExpandedChrome
  );
}

/**
 * How much taller the empty expanded composer is than its resting row on
 * desktop widths, from the layout classes in ChatComposer: the body loses
 * 8px of top padding, the prompt clamps from min-h-17.5 (70px) to 32px, and
 * the 48px footer leaves flow.
 */
export const COMPOSER_RESTING_EXPANSION_MIN_PX = 94;

/**
 * The space the timeline reserves at its end for the composer overlay.
 *
 * The overlay is measured live, but a resting composer is much shorter than
 * an expanded one. Reserving only the resting height lets a scroll to the end
 * land flush against the short composer, and the expansion that follows then
 * covers the last rows because the timeline never moves for footer growth.
 * While resting, the reservation keeps the last expanded height, or at least
 * the resting height plus the empty expansion, so expanding again changes
 * nothing above the composer. An expanded measurement is authoritative and
 * may shrink it.
 */
export function resolveComposerTimelineInset(input: {
  currentInset: number;
  overlayHeight: number;
  isResting: boolean;
}): number {
  return input.isResting
    ? Math.max(input.currentInset, input.overlayHeight + COMPOSER_RESTING_EXPANSION_MIN_PX)
    : input.overlayHeight;
}

export function shouldAnimateComposerRestingTransition(input: {
  hasCompletedInitialLayout: boolean;
  stateChanged: boolean;
  hasInterruptedAnimation: boolean;
}): boolean {
  return input.hasCompletedInitialLayout && (input.stateChanged || input.hasInterruptedAnimation);
}

export function shouldUseCompactComposerPrimaryActions(
  width: number | null,
  options?: { hasWideActions?: boolean },
): boolean {
  if (!options?.hasWideActions) {
    return false;
  }
  return width !== null && width < COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX;
}
