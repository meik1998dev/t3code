import { SPINDLE_MARK_PATHS, SPINDLE_MARK_VIEW_BOX } from "@t3tools/shared/spindleMark";
import type { SVGProps } from "react";

export function SpindleMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      viewBox={SPINDLE_MARK_VIEW_BOX}
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
    >
      {SPINDLE_MARK_PATHS.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
