from app.models import FieldIn
from app.validation import check


def selection(label: str, options: list[str], taxonomy_id: str | None = None) -> FieldIn:
    return FieldIn(field_id="f1", label=label, field_type="select", options=options, taxonomy_id=taxonomy_id)


def test_option_matching_ignores_case_and_padding():
    verdict = check(selection("Work arrangement", ["Full-time", "Contract"]), "  full-time ", "preference")
    assert verdict.ok
    assert verdict.value == "Full-time"


def test_an_answer_outside_the_options_is_rejected():
    verdict = check(selection("Work arrangement", ["Full-time", "Contract"]), "Part-time", "preference")
    assert verdict.reason == "invalid"


def test_a_select_without_options_is_accepted_as_typed():
    verdict = check(selection("Office", []), "Berlin", "preference")
    assert verdict.value == "Berlin"


def test_dates_must_look_like_dates():
    field = FieldIn(field_id="f1", label="Earliest start date", field_type="date")
    assert check(field, "2026-01-05", "preference").ok
    assert check(field, "next Monday", "preference").reason == "invalid"


def test_numbers_accept_currency_formatting():
    field = FieldIn(field_id="f1", label="Desired salary", field_type="number")
    assert check(field, "$120,000", "preference").ok
    assert check(field, "competitive", "preference").reason == "invalid"


def test_short_fields_have_a_length_cap():
    field = FieldIn(field_id="f1", label="Notice period")
    assert check(field, "x" * 800, "preference").ok
    assert check(field, "x" * 801, "preference").reason == "invalid"


def test_narrative_fields_get_a_larger_cap():
    field = FieldIn(field_id="f1", label="Anything else we should know?", field_type="narrative")
    assert check(field, "x" * 5000, "model").ok
    assert check(field, "x" * 5001, "model").reason == "invalid"


def test_a_model_may_not_answer_a_sensitive_question():
    field = FieldIn(field_id="f1", label="Do you require visa sponsorship?", field_type="select", options=["Yes", "No"])
    assert check(field, "No", "model").reason == "sensitive"
    assert check(field, "No", "preference").ok


def test_blank_answers_are_missing_facts():
    assert check(FieldIn(field_id="f1", label="City"), "   ", "profile").reason == "missing_fact"
