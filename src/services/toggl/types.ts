// services/toggl/types.ts

/**
 * raw entry interface from Toggl Reports API
 */
export interface TogglReportsEntry {
  id: number;
  pid: number | null;
  tid: number | null;
  uid: number | null;
  description: string | null;
  start: string;
  end: string;
  updated: string;
  dur: number;
  user: string | null;
  use_stop: boolean;
  client: string | null;
  project: string | null;
  project_color: string | null;
  project_hex_color: string | null;
  billable: number;
  is_billable: boolean;
  cur: string | null;
  tags: string[];
}