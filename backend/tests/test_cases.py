from collections.abc import Generator

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.case import Case


@pytest.fixture
def client() -> Generator[TestClient, None, None]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    test_session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    def override_get_db() -> Generator[Session, None, None]:
        with test_session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    Base.metadata.drop_all(engine)
    engine.dispose()


def test_case_lifecycle_and_search(client: TestClient) -> None:
    created = client.post(
        "/api/v1/cases",
        json={
            "title": "  Authentication log review  ",
            "description": "Review authorized source records.",
            "assignedInvestigator": "Investigator A",
        },
    )
    assert created.status_code == 201
    case = created.json()
    assert case["caseNumber"] == "CT-000001"
    assert case["title"] == "Authentication log review"
    assert case["status"] == "Open"

    searched = client.get("/api/v1/cases", params={"q": "CT-000001", "status": "Open"})
    assert searched.status_code == 200
    assert searched.json()["total"] == 1
    assert searched.json()["items"][0]["id"] == case["id"]

    edited = client.patch(
        f"/api/v1/cases/{case['caseNumber']}",
        json={"title": "Identity provider review", "status": "Under Review"},
    )
    assert edited.status_code == 200
    assert edited.json()["title"] == "Identity provider review"
    assert edited.json()["status"] == "Under Review"

    detail = client.get(f"/api/v1/cases/{case['caseNumber']}")
    assert detail.status_code == 200
    assert detail.json()["assignedInvestigator"] == "Investigator A"
    assert client.get("/api/v1/cases", params={"q": "identity provider"}).json()["total"] == 1
    assert client.get("/api/v1/cases", params={"status": "Open"}).json()["total"] == 0


def test_empty_case_list_is_a_successful_empty_result(client: TestClient) -> None:
    response = client.get("/api/v1/cases")

    assert response.status_code == 200
    assert response.json()["items"] == []
    assert response.json()["total"] == 0


def test_case_validation_and_missing_case(client: TestClient) -> None:
    assert client.post("/api/v1/cases", json={"title": "   "}).status_code == 422
    assert client.post("/api/v1/cases", json={"title": "Review", "status": "Unknown"}).status_code == 422
    assert client.patch("/api/v1/cases/CT-000001", json={"status": None}).status_code == 422
    assert client.get("/api/v1/cases/CT-000001").status_code == 404


def test_case_patch_can_clear_optional_fields(client: TestClient) -> None:
    created = client.post(
        "/api/v1/cases",
        json={"title": "Endpoint review", "description": "Working notes", "assignedInvestigator": "A"},
    )
    case_number = created.json()["caseNumber"]

    updated = client.patch(
        f"/api/v1/cases/{case_number}",
        json={"description": None, "assignedInvestigator": ""},
    )
    assert updated.status_code == 200
    assert updated.json()["description"] is None
    assert updated.json()["assignedInvestigator"] is None


def test_unconfigured_database_returns_service_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.db.session.get_session_factory", lambda: None)

    with pytest.raises(HTTPException) as error:
        next(get_db())

    assert error.value.status_code == 503
