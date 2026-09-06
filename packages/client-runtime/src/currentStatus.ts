/** The Current icon family, shared by the DOM and native SVG renderers. */
export interface CurrentStatusPath {
  readonly d: string;
  readonly opacity?: number;
  readonly filled?: boolean;
  readonly strokeWidth?: number;
}

export const CURRENT_STATUS_LABELS = {
  working: "Working",
  done: "Done",
  input: "Needs input",
  approval: "Needs approval",
  failed: "Failed",
  monitoring: "Monitoring",
  ready: "Ready",
  woke: "Woke",
  starting: "Connecting",
  plan: "Plan ready",
  snoozed: "Snoozed",
  settled: "Settled",
  interrupted: "Interrupted",
  stopped: "Stopped",
  other: "Unknown status",
} as const;
export type CurrentStatus = keyof typeof CURRENT_STATUS_LABELS;

export const CURRENT_STATUS_PATHS: Record<CurrentStatus, readonly CurrentStatusPath[]> = {
  working: [
    {
      d: "M3 12C6 5 9 5 13 12S20 19 23 12",
      opacity: 0.35,
    },
  ],
  done: [
    {
      d: "M2 12c3-6 6-6 9 0",
      opacity: 0.34,
    },
    {
      d: "M3 12c2-2 3-1 5 1l4 5L22 5",
    },
  ],
  input: [
    {
      d: "M12 3C6 3 2 6 2 11c0 3 2 6 5 7l-1 4 6-3c6 0 10-3 10-8S18 3 12 3Z",
      filled: true,
      opacity: 0.11,
    },
    {
      d: "M12 3C6 3 2 6 2 11c0 3 2 6 5 7l-1 4 6-3c6 0 10-3 10-8S18 3 12 3ZM9 9c0-3 6-3 6 0 0 2-3 2-3 4m0 3h.01",
    },
  ],
  approval: [
    {
      d: "M9 12V5a1.5 1.5 0 0 1 3 0v6-8a1.5 1.5 0 0 1 3 0v8-6a1.5 1.5 0 0 1 3 0v7-4a1.5 1.5 0 0 1 3 0v6c0 5-3 8-7 8-3 0-5-2-7-5l-3-4a1.6 1.6 0 0 1 2-2l3 3",
    },
  ],
  failed: [
    {
      d: "M2 13c2-5 4-6 7-2m7 4c3 2 5 0 6-3",
      opacity: 0.34,
    },
    {
      d: "m9 6 10 12M19 6 9 18",
    },
  ],
  monitoring: [
    {
      d: "M2 12C7 3 17 3 22 12 17 21 7 21 2 12Z",
      filled: true,
      opacity: 0.11,
    },
    {
      d: "M2 12C7 3 17 3 22 12 17 21 7 21 2 12Z",
    },
    {
      d: "M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0",
    },
  ],
  ready: [
    {
      d: "M2 12c3-5 6-5 10 0s7 5 10 0",
      opacity: 0.34,
    },
    {
      d: "M19 13a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",
      filled: true,
    },
  ],
  woke: [
    {
      d: "M4 13a8 8 0 1 0 16 0a8 8 0 1 0 -16 0",
      filled: true,
      opacity: 0.11,
    },
    {
      d: "M4 13a8 8 0 1 0 16 0a8 8 0 1 0 -16 0",
    },
    {
      d: "M12 8v5l4 2M2 5c1-2 2-3 4-3m16 3c-1-2-2-3-4-3M6 20l-1 2m13-2 1 2",
    },
  ],
  starting: [
    {
      d: "M2 13c2-5 4-6 7-3m6 4c3 3 5 2 7-3",
      opacity: 0.34,
    },
    {
      d: "M10 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",
      filled: true,
    },
  ],
  plan: [
    {
      d: "M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z",
      filled: true,
      opacity: 0.11,
    },
    {
      d: "M19 10V8l-5-5H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2M14 3v5h5M8 9h3m-3 4h2m-2 4h2m3-2c3-2 5-2 9-1m-3-3 3 3-3 3",
    },
  ],
  snoozed: [
    {
      d: "M14 3A9 9 0 1 0 21 16 9 9 0 0 1 14 3Z",
      filled: true,
      opacity: 0.11,
    },
    {
      d: "M14 3A9 9 0 1 0 21 16 9 9 0 0 1 14 3ZM18 5h4l-4 4h4",
    },
  ],
  settled: [
    {
      d: "M3 12h5c0 4 8 4 8 0h5v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z",
      filled: true,
      opacity: 0.11,
    },
    {
      d: "M3 12h5c0 4 8 4 8 0h5v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2ZM3 12l3-7h12l3 7M8 8h8",
    },
  ],
  interrupted: [
    {
      d: "M2 13c2-4 3-5 5-4m10 6c2 1 4 0 5-3",
      opacity: 0.34,
    },
    {
      d: "M10 7v10m4-10v10",
    },
  ],
  stopped: [
    {
      d: "M2 13c2-4 4-5 6-3m8 4c2 2 4 1 6-2",
      opacity: 0.34,
    },
    {
      d: "M10 8h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2Z",
      filled: true,
    },
  ],
  other: [
    {
      d: "M2 14c2-4 3-5 5-4m10 4c2 2 4 1 5-2",
      opacity: 0.34,
    },
    {
      d: "M8 12h.01M12 12h.01M16 12h.01",
      strokeWidth: 2.7,
    },
  ],
};
