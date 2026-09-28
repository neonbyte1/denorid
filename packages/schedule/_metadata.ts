import type { CronSchedule } from "./cron_schedule.ts";

export interface CronMetadata {
  schedule: string | CronSchedule;
  method: string | symbol;
  name?: string;
  backoffSchedule?: number[];
}

export interface IntervalMetadata {
  ms: number;
  method: string | symbol;
  name?: string;
}
