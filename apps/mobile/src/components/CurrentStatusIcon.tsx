import {
  CURRENT_STATUS_LABELS,
  CURRENT_STATUS_PATHS,
  type CurrentStatus,
} from "@t3tools/client-runtime/current-status";
import { useEffect, useState } from "react";
import { AppState, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { Path, Svg } from "react-native-svg";
import { useAppearancePreferences } from "../features/settings/appearance/AppearancePreferencesProvider";

export function CurrentStatusIcon({
  status,
  animate = false,
  size = 20,
}: {
  status: CurrentStatus;
  animate?: boolean;
  size?: number;
}) {
  const { themeAppearance } = useAppearancePreferences();
  const dark = themeAppearance === "dark";
  const color =
    status === "working" || status === "starting" || status === "monitoring"
      ? dark
        ? "#8fbbea"
        : "#397ccd"
      : status === "done"
        ? dark
          ? "#9bc5aa"
          : "#388160"
        : status === "approval" || status === "woke"
          ? dark
            ? "#dbb277"
            : "#aa7326"
          : status === "input"
            ? dark
              ? "#aaa7ed"
              : "#6768c4"
            : status === "failed"
              ? dark
                ? "#e89288"
                : "#c05a51"
              : status === "plan"
                ? dark
                  ? "#c4a4e4"
                  : "#8a68b3"
                : dark
                  ? "#a0b09f"
                  : "#758073";
  const reducedMotion = useReducedMotion();
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const travel = useSharedValue(0);
  useEffect(() => {
    const listener = AppState.addEventListener("change", (next) =>
      setForeground(next === "active"),
    );
    return () => listener.remove();
  }, []);
  useEffect(() => {
    if (status === "working" && animate && foreground && !reducedMotion) {
      travel.set(withRepeat(withTiming(1, { duration: 3000, easing: Easing.linear }), -1, false));
    } else {
      cancelAnimation(travel);
      travel.set(0);
    }
    return () => cancelAnimation(travel);
  }, [status, animate, foreground, reducedMotion, travel]);
  const beadStyle = useAnimatedStyle(() => ({
    opacity:
      reducedMotion || !animate ? 1 : interpolate(travel.value, [0, 0.1, 0.9, 1], [0, 1, 1, 0]),
    transform: [
      { translateX: (travel.value * 20 * size) / 24 },
      {
        translateY:
          (interpolate(travel.value, [0, 0.25, 0.5, 0.75, 1], [0, -5, 0, 5, 0]) * size) / 24,
      },
    ],
  }));
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={CURRENT_STATUS_LABELS[status]}
      style={{ width: size, height: size }}
    >
      <Svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {CURRENT_STATUS_PATHS[status].map((path, index) => (
          <Path
            key={`${status}-${index}`}
            d={path.d}
            opacity={path.opacity}
            fill={path.filled ? color : "none"}
            stroke={path.filled ? "none" : color}
            strokeWidth={path.strokeWidth}
          />
        ))}
      </Svg>
      {status === "working" ? (
        <Animated.View
          accessible={false}
          style={[
            {
              position: "absolute",
              left: size / 24,
              top: (10 * size) / 24,
              width: size / 6,
              height: size / 6,
              borderRadius: size / 12,
              backgroundColor: color,
            },
            beadStyle,
          ]}
        />
      ) : null}
    </View>
  );
}
