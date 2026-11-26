import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import AiAssistantView from "./AiAssistantView.jsx";
import { useAssistant } from "./AssistantContext.jsx";
import Icon from "./Icon.jsx";

export default function AiAssistantDrawer() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isOpen, closeAssistant, activeAnalyst } = useAssistant();
  const [isWide, setIsWide] = useState(false);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") closeAssistant();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, closeAssistant]);

  if (!isOpen || location.pathname === "/assistant") return null;

  const openFullWorkbench = () => {
    closeAssistant();
    navigate("/assistant");
  };

  return (
    <div
      className="ai-drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeAssistant();
      }}
    >
      <aside
        className={`ai-drawer${isWide ? " ai-drawer-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="AI Investigation Assistant"
      >
        <header className="ai-drawer-header">
          <div className="ai-drawer-title">
            <span className="ai-drawer-icon"><Icon name="assistant" size={19} /></span>
            <div>
              <h2>AI Investigation Assistant</h2>
              <p>Analyst: {activeAnalyst} · Grounded in live CyberTrace telemetry</p>
            </div>
          </div>
          <div className="ai-header-actions">
            <button
              className="icon-button ai-expand-btn"
              type="button"
              onClick={() => setIsWide((prev) => !prev)}
              aria-label={isWide ? "Use standard drawer width" : "Expand drawer width"}
              title={isWide ? "Standard width" : "Expand drawer"}
            >
              <Icon name={isWide ? "collapse" : "expand"} size={17} />
            </button>
            <button className="icon-button" type="button" onClick={closeAssistant} aria-label="Close AI Assistant">
              <Icon name="close" size={18} />
            </button>
          </div>
        </header>

        <AiAssistantView
          variant="drawer"
          active={isOpen}
          onOpenFullWorkspace={openFullWorkbench}
        />
      </aside>
    </div>
  );
}
