from datetime import datetime, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models.case import Case
from app.schemas.case import CASE_NUMBER_PATTERN, CaseCreate, CaseStatus, CaseUpdate


def _case_id(case_number: str) -> int | None:
    match = CASE_NUMBER_PATTERN.fullmatch(case_number.strip())
    return int(match.group(1)) if match else None


def list_cases(
    db: Session,
    *,
    query: str | None,
    status_filter: CaseStatus | None,
    skip: int,
    limit: int,
) -> tuple[list[Case], int]:
    filters = []
    if status_filter is not None:
        filters.append(Case.status == status_filter.value)

    term = query.strip() if query else ""
    if term:
        matches = [
            Case.title.icontains(term, autoescape=True),
            Case.description.icontains(term, autoescape=True),
            Case.assigned_investigator.icontains(term, autoescape=True),
        ]
        case_id = _case_id(term)
        if case_id is not None:
            matches.append(Case.id == case_id)
        filters.append(or_(*matches))

    total = db.scalar(select(func.count()).select_from(Case).where(*filters)) or 0
    cases = db.scalars(
        select(Case)
        .where(*filters)
        .order_by(Case.updated_at.desc(), Case.id.desc())
        .offset(skip)
        .limit(limit)
    ).all()
    return list(cases), total


def get_case(db: Session, case_number: str) -> Case | None:
    case_id = _case_id(case_number)
    if case_id is None:
        return None
    return db.get(Case, case_id)


def create_case(db: Session, data: CaseCreate) -> Case:
    now = datetime.now(timezone.utc)
    case = Case(
        title=data.title,
        description=data.description,
        assigned_investigator=data.assigned_investigator,
        status=data.status.value,
        created_at=now,
        updated_at=now,
    )
    db.add(case)
    db.commit()
    db.refresh(case)
    return case


def update_case(db: Session, case: Case, data: CaseUpdate) -> Case:
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(case, field, value.value if isinstance(value, CaseStatus) else value)
    case.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(case)
    return case
