"""Secure persistence and lifecycle for the TaskLattice Guard connection."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional, Sequence, Tuple, cast
from urllib.parse import urlparse
from uuid import UUID

import httpx
import litellm

from litellm._uuid import uuid
from litellm.litellm_core_utils.credential_accessor import CredentialAccessor
from litellm.litellm_core_utils.safe_json_dumps import safe_dumps
from litellm.proxy.credential_endpoints.endpoints import CredentialHelperUtils
from litellm.proxy.guardrails.guardrail_registry import IN_MEMORY_GUARDRAIL_HANDLER
from litellm.proxy.utils import jsonify_object
from litellm.types.guardrails import Guardrail
from litellm.types.utils import CredentialItem

PROVIDER_ID = "tasklattice_guard"
CREDENTIAL_PREFIX = "tasklattice-guard/"
VERIFY_SUFFIX = "/verify"
EXPECTED_ADAPTER_ID = "litellm-generic-guardrail"
EXPECTED_PROTOCOL = "litellm"
TaskLatticeGuardMode = Literal["pre_call", "post_call"]
TaskLatticeGuardFallback = Literal["fail_closed", "fail_open"]
TaskLatticeGuardMessageChoice = Literal["inherit", "yes", "no"]
DEFAULT_MODE: Tuple[TaskLatticeGuardMode, ...] = ("pre_call", "post_call")
DEFAULT_DEFAULT_ON = True
DEFAULT_UNREACHABLE_FALLBACK: TaskLatticeGuardFallback = "fail_closed"
DEFAULT_TIMEOUT_SECONDS = 10
MIN_TIMEOUT_SECONDS = 1
MAX_TIMEOUT_SECONDS = 60


class TaskLatticeGuardConnectionError(ValueError):
    """A safe validation error that never contains the submitted secret."""


def validate_mode(mode: Any) -> List[TaskLatticeGuardMode]:
    if not isinstance(mode, (list, tuple)) or not mode:
        raise TaskLatticeGuardConnectionError(
            "Mode must select at least one of pre_call or post_call"
        )
    if any(not isinstance(value, str) or value not in DEFAULT_MODE for value in mode):
        raise TaskLatticeGuardConnectionError(
            "Mode must be a non-empty subset of pre_call and post_call"
        )
    if len(mode) != len(set(mode)):
        raise TaskLatticeGuardConnectionError(
            "Mode must be a non-empty subset of pre_call and post_call"
        )
    return [value for value in DEFAULT_MODE if value in mode]


def validate_default_on(default_on: Any) -> bool:
    if not isinstance(default_on, bool):
        raise TaskLatticeGuardConnectionError("Default On must be true or false")
    return default_on


def validate_guardrail_name(value: Any) -> str:
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > 255:
        raise TaskLatticeGuardConnectionError(
            "Guardrail name must be between 1 and 255 characters"
        )
    return value.strip()


def validate_message_choice(value: Any) -> TaskLatticeGuardMessageChoice:
    if value not in {"inherit", "yes", "no"}:
        raise TaskLatticeGuardConnectionError(
            "Message handling choice must be inherit, yes, or no"
        )
    return cast(TaskLatticeGuardMessageChoice, value)


def message_choice_from_params(
    params: Dict[str, Any], field: str
) -> TaskLatticeGuardMessageChoice:
    value = params.get(field)
    if value is True:
        return "yes"
    if value is False:
        return "no"
    return "inherit"


def validate_unreachable_fallback(value: Any) -> TaskLatticeGuardFallback:
    if value not in {"fail_closed", "fail_open"}:
        raise TaskLatticeGuardConnectionError(
            "Unreachable fallback must be fail_closed or fail_open"
        )
    return cast(TaskLatticeGuardFallback, value)


def validate_timeout_seconds(value: Any) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or not MIN_TIMEOUT_SECONDS <= value <= MAX_TIMEOUT_SECONDS
    ):
        raise TaskLatticeGuardConnectionError(
            "Timeout must be an integer between 1 and 60 seconds"
        )
    return value


def normalize_endpoint(endpoint: str) -> str:
    endpoint = endpoint.strip().rstrip("/")
    parsed = urlparse(endpoint)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise TaskLatticeGuardConnectionError(
            "Endpoint must be an absolute HTTP(S) TaskLattice Guard endpoint URL"
        )
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise TaskLatticeGuardConnectionError(
            "Endpoint cannot contain credentials, query parameters, or a fragment"
        )
    path_prefix = "/runtime/v1/endpoints/"
    if not parsed.path.startswith(path_prefix):
        raise TaskLatticeGuardConnectionError(
            "Endpoint must end with /runtime/v1/endpoints/{uuid}"
        )
    endpoint_id = parsed.path.removeprefix(path_prefix)
    try:
        parsed_endpoint_id = UUID(endpoint_id)
    except (ValueError, AttributeError) as error:
        raise TaskLatticeGuardConnectionError(
            "Endpoint must end with /runtime/v1/endpoints/{uuid}"
        ) from error
    if str(parsed_endpoint_id) != endpoint_id.lower():
        raise TaskLatticeGuardConnectionError(
            "Endpoint must end with /runtime/v1/endpoints/{uuid}"
        )
    return endpoint


def build_guardrail_record(
    endpoint: str,
    credential_name: str,
    *,
    guardrail_id: Optional[str] = None,
    guardrail_name: Optional[str] = None,
    mode: Sequence[str] = DEFAULT_MODE,
    default_on: bool = DEFAULT_DEFAULT_ON,
    skip_system_message_choice: str = "inherit",
    skip_tool_message_choice: str = "inherit",
    unreachable_fallback: str = DEFAULT_UNREACHABLE_FALLBACK,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
) -> Guardrail:
    endpoint = normalize_endpoint(endpoint)
    validated_mode = validate_mode(mode)
    validated_default_on = validate_default_on(default_on)
    validated_system_choice = validate_message_choice(skip_system_message_choice)
    validated_tool_choice = validate_message_choice(skip_tool_message_choice)
    validated_fallback = validate_unreachable_fallback(unreachable_fallback)
    validated_timeout = validate_timeout_seconds(timeout_seconds)
    generated_id = guardrail_id or str(uuid.uuid4())
    litellm_params: Dict[str, Any] = {
        "guardrail": PROVIDER_ID,
        "mode": validated_mode,
        "api_base": endpoint,
        "credential_name": credential_name,
        "default_on": validated_default_on,
        "unreachable_fallback": validated_fallback,
        "timeout_seconds": validated_timeout,
    }
    if validated_system_choice != "inherit":
        litellm_params["skip_system_message_in_guardrail"] = (
            validated_system_choice == "yes"
        )
    if validated_tool_choice != "inherit":
        litellm_params["skip_tool_message_in_guardrail"] = (
            validated_tool_choice == "yes"
        )
    return Guardrail(
        guardrail_id=generated_id,
        guardrail_name=(
            validate_guardrail_name(guardrail_name)
            if guardrail_name is not None
            else f"tasklattice-guard-{generated_id[:8]}"
        ),
        litellm_params=litellm_params,
        guardrail_info={"managed_by": PROVIDER_ID},
    )


def masked_view(
    guardrail_id: str,
    endpoint: str,
    credential_name: str,
    *,
    guardrail_name: Optional[str] = None,
    mode: Sequence[str] = DEFAULT_MODE,
    default_on: bool = DEFAULT_DEFAULT_ON,
    skip_system_message_choice: str = "inherit",
    skip_tool_message_choice: str = "inherit",
    unreachable_fallback: str = DEFAULT_UNREACHABLE_FALLBACK,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
) -> Dict[str, Any]:
    return {
        "guardrail_id": guardrail_id,
        "guardrail_name": guardrail_name or f"tasklattice-guard-{guardrail_id[:8]}",
        "provider": PROVIDER_ID,
        "endpoint": normalize_endpoint(endpoint),
        "credential_configured": bool(credential_name),
        "mode": validate_mode(mode),
        "default_on": validate_default_on(default_on),
        "skip_system_message_choice": validate_message_choice(
            skip_system_message_choice
        ),
        "skip_tool_message_choice": validate_message_choice(
            skip_tool_message_choice
        ),
        "unreachable_fallback": validate_unreachable_fallback(
            unreachable_fallback
        ),
        "timeout_seconds": validate_timeout_seconds(timeout_seconds),
    }


def _record_params(record: Guardrail) -> Dict[str, Any]:
    params = record.get("litellm_params") or {}
    if hasattr(params, "model_dump"):
        return params.model_dump(exclude_none=True)  # type: ignore[no-any-return]
    if isinstance(params, str):
        try:
            decoded = json.loads(params)
        except json.JSONDecodeError as error:
            raise TaskLatticeGuardConnectionError(
                "TaskLattice Guard configuration is invalid"
            ) from error
        if not isinstance(decoded, dict):
            raise TaskLatticeGuardConnectionError(
                "TaskLattice Guard configuration is invalid"
            )
        return decoded
    return dict(params)


def _runtime_config_from_params(
    params: Dict[str, Any],
) -> Tuple[List[TaskLatticeGuardMode], bool, TaskLatticeGuardFallback, int]:
    return (
        validate_mode(params.get("mode")),
        validate_default_on(params.get("default_on")),
        validate_unreachable_fallback(params.get("unreachable_fallback")),
        validate_timeout_seconds(params.get("timeout_seconds")),
    )


def _row_to_guardrail(row: Any) -> Guardrail:
    values = dict(row)
    params = values.get("litellm_params")
    if isinstance(params, str):
        try:
            params = json.loads(params)
        except json.JSONDecodeError as error:
            raise TaskLatticeGuardConnectionError(
                "TaskLattice Guard configuration is invalid"
            ) from error
    info = values.get("guardrail_info")
    if isinstance(info, str):
        try:
            info = json.loads(info)
        except json.JSONDecodeError as error:
            raise TaskLatticeGuardConnectionError(
                "TaskLattice Guard metadata is invalid"
            ) from error
    values["litellm_params"] = params or {}
    values["guardrail_info"] = info or {}
    # Guardrail is a TypedDict at runtime; keep Prisma implementation details
    # out of the object passed to the in-memory registry.
    return cast(
        Guardrail,
        {
            "guardrail_id": values.get("guardrail_id"),
            "guardrail_name": values.get("guardrail_name"),
            "litellm_params": values["litellm_params"],
            "guardrail_info": values["guardrail_info"],
            "created_at": values.get("created_at"),
            "updated_at": values.get("updated_at"),
        },
    )


def _assert_tasklattice_record(record: Optional[Guardrail]) -> Guardrail:
    if record is None:
        raise TaskLatticeGuardConnectionError("TaskLattice Guard connection not found")
    params = _record_params(record)
    if params.get("guardrail") != PROVIDER_ID:
        raise TaskLatticeGuardConnectionError("Guardrail is not managed by TaskLattice Guard")
    if not params.get("credential_name"):
        raise TaskLatticeGuardConnectionError("TaskLattice Guard credential reference is missing")
    return record


async def verify_connection(endpoint: str, secret: str) -> Dict[str, Any]:
    endpoint = normalize_endpoint(endpoint)
    if not secret:
        raise TaskLatticeGuardConnectionError("Secret is required")
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(8.0), follow_redirects=False
        ) as client:
            response = await client.post(
                f"{endpoint}{VERIFY_SUFFIX}",
                headers={"x-api-key": secret},
                json={},
            )
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as error:
        raise TaskLatticeGuardConnectionError(
            "TaskLattice Guard could not verify this Endpoint and Secret"
        ) from error
    if (
        not isinstance(payload, dict)
        or payload.get("ready") is not True
        or payload.get("adapter_id") != EXPECTED_ADAPTER_ID
        or payload.get("protocol") != EXPECTED_PROTOCOL
    ):
        raise TaskLatticeGuardConnectionError(
            "Endpoint did not identify a ready LiteLLM TaskLattice Guard endpoint"
        )
    return payload


def _credential_items(
    credential_name: str, secret: str, guardrail_id: str
) -> Tuple[CredentialItem, CredentialItem]:
    plaintext = CredentialItem(
        credential_name=credential_name,
        credential_values={"api_key": secret},
        credential_info={"provider": PROVIDER_ID, "guardrail_id": guardrail_id},
    )
    return plaintext, CredentialHelperUtils.encrypt_credential_values(plaintext)


def _credential_db_data(
    encrypted: CredentialItem, user_id: Optional[str]
) -> Dict[str, Any]:
    return {
        **jsonify_object(encrypted.model_dump()),
        "created_by": user_id or "proxy-admin",
        "updated_by": user_id or "proxy-admin",
    }


def _guardrail_db_data(record: Guardrail) -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    return {
        "guardrail_id": record["guardrail_id"],
        "guardrail_name": record["guardrail_name"],
        "litellm_params": safe_dumps(_record_params(record)),
        "guardrail_info": safe_dumps(record.get("guardrail_info", {})),
        "created_at": now,
        "updated_at": now,
    }


async def create_tasklattice_guard_connection(
    *,
    prisma_client: Any,
    guardrail_name: str,
    endpoint: str,
    secret: str,
    user_id: Optional[str],
    mode: Sequence[str] = DEFAULT_MODE,
    default_on: bool = DEFAULT_DEFAULT_ON,
    skip_system_message_choice: str = "inherit",
    skip_tool_message_choice: str = "inherit",
    unreachable_fallback: str = DEFAULT_UNREACHABLE_FALLBACK,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
) -> Dict[str, Any]:
    endpoint = normalize_endpoint(endpoint)
    await verify_connection(endpoint, secret)
    guardrail_id = str(uuid.uuid4())
    credential_name = f"{CREDENTIAL_PREFIX}{guardrail_id}"
    record = build_guardrail_record(
        endpoint,
        credential_name,
        guardrail_id=guardrail_id,
        guardrail_name=guardrail_name,
        mode=mode,
        default_on=default_on,
        skip_system_message_choice=skip_system_message_choice,
        skip_tool_message_choice=skip_tool_message_choice,
        unreachable_fallback=unreachable_fallback,
        timeout_seconds=timeout_seconds,
    )
    plaintext, encrypted = _credential_items(credential_name, secret, guardrail_id)

    batcher = prisma_client.db.batch_()
    batcher.litellm_credentialstable.create(
        data=_credential_db_data(encrypted, user_id)
    )
    batcher.litellm_guardrailstable.create(data=_guardrail_db_data(record))
    await batcher.commit()

    try:
        CredentialAccessor.upsert_credentials([plaintext])
        IN_MEMORY_GUARDRAIL_HANDLER.initialize_guardrail(
            guardrail=record, source="db"
        )
    except Exception:
        rollback = prisma_client.db.batch_()
        rollback.litellm_guardrailstable.delete(
            where={"guardrail_id": guardrail_id}
        )
        rollback.litellm_credentialstable.delete(
            where={"credential_name": credential_name}
        )
        await rollback.commit()
        litellm.credential_list = [
            item
            for item in litellm.credential_list
            if item.credential_name != credential_name
        ]
        raise

    return masked_view(
        guardrail_id,
        endpoint,
        credential_name,
        guardrail_name=record["guardrail_name"],
        mode=mode,
        default_on=default_on,
        skip_system_message_choice=skip_system_message_choice,
        skip_tool_message_choice=skip_tool_message_choice,
        unreachable_fallback=unreachable_fallback,
        timeout_seconds=timeout_seconds,
    )


async def get_tasklattice_guard_connection(
    *, prisma_client: Any, guardrail_id: str
) -> Dict[str, Any]:
    row = await prisma_client.db.litellm_guardrailstable.find_unique(
        where={"guardrail_id": guardrail_id}
    )
    record = _assert_tasklattice_record(_row_to_guardrail(row) if row else None)
    params = _record_params(record)
    mode, default_on, unreachable_fallback, timeout_seconds = (
        _runtime_config_from_params(params)
    )
    return masked_view(
        guardrail_id,
        cast(str, params["api_base"]),
        cast(str, params["credential_name"]),
        guardrail_name=record.get("guardrail_name"),
        mode=mode,
        default_on=default_on,
        skip_system_message_choice=message_choice_from_params(
            params, "skip_system_message_in_guardrail"
        ),
        skip_tool_message_choice=message_choice_from_params(
            params, "skip_tool_message_in_guardrail"
        ),
        unreachable_fallback=unreachable_fallback,
        timeout_seconds=timeout_seconds,
    )


async def update_tasklattice_guard_connection(
    *,
    prisma_client: Any,
    guardrail_id: str,
    guardrail_name: Optional[str],
    endpoint: Optional[str],
    secret: Optional[str],
    user_id: Optional[str],
    mode: Optional[Sequence[str]] = None,
    default_on: Optional[bool] = None,
    skip_system_message_choice: Optional[str] = None,
    skip_tool_message_choice: Optional[str] = None,
    unreachable_fallback: Optional[str] = None,
    timeout_seconds: Optional[int] = None,
) -> Dict[str, Any]:
    row = await prisma_client.db.litellm_guardrailstable.find_unique(
        where={"guardrail_id": guardrail_id}
    )
    current = _assert_tasklattice_record(_row_to_guardrail(row) if row else None)
    params = _record_params(current)
    credential_name = cast(str, params["credential_name"])
    current_endpoint = normalize_endpoint(cast(str, params["api_base"]))
    (
        current_mode,
        current_default_on,
        current_unreachable_fallback,
        current_timeout_seconds,
    ) = _runtime_config_from_params(params)
    next_endpoint = normalize_endpoint(endpoint) if endpoint else current_endpoint
    next_secret = secret or None
    next_mode = validate_mode(mode) if mode is not None else current_mode
    next_default_on = (
        validate_default_on(default_on)
        if default_on is not None
        else current_default_on
    )
    next_system_choice = (
        validate_message_choice(skip_system_message_choice)
        if skip_system_message_choice is not None
        else message_choice_from_params(
            params, "skip_system_message_in_guardrail"
        )
    )
    next_tool_choice = (
        validate_message_choice(skip_tool_message_choice)
        if skip_tool_message_choice is not None
        else message_choice_from_params(params, "skip_tool_message_in_guardrail")
    )
    next_unreachable_fallback = (
        validate_unreachable_fallback(unreachable_fallback)
        if unreachable_fallback is not None
        else current_unreachable_fallback
    )
    next_timeout_seconds = (
        validate_timeout_seconds(timeout_seconds)
        if timeout_seconds is not None
        else current_timeout_seconds
    )

    if next_endpoint != current_endpoint and not next_secret:
        raise TaskLatticeGuardConnectionError(
            "Enter the Secret again when changing the Endpoint"
        )
    if next_secret:
        await verify_connection(next_endpoint, next_secret)

    updated = build_guardrail_record(
        next_endpoint,
        credential_name,
        guardrail_id=guardrail_id,
        guardrail_name=(
            validate_guardrail_name(guardrail_name)
            if guardrail_name is not None
            else current["guardrail_name"]
        ),
        mode=next_mode,
        default_on=next_default_on,
        skip_system_message_choice=next_system_choice,
        skip_tool_message_choice=next_tool_choice,
        unreachable_fallback=next_unreachable_fallback,
        timeout_seconds=next_timeout_seconds,
    )
    batcher = prisma_client.db.batch_()
    batcher.litellm_guardrailstable.update(
        where={"guardrail_id": guardrail_id},
        data={
            "guardrail_name": updated["guardrail_name"],
            "litellm_params": safe_dumps(_record_params(updated)),
            "updated_at": datetime.now(timezone.utc),
        },
    )
    plaintext: Optional[CredentialItem] = None
    if next_secret:
        plaintext, encrypted = _credential_items(
            credential_name, next_secret, guardrail_id
        )
        encrypted_values = jsonify_object(
            {"credential_values": encrypted.credential_values}
        )["credential_values"]
        batcher.litellm_credentialstable.update(
            where={"credential_name": credential_name},
            data={
                "credential_values": encrypted_values,
                "updated_by": user_id or "proxy-admin",
            },
        )
    await batcher.commit()

    if plaintext is not None:
        CredentialAccessor.upsert_credentials([plaintext])
    IN_MEMORY_GUARDRAIL_HANDLER.sync_guardrail_from_db(guardrail=updated)
    return masked_view(
        guardrail_id,
        next_endpoint,
        credential_name,
        guardrail_name=updated["guardrail_name"],
        mode=next_mode,
        default_on=next_default_on,
        skip_system_message_choice=next_system_choice,
        skip_tool_message_choice=next_tool_choice,
        unreachable_fallback=next_unreachable_fallback,
        timeout_seconds=next_timeout_seconds,
    )


async def delete_tasklattice_guard_connection(
    *, prisma_client: Any, guardrail_id: str
) -> Dict[str, Any]:
    row = await prisma_client.db.litellm_guardrailstable.find_unique(
        where={"guardrail_id": guardrail_id}
    )
    record = _assert_tasklattice_record(_row_to_guardrail(row) if row else None)
    credential_name = cast(str, _record_params(record)["credential_name"])

    batcher = prisma_client.db.batch_()
    batcher.litellm_guardrailstable.delete(where={"guardrail_id": guardrail_id})
    batcher.litellm_credentialstable.delete(
        where={"credential_name": credential_name}
    )
    await batcher.commit()

    IN_MEMORY_GUARDRAIL_HANDLER.delete_in_memory_guardrail(guardrail_id)
    litellm.credential_list = [
        item
        for item in litellm.credential_list
        if item.credential_name != credential_name
    ]
    return {"success": True, "guardrail_id": guardrail_id}
