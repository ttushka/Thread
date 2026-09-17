import { dailySeed, utcDateKey } from "../seed.ts";

export function dailyRunSeed(dateKey: string = utcDateKey()): number {
  return dailySeed(dateKey);
}
