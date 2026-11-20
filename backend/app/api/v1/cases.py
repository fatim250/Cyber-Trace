from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.case import CaseCreate, CaseListResponse, CaseRead, CaseStatus, CaseUpdate
from app.services.cases import create_case, get_case, list_cases, update_case

router = APIRouter(prefix="/cases", tags=["cases"])


@router.get("", response_model=CaseListResponse)
def read_cases(
    q: str | None = Query(default=None, max_length=200),
    case_status: CaseStatus | None = Query(default=None, alias="status"),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
) -> CaseListResponse:
    items, total = list_cases(
        db,
        query=q,
        status_filter=case_status,
        skip=skip,
        limit=limit,
    )
    return CaseListResponse(items=items, total=total, skip=skip, limit=limit)


@router.post("", response_model=CaseRead, status_code=status.HTTP_201_CREATED)
def create_case_record(data: CaseCreate, db: Session = Depends(get_db)) -> CaseRead:
    return create_case(db, data)


@router.get("/{case_number}", response_model=CaseRead)
def read_case(case_number: str, db: Session = Depends(get_db)) -> CaseRead:
    case = get_case(db, case_number)
    if case is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case not found.")
    return case


@router.patch("/{case_number}", response_model=CaseRead)
def update_case_record(
    case_number: str,
    data: CaseUpdate,
    db: Session = Depends(get_db),
) -> CaseRead:
    case = get_case(db, case_number)
    if case is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case not found.")
    return update_case(db, case, data)
