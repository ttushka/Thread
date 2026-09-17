import { MAX_FRAME_DT, MAX_STEPS, TICK } from "./world/constants.ts";

export function createLoop(
  update: (dt: number) => void,
  render: (alpha: number) => void,
): { start: () => void; stop: () => void } {
  let acc = 0;
  let last = 0;
  let raf = 0;
  let running = false;

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (!running) return;
    let dt = (now - last) / 1000;
    last = now;
    if (dt > MAX_FRAME_DT) dt = MAX_FRAME_DT;
    if (dt < 0) dt = 0;
    acc += dt;
    let steps = 0;
    while (acc >= TICK && steps < MAX_STEPS) {
      update(TICK);
      acc -= TICK;
      steps += 1;
    }
    if (steps === MAX_STEPS) acc = 0;
    render(acc / TICK);
  };

  return {
    start: () => {
      if (running) return;
      running = true;
      last = performance.now();
      acc = 0;
      raf = requestAnimationFrame(frame);
    },
    stop: () => {
      running = false;
      cancelAnimationFrame(raf);
    },
  };
}

export { TICK };
