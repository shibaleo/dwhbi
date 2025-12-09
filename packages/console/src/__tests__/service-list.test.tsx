import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServiceList } from "../components/service-list";

// Mock next/link
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

describe("ServiceList", () => {
  it("renders loading state initially", () => {
    render(<ServiceList githubConfigured={false} />);

    // Should show skeleton loaders
    const skeletons = document.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("renders services after loading", async () => {
    render(<ServiceList githubConfigured={false} />);

    await waitFor(() => {
      expect(screen.getByText("Toggl Track")).toBeInTheDocument();
    });

    expect(screen.getByText("Google Calendar")).toBeInTheDocument();
    expect(screen.getByText("Fitbit")).toBeInTheDocument();
  });

  it("shows connection status for each service", async () => {
    render(<ServiceList githubConfigured={false} />);

    await waitFor(() => {
      expect(screen.getByText("Toggl Track")).toBeInTheDocument();
    });

    // Toggl Track and Google Calendar should show as connected
    const connectedLabels = screen.getAllByText("連携中");
    expect(connectedLabels.length).toBe(2);

    // Fitbit should show as not configured
    expect(screen.getByText("未設定")).toBeInTheDocument();
  });

  it("shows sync button when github is configured and service is connected", async () => {
    render(<ServiceList githubConfigured={true} />);

    await waitFor(() => {
      expect(screen.getByText("Toggl Track")).toBeInTheDocument();
    });

    // Sync buttons should appear for connected services
    const syncButtons = screen.getAllByText("同期実行");
    expect(syncButtons.length).toBe(2); // Toggl Track and Google Calendar
  });

  it("hides sync buttons when github is not configured", async () => {
    render(<ServiceList githubConfigured={false} />);

    await waitFor(() => {
      expect(screen.getByText("Toggl Track")).toBeInTheDocument();
    });

    expect(screen.queryByText("同期実行")).not.toBeInTheDocument();
  });

  it("shows workflow run status", async () => {
    render(<ServiceList githubConfigured={true} />);

    await waitFor(() => {
      expect(screen.getByText(/成功/)).toBeInTheDocument();
    });
  });
});
