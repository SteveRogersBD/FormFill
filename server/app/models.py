"""Wire formats for the session API.

There is deliberately no field for salary, sponsorship, criminal history or EEO data: the
client strips sensitive fields before sending, and the schema makes it impossible for a
bug on either side to smuggle them through anyway.
"""

from typing import Literal

from pydantic import BaseModel, Field

Status = Literal["created", "complete", "needs_inference", "needs_user", "error"]
Tier = Literal["0", "1", "2", "3"]
AnswerSource = Literal["preference", "profile", "memory", "model", "user"]
UnresolvedReason = Literal[
    "unknown", "needs_inference", "missing_fact", "needs_confirmation", "invalid", "sensitive"
]


class FieldIn(BaseModel):
    field_id: str = Field(min_length=1, max_length=64)
    label: str = Field(max_length=500)
    field_type: str = Field(default="text", max_length=32)
    required: bool = False
    options: list[str] = Field(default_factory=list, max_length=200)
    # Supplied by the extension after its own matching pass; the server only trusts ids
    # that exist in the shared taxonomy.
    taxonomy_id: str | None = Field(default=None, max_length=64)


class Answer(BaseModel):
    field_id: str
    value: str = Field(max_length=5000)
    tier: Tier
    source: AnswerSource
    confidence: float = 1.0
    evidence: list[str] = Field(default_factory=list)
    taxonomy_id: str | None = None


class Unresolved(BaseModel):
    field_id: str
    reason: UnresolvedReason
    taxonomy_id: str | None = None


class RunStats(BaseModel):
    fields: int = 0
    resolved: int = 0
    tier_counts: dict[str, int] = Field(default_factory=dict)
    model_calls: int = 0


class JobContext(BaseModel):
    url: str = Field(default="", max_length=2000)
    company: str = Field(default="", max_length=200)
    role: str = Field(default="", max_length=300)
    jd_text: str = Field(default="", max_length=20000)


class SessionCreate(JobContext):
    pass


class StepRequest(BaseModel):
    step: int = Field(default=1, ge=1, le=50)
    fields: list[FieldIn] = Field(default_factory=list, max_length=200)


class StepResult(BaseModel):
    status: Status
    answers: list[Answer] = Field(default_factory=list)
    unresolved: list[Unresolved] = Field(default_factory=list)
    stats: RunStats = Field(default_factory=RunStats)


class SessionView(BaseModel):
    session_id: str
    step: int = 1
    status: Status = "created"
    job: JobContext = Field(default_factory=JobContext)
    last_result: StepResult | None = None
