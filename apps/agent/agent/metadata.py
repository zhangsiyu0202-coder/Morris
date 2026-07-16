"""Fail-closed LiveKit job metadata parsing for the Python worker."""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .flow import FlowConfig


class RoomMetadata(BaseModel):
    model_config = ConfigDict(extra="ignore")

    session_id: str = Field(alias="sessionId", min_length=1)
    survey_id: str = Field(alias="surveyId", min_length=1)
    runtime_study: dict[str, Any] | None = Field(default=None, alias="runtimeStudy")
    flow_config: FlowConfig | None = Field(default=None, alias="flowConfig")


@dataclass(frozen=True)
class MetadataParseResult:
    metadata: RoomMetadata | None
    reason: str | None = None

    @property
    def ok(self) -> bool:
        return self.metadata is not None


def parse_room_metadata(raw: str | None) -> MetadataParseResult:
    if raw is None or not raw.strip() or raw.strip() == "{}":
        return MetadataParseResult(None, "empty")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return MetadataParseResult(None, "invalid_json")
    try:
        metadata = RoomMetadata.model_validate(data)
    except ValidationError:
        return MetadataParseResult(None, "schema_mismatch")
    if metadata.flow_config is None:
        return MetadataParseResult(None, "missing_flow_config")
    return MetadataParseResult(metadata)
