/** Types for the health report, for the tests. */
export interface HealthReport {
  ok: true;
  uptimeSeconds: number;
  relay: boolean;
}
export declare function healthReport(now?: number): HealthReport;
