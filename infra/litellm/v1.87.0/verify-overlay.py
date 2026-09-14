#!/usr/bin/env python3
"""Verify native UI reuse and TaskLattice schema wiring after patching LiteLLM."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def require(source: str, needle: str, label: str) -> None:
    if needle not in source:
        raise RuntimeError(f"Missing {label}: {needle!r}")


def forbid(source: str, needle: str, label: str) -> None:
    if needle in source:
        raise RuntimeError(f"Unexpected {label}: {needle!r}")


def verify_files(app_root: Path) -> None:
    components = app_root / "ui/litellm-dashboard/src/components"
    add_form = (components / "guardrails/add_guardrail_form.tsx").read_text(
        encoding="utf-8"
    )
    info_view = (components / "guardrails/guardrail_info.tsx").read_text(
        encoding="utf-8"
    )
    provider_fields = (
        components / "guardrails/guardrail_provider_fields.tsx"
    ).read_text(encoding="utf-8")
    garden_data = (
        components / "guardrails/guardrail_garden_data.ts"
    ).read_text(encoding="utf-8")

    require(add_form, "<GuardrailProviderFields", "native create provider fields")
    require(add_form, 'fieldsToValidate.push("api_base", "api_key")', "create validation")
    require(add_form, "createTaskLatticeGuardCall", "secure create submission")
    require(info_view, "<GuardrailProviderFields", "native edit provider fields")
    require(info_view, 'optionalFields={', "optional secret rotation")
    require(info_view, "updateTaskLatticeGuardCall", "secure update submission")
    require(provider_fields, "optionalFields?: string[]", "native optional edit support")
    require(garden_data, 'id: "tasklattice_guard"', "native Garden catalog entry")

    combined_forms = add_form + info_view
    for marker in (
        "rounded-lg border border-cyan-200 bg-cyan-50",
        "<Checkbox.Group className=\"w-full\"",
        "<Radio.Group className=\"w-full\"",
        "When Guard is unavailable",
        "Verify & connect",
        "TaskLattice Guard connection</div>",
    ):
        forbid(combined_forms, marker, "bespoke TaskLattice form UI")
    forbid(
        add_form,
        "!isTaskLatticeProvider && !isToolPermissionProvider",
        "native Provider field bypass",
    )


def verify_schema(app_root: Path) -> None:
    sys.path.insert(0, str(app_root))
    from litellm.proxy.guardrails.guardrail_hooks.tasklattice_guard.service import (
        TaskLatticeGuardConnectionError,
        build_guardrail_record,
        normalize_endpoint,
    )
    from litellm.types.proxy.guardrails.guardrail_hooks.tasklattice_guard import (
        TaskLatticeGuardConfigModel,
    )

    fields = TaskLatticeGuardConfigModel.model_fields
    if set(fields) != {"api_base", "api_key", "optional_params"}:
        raise RuntimeError(f"Unexpected TaskLattice Provider fields: {set(fields)!r}")
    if not fields["api_base"].is_required() or not fields["api_key"].is_required():
        raise RuntimeError("Endpoint and Secret must be required on create")

    endpoint = "https://guard.example/runtime/v1/endpoints/00000000-0000-0000-0000-000000000000"
    config = TaskLatticeGuardConfigModel.model_validate(
        {
            "api_base": endpoint,
            "api_key": "not-persisted-by-this-check",
        }
    )
    if config.optional_params is None:
        raise RuntimeError("TaskLattice optional policy defaults are missing")
    if config.optional_params.unreachable_fallback != "fail_closed":
        raise RuntimeError("TaskLattice must default to fail-closed")
    if config.optional_params.timeout_seconds != 10:
        raise RuntimeError("TaskLattice timeout default changed unexpectedly")
    if normalize_endpoint(endpoint) != endpoint:
        raise RuntimeError("TaskLattice endpoint normalization changed unexpectedly")
    try:
        normalize_endpoint(
            "https://guard.example/runtime/v1/integrations/00000000-0000-0000-0000-000000000000"
        )
    except TaskLatticeGuardConnectionError:
        pass
    else:
        raise RuntimeError("Legacy integrations endpoint was accepted")

    record = build_guardrail_record(
        endpoint,
        "tasklattice-guard/verification",
        guardrail_name="TaskLattice Guard",
        skip_system_message_choice="yes",
        skip_tool_message_choice="no",
    )
    params = record["litellm_params"]
    if "api_key" in params or "secret" in params:
        raise RuntimeError("TaskLattice secret leaked into the Guardrail record")
    if params.get("skip_system_message_in_guardrail") is not True:
        raise RuntimeError("System-message policy did not reach the Guardrail record")
    if params.get("skip_tool_message_in_guardrail") is not False:
        raise RuntimeError("Tool-message policy did not reach the Guardrail record")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("/app"))
    args = parser.parse_args()
    app_root = args.root.resolve()
    verify_files(app_root)
    verify_schema(app_root)
    print("Verified TaskLattice native Guardrail integration")


if __name__ == "__main__":
    main()
