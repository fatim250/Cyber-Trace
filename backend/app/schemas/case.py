import re
from datetime import datetime
from enum import Enum
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, computed_field, field_validator, model_validator


def to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part.capitalize() for part in rest)


class CaseStatus(str, Enum):
    OPEN = "Open"
    IN_PROGRESS = "In Progress"
    UNDER_REVIEW = "Under Review"
    CLOSED = "Closed"


class CaseSchema(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class CaseCreate(CaseSchema):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    assigned_investigator: str | None = Field(default=None, max_length=160)
    status: CaseStatus = CaseStatus.OPEN

    @field_validator("title")
    @classmethod
    def validate_title(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("A case title is required.")
        return value

    @field_validator("description", "assigned_investigator")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None


class CaseUpdate(CaseSchema):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    assigned_investigator: str | None = Field(default=None, max_length=160)
    status: CaseStatus | None = None

    @field_validator("title")
    @classmethod
    def validate_title(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("A case title cannot be blank.")
        return value

    @field_validator("description", "assigned_investigator")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None

    @model_validator(mode="after")
    def require_changes(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("At least one case field must be provided.")
        if "title" in self.model_fields_set and self.title is None:
            raise ValueError("A case title cannot be null.")
        if "status" in self.model_fields_set and self.status is None:
            raise ValueError("A case status cannot be null.")
        return self


class CaseRead(CaseSchema):
    model_config = ConfigDict(
        alias_generator=to_camel,
        from_attributes=True,
        populate_by_name=True,
    )

    id: int
    title: str
    description: str | None
    assigned_investigator: str | None
    status: CaseStatus
    created_at: datetime
    updated_at: datetime

    @computed_field
    @property
    def case_number(self) -> str:
        return f"CT-{self.id:06d}"


class CaseListResponse(CaseSchema):
    items: list[CaseRead]
    total: int
    skip: int
    limit: int


CASE_NUMBER_PATTERN = re.compile(r"^CT-(\d{6,})$", re.IGNORECASE)
