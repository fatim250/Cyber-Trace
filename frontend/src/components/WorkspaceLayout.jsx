import { useEffect, useState } from "react";

import DashboardHeader from "./DashboardHeader.jsx";
import DashboardSidebar from "./DashboardSidebar.jsx";

export default function WorkspaceLayout({
  mode = "live",
  currentUser,
  cases = [],
  selectedCaseId = "",
  onSelectCase = () => {},
  query = "",
  onQueryChange = () => {},
  notifications = [],
  pageTitle,
  showSearch = true,
  children,
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (!mobileMenuOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileMenuOpen]);

  return (
    <div className="app-shell">
      <DashboardSidebar
        mode={mode}
        mobileOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
      />
      <div className="dashboard-main">
        <DashboardHeader
          currentUser={currentUser}
          cases={cases}
          selectedCaseId={selectedCaseId}
          onSelectCase={onSelectCase}
          query={query}
          onQueryChange={onQueryChange}
          notifications={notifications}
          pageTitle={pageTitle}
          showSearch={showSearch}
          onOpenMenu={() => setMobileMenuOpen(true)}
        />
        <main className="dashboard-content">{children}</main>
      </div>
    </div>
  );
}
