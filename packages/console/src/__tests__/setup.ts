import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

// Default mock handlers
export const handlers = [
  http.get("/api/services", () => {
    return HttpResponse.json({
      services: [
        {
          service: "toggl_track",
          displayName: "Toggl Track",
          authType: "api_key",
          connected: true,
          expiresAt: null,
        },
        {
          service: "google_calendar",
          displayName: "Google Calendar",
          authType: "oauth",
          connected: true,
          expiresAt: "2025-01-15T00:00:00Z",
        },
        {
          service: "fitbit",
          displayName: "Fitbit",
          authType: "oauth",
          connected: false,
          expiresAt: null,
        },
      ],
    });
  }),

  http.get("/api/workflows", () => {
    return HttpResponse.json({
      runs: [
        {
          id: 1,
          name: "Toggl Track Fetch",
          status: "completed",
          conclusion: "success",
          created_at: new Date(Date.now() - 3600000).toISOString(),
          updated_at: new Date(Date.now() - 3500000).toISOString(),
          run_started_at: new Date(Date.now() - 3600000).toISOString(),
          html_url: "https://github.com/test/repo/actions/runs/1",
        },
      ],
    });
  }),

  http.post("/api/dispatch/:service", () => {
    return HttpResponse.json({ success: true });
  }),
];

export const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
