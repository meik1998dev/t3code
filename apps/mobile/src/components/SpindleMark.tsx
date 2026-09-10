import { SPINDLE_MARK_PATHS, SPINDLE_MARK_VIEW_BOX } from "@t3tools/shared/spindleMark";
import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";
import { withUniwind } from "uniwind";

const ThemedPath = withUniwind(Path);

/** The same vector mark used by the web client, tinted by the active theme. */
export function SpindleMark(props: {
  readonly height: number;
  readonly color?: ColorValue;
  readonly colorClassName?: string;
}) {
  return (
    <Svg
      accessibilityLabel="Spindle"
      height={props.height}
      width={props.height}
      viewBox={SPINDLE_MARK_VIEW_BOX}
    >
      {SPINDLE_MARK_PATHS.map((d) => (
        <ThemedPath
          key={d}
          d={d}
          color={props.color}
          colorClassName={props.colorClassName}
          fill="currentColor"
        />
      ))}
    </Svg>
  );
}
