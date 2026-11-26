import { useState } from "react";
import { Link } from "react-router-dom";

import { useAssistant } from "./AssistantContext.jsx";
import { useAuth } from "./AuthContext.jsx";
import Icon from "./Icon.jsx";

function getInitials(name = "") {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "ID";
}

export default function DashboardHeader({
  currentUser,
  cases,
  selectedCaseId,
  onSelectCase,
  query,
  onQueryChange,
  notifications = [],
  pageTitle = "Dashboard",
  showSearch = true,
  onOpenMenu = () => {},
}) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const { openAssistant } = useAssistant();
  const { profile, signOut } = useAuth();

  const displayName = profile?.displayName || currentUser?.displayName || "Investigator";
  const role = profile?.rbacRole || currentUser?.role || "Analyst";
  const orgName = profile?.organizationName || currentUser?.organizationName || "CyberTrace";

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          className="icon-button mobile-menu-btn"
          type="button"
          onClick={onOpenMenu}
          aria-label="Open navigation menu"
        >
          <Icon name="menu" size={19} />
        </button>
        <div className="breadcrumb">
          <span>{orgName}</span>
          <Icon name="chevron" size={14} />
          <strong>{pageTitle}</strong>
        </div>
      </div>

      <div className="topbar-actions">
        {showSearch && (
          <label className="search-box">
            <Icon name="search" size={16} />
            <input
              type="search"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder={pageTitle === "Cases" ? "Search cases" : "Search cases & events"}
              aria-label={pageTitle === "Cases" ? "Search cases" : "Search cases and events"}
            />
          </label>
        )}

        <label className="case-selector">
          <span>Active case</span>
          <select
            aria-label="Current investigation"
            value={selectedCaseId}
            onChange={(event) => onSelectCase(event.target.value)}
            disabled={cases.length === 0}
          >
            <option value="">{cases.length ? "All cases" : "No cases"}</option>
            {cases.map((item) => (
              <option value={item.caseNumber ?? item.id} key={item.caseNumber ?? item.id}>
                {item.caseNumber ?? item.id}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="ai-trigger-button"
          onClick={() => {
            if (window.location.pathname === "/assistant") {
              document.querySelector(".ai-composer textarea")?.focus();
            } else {
              openAssistant({ caseId: selectedCaseId || "" });
            }
          }}
          aria-label="Open AI Investigation Assistant"
        >
          <Icon name="assistant" size={16} />
          <span>AI Assistant</span>
        </button>

        <div className="header-menu-wrap">
          <button
            className="icon-button notification-button"
            aria-label={`Notifications${notifications.length ? `, ${notifications.length} active` : ""}`}
            aria-expanded={notificationsOpen}
            onClick={() => {
              setNotificationsOpen((open) => !open);
              setProfileOpen(false);
            }}
          >
            <Icon name="bell" size={18} />
            {notifications.length > 0 && <span className="notification-dot" />}
          </button>
          {notificationsOpen && (
            <div className="header-popover notification-popover">
              <strong>Workspace alerts</strong>
              {notifications.length === 0 ? (
                <p>No active alerts in the workspace.</p>
              ) : (
                notifications.map((item) => <p key={item.id}>{item.message}</p>)
              )}
            </div>
          )}
        </div>

        <div className="header-menu-wrap">
          <button
            className="profile-button"
            aria-expanded={profileOpen}
            onClick={() => {
              setProfileOpen((open) => !open);
              setNotificationsOpen(false);
            }}
          >
            <span className="avatar">{getInitials(displayName)}</span>
            <span className="profile-copy">
              <strong>{displayName}</strong>
              <small>{role}</small>
            </span>
            <Icon name="down" size={14} />
          </button>
          {profileOpen && (
            <div className="header-popover profile-popover">
              <strong>{displayName}</strong>
              <p>{role} · {orgName}</p>
              {profile?.email && <small className="mono-cell">{profile.email}</small>}
              <div className="popover-actions">
                <Link className="popover-link" to="/settings" onClick={() => setProfileOpen(false)}>
                  Workspace settings
                </Link>
                <button
                  type="button"
                  className="popover-signout"
                  onClick={() => {
                    setProfileOpen(false);
                    signOut();
                  }}
                >
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
