#!/usr/bin/env python3
"""Execute an OpenFisca simulation locally using the bundled model."""

from __future__ import annotations

import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Mapping, MutableMapping, Sequence


def _error(message: str) -> None:
    print(f"[openfisca-local] {message}", file=sys.stderr)


def _load_request() -> Dict[str, Any]:
    try:
        data = json.load(sys.stdin)
    except json.JSONDecodeError as exc:  # pragma: no cover - defensive
        raise RuntimeError(f"Invalid JSON payload: {exc}") from exc

    if not isinstance(data, Mapping):
        raise RuntimeError("Local OpenFisca input must be a JSON object.")

    return dict(data)


def _normalize_variables(raw: Any) -> List[str]:
    if isinstance(raw, Sequence) and not isinstance(raw, (str, bytes, bytearray)):
        variables: List[str] = []
        for entry in raw:
            if isinstance(entry, str) and entry.strip():
                variables.append(entry.strip())
        return variables
    return []


def _safe_number(value: Any) -> Any:
    try:
        import numpy
    except ModuleNotFoundError:  # pragma: no cover - numpy is an OpenFisca dependency
        numpy = None  # type: ignore

    if numpy is not None and isinstance(value, numpy.generic):
        value = value.item()

    if isinstance(value, (bytes, bytearray)):
        try:
            return value.decode("utf-8")
        except UnicodeDecodeError:
            return value.hex()

    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return float(value)

    if isinstance(value, (int, bool)):
        return value

    return value


def _collect_periods(
    payload: Mapping[str, Any],
    collection_key: str,
    variable_name: str,
    default_month: str,
    default_year: str,
    periodicity: str | None,
) -> List[str]:
    periods: set[str] = set()

    collection = payload.get(collection_key)
    if isinstance(collection, Mapping):
        for entity_values in collection.values():
            if not isinstance(entity_values, Mapping):
                continue

            variable_values = entity_values.get(variable_name)
            if isinstance(variable_values, Mapping):
                for period_key in variable_values.keys():
                    if period_key == "value":
                        continue
                    periods.add(str(period_key))

    if not periods:
        if periodicity == "year":
            periods.add(default_year)
        else:
            periods.add(default_month)

    return sorted(periods)


def _ensure_package_path(repo_root: Path) -> None:
    package_path = repo_root / "openfisca-france"
    if str(package_path) not in sys.path:
        sys.path.insert(0, str(package_path))


def _load_variables_meta(repo_root: Path) -> Dict[str, Any]:
    meta_path = repo_root / "openfiscaVariablesMeta.json"
    if not meta_path.exists():
        return {}

    try:
        with meta_path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, json.JSONDecodeError):  # pragma: no cover - defensive
        return {}


def _store_value(
    target: MutableMapping[str, Any],
    collection_key: str,
    entity_id: str,
    variable_name: str,
    period_key: str,
    value: Any,
) -> None:
    collection = target.setdefault(collection_key, {})
    entity_values = collection.setdefault(entity_id, {})
    variable_values = entity_values.setdefault(variable_name, {})
    variable_values[period_key] = {"value": value}


def main() -> None:
    request = _load_request()

    payload = request.get("payload")
    if not isinstance(payload, Mapping):
        raise RuntimeError("`payload` field must be a JSON object.")

    variables = _normalize_variables(request.get("variables"))
    if not variables:
        raise RuntimeError("`variables` field must be a non-empty array of strings.")

    current_month = request.get("currentMonth")
    current_year = request.get("currentYear")

    now = datetime.now(timezone.utc)
    if not isinstance(current_month, str) or not current_month:
        current_month = f"{now.year}-{now.month:02d}"
    if not isinstance(current_year, str) or not current_year:
        current_year = str(now.year)

    repo_root = Path(__file__).resolve().parents[1]
    _ensure_package_path(repo_root)

    try:
        from openfisca_france import FranceTaxBenefitSystem
        from openfisca_core.simulation_builder import SimulationBuilder
    except ModuleNotFoundError as exc:  # pragma: no cover - dependency issue
        raise RuntimeError(
            "Unable to import OpenFisca packages. Make sure openfisca-core and openfisca-france are installed."
        ) from exc

    variables_meta = _load_variables_meta(repo_root)

    tax_benefit_system = FranceTaxBenefitSystem()
    builder = SimulationBuilder()
    simulation = builder.build_from_dict(tax_benefit_system, dict(payload))

    entities_by_plural = {
        plural: list(builder.get_ids(plural))
        for plural in builder.entity_ids.keys()
    }

    result: Dict[str, Any] = {
        "metadata": {
            "source": "openfisca-local",
            "generated_at": datetime.now(timezone.utc)
            .isoformat(timespec="seconds")
            .replace("+00:00", "Z")
        },
        "entities": {}
    }

    for variable_name in variables:
        try:
            entity = builder.get_variable_entity(variable_name)
        except KeyError:
            continue

        collection_key = entity.plural
        entity_ids = entities_by_plural.get(collection_key)
        if not entity_ids:
            continue

        meta = variables_meta.get(variable_name) if isinstance(variables_meta, Mapping) else None
        periodicity = None
        if isinstance(meta, Mapping):
            periodicity = meta.get("periodicity")

        periods = _collect_periods(
            payload,
            collection_key,
            variable_name,
            current_month,
            current_year,
            periodicity if isinstance(periodicity, str) else None,
        )

        for period_key in periods:
            try:
                values = simulation.calculate(variable_name, period_key)
            except Exception as exc:  # pragma: no cover - delegated to OpenFisca
                _error(
                  f"Échec du calcul de '{variable_name}' pour la période '{period_key}': {exc}"
                )
                continue

            for index, entity_id in enumerate(entity_ids):
                try:
                    raw_value = values[index]
                except IndexError:  # pragma: no cover - defensive
                    continue

                normalized_value = _safe_number(raw_value)

                _store_value(result, collection_key, entity_id, variable_name, period_key, normalized_value)
                _store_value(result["entities"], collection_key, entity_id, variable_name, period_key, normalized_value)

    json.dump(result, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # pragma: no cover - top-level safety
        _error(str(exc))
        sys.exit(1)
