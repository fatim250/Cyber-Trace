import { NavLink } from "react-router-dom";

import Icon from "./Icon.jsx";

const groups = [
  {
    label: "INVESTIGATION",
    items: [
      { label: "Dashboard", icon: "dashboard", to: "/", end: true },
      { label: "Cases", icon: "cases", to: "/cases" },
      { label: "Case Timeline", icon: "timeline", to: "/case-timeline" },
    ],
  },
  {
    label: "EVIDENCE",
    items: [
      { label: "Evidence Repository", icon: "evidence", to: "/evidence", end: true },
      { label: "Evidence Integrity", icon: "integrity", to: "/evidence/integrity" },
      { label: "Chain of Custody", icon: "custody", to: "/evidence/chain-of-custody" },
    ],
  },
  {
    label: "ANALYSIS",
    items: [
      { label: "AI Assistant", icon: "assistant", to: "/assistant" },
      { label: "Log Analysis", icon: "logs", to: "/analysis/log-analysis" },
      { label: "Digital Footprint", icon: "footprint", to: "/analysis/digital-footprint" },
      { label: "Event Correlation", icon: "correlate", to: "/analysis/event-correlation" },
      { label: "Forensic Findings", icon: "findings", to: "/analysis/findings" },
    ],
  },
  {
    label: "TEAM & GOVERNANCE",
    items: [
      { label: "Reports", icon: "reports", to: "/reports" },
      { label: "Cyber Teams", icon: "investigators", to: "/investigators" },
      { label: "Audit Logs", icon: "audit", to: "/audit-logs" },
      { label: "Settings", icon: "settings", to: "/settings" },
    ],
  },
];

export default function DashboardSidebar({ mode, mobileOpen = false, onClose = () => {} }) {
  const modeLabels = {
    live: "CONNECTED DATA",
    loading: "LOADING SOURCE",
    unavailable: "API UNAVAILABLE",
    demo: "DEMO WORKSPACE",
  };

  return (
    <>
      {mobileOpen && (
        <div
          className="sidebar-backdrop"
          aria-hidden="true"
          onClick={onClose}
        />
      )}
      <aside className={`sidebar${mobileOpen ? " sidebar-open" : ""}`} aria-label="Workspace navigation">
        <div className="sidebar-brand-row">
          <NavLink className="brand" to="/" aria-label="CyberTrace dashboard" onClick={onClose}>
            <span className="brand-mark"><Icon name="shield" size={20} /></span>
            <span className="brand-name">CYBER<span>TRACE</span></span>
          </NavLink>
          <button
            className="icon-button sidebar-close-btn"
            type="button"
            onClick={onClose}
            aria-label="Close navigation menu"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className={`mode-indicator mode-${mode}`}>
          <Icon name={mode === "live" ? "integrity" : mode === "unavailable" ? "findings" : "timeline"} size={14} />
          <span>{modeLabels[mode] ?? modeLabels.live}</span>
        </div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {groups.map((group) => (
            <div className="nav-group" key={group.label}>
              <p className="nav-label">{group.label}</p>
              {group.items.map((item) => (
                <NavLink
                  key={item.label}
                  className={({ isActive }) => `nav-item${isActive ? " nav-item-active" : ""}`}
                  to={item.to}
                  end={item.end}
                  title={item.label}
                  onClick={onClose}
                >
                  <Icon name={item.icon} size={17} />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <NavLink to="/settings" onClick={onClose} className="sidebar-footer-link">
            <Icon name="settings" size={14} />
            <span>Workspace & Analyst Prefs</span>
          </NavLink>
        </div>
      </aside>
    </>
  );
}
