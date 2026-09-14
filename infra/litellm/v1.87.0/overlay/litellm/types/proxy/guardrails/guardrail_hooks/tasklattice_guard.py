from typing import Literal, Optional

from pydantic import BaseModel, Field

from litellm.types.proxy.guardrails.guardrail_hooks.base import GuardrailConfigModel


TaskLatticeGuardFallback = Literal["fail_closed", "fail_open"]


class TaskLatticeGuardOptionalParams(BaseModel):
    """Policy settings rendered by LiteLLM's native provider form."""

    unreachable_fallback: TaskLatticeGuardFallback = Field(
        default="fail_closed",
        description="Behavior when TaskLattice Guard is unreachable",
    )
    timeout_seconds: int = Field(
        default=10,
        ge=1,
        le=60,
        strict=True,
        description="Maximum runtime callback duration for each protected stage",
    )


class TaskLatticeGuardConfigModel(
    GuardrailConfigModel[TaskLatticeGuardOptionalParams]
):
    """Provider fields consumed by LiteLLM's standard Guardrail UI."""

    api_base: str = Field(
        description="TaskLattice Guard endpoint base URL ending in the endpoint UUID",
        json_schema_extra={"ui_type": "url"},
    )
    api_key: str = Field(
        description="TaskLattice Guard endpoint secret",
        json_schema_extra={"ui_type": "password"},
    )
    optional_params: Optional[TaskLatticeGuardOptionalParams] = Field(
        default_factory=TaskLatticeGuardOptionalParams,
        description="TaskLattice Guard policy settings",
    )

    @staticmethod
    def ui_friendly_name() -> str:
        return "TaskLattice Guard"
