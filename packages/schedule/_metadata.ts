export interface CronMetadata {
  schedule: string | Deno.CronSchedule;
  method: string | symbol;
  name?: string;
  backoffSchedule?: number[];
}
