/**
 * @deprecated Re-export shim. The single source for status / priority language
 * and job bucketing is `@/lib/request-status`. Import from there in new code;
 * this file stays only so existing importers keep compiling while other screens
 * are rebuilt.
 */
export {
  toRequestStatus,
  staffQueueTab,
  parseWhenDate,
  isSameLocalDay,
  jobSectionFor,
  formatRelativeWhen,
  formatScheduleWhen,
  workOrderContextLine,
  type JobSection,
} from "@/lib/request-status";
