import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import AiAssistantView from "./AiAssistantView.jsx";
import { useAssistant } from "./AssistantContext.jsx";
import Icon from "./Icon.jsx";
import WorkspaceLayout from "./WorkspaceLayout.jsx";
import { getCases } from "../services/casesApi.js";

export default function AiWorkspacePage() {
  const { caseId, setCaseId, activeAnalyst } = useAssistant();
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCases({ limit: 50 })
      .then((res) => setCases(res.items || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <WorkspaceLayout
      mode={loading ? "loading" : "live"}
      cases={cases}
      selectedCaseId={caseId}
      onSelectCase={setCaseId}
      pageTitle="AI Assistant"
      showSearch={false}
    >
      <div className="page-heading">
        <div>
          <span className="eyebrow">AI INVESTIGATION WORKBENCH</span>
          <h1>AI Investigation Assistant</h1>
          <p>
            Interactive forensic copilot and structured triage console for {activeAnalyst}, grounded in CyberTrace cases, SHA-256 verification status, and attached logs.
          </p>
        </div>
        <div className="page-heading-actions">
          {caseId && (
            <Link className="secondary-button" to={`/cases/${encodeURIComponent(caseId)}`}>
              <Icon name="cases" size={15} /> Open {caseId}
            </Link>
          )}
          <Link className="secondary-button" to="/analysis/log-analysis">
            <Icon name="logs" size={15} /> Log Analysis
          </Link>
        </div>
      </div>

      <AiAssistantView variant="page" active />
    </WorkspaceLayout>
  );
}
