export type Mode = "endless" | "daily";

export type Screen = "title" | "play" | "dead" | "cleared";

export type ThreadSaveV1 = {
  v: 1;
  endlessBest: number;
  daily: {
    dateKey: string;
    best: number;
    attempts?: number;
  };
  settings?: {
    reducedMotion?: boolean;
  };
};

export type Intent = {
  /** Keyboard steer in [-1, 1]. Ignored while a pointer is dragging. */
  steer: number;
  pointerActive: boolean;
  /** Pointer X in playfield coordinates. */
  pointerX: number;
  restart: boolean;
  toTitle: boolean;
};

export type ObstacleKind = "gate" | "mover";

export type ObstacleSpec = {
  id: number;
  kind: ObstacleKind;
  y: number;
  left: number;
  right: number;
  thickness: number;
  baseCenter: number;
  gapWidth: number;
  amplitude: number;
  period: number;
  phase: number;
};

export type WallKeyframe = {
  y: number;
  left: number;
  right: number;
  gateId: number | null;
};

export type StreamEvent = {
  id: number;
  kind: ObstacleKind;
  y: number;
  center: number;
  gap: number;
  amplitude: number;
  period: number;
  phase: number;
};

export type CourseSpec = {
  seed: number;
  daily: boolean;
  finishY: number | null;
  keyframes: WallKeyframe[];
  obstacles: ObstacleSpec[];
};

export type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
};
