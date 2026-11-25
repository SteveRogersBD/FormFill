from app import memory
from app.models import FieldIn
from app.resolve import Facts, load_known, resolve


def test_structured_experience_resolves_as_readable_profile_evidence():
    fields = [FieldIn(field_id="experience", label="Work experience", field_type="textarea")]
    profile = {"workExperience": [{"jobTitle": "Engineer", "company": "Example", "jobType": "Full-time", "location": "Chicago", "startDate": "2024-01", "current": True, "description": ["Built dashboards."]}]}
    result = resolve(fields, Facts(profile=profile), {}, "")
    assert result.answers[0].value == "Engineer at Example\nFull-time · Chicago\n2024-01 – Present\nBuilt dashboards."


def test_a_preference_answers_its_question_without_a_model_call():
    fields = [
        FieldIn(
            field_id="f1",
            label="Do you require sponsorship?",
            field_type="select",
            options=["Yes", "No"],
            taxonomy_id="requiresSponsorship",
        )
    ]

    result = resolve(fields, Facts(preferences={"requiresSponsorship": "no"}), {}, "")

    assert result.status == "complete"
    answer = result.answers[0]
    assert (answer.value, answer.tier, answer.source) == ("No", "0", "preference")
    assert answer.taxonomy_id == "requiresSponsorship"


def test_a_voluntary_question_waits_for_the_opt_in():
    fields = [
        FieldIn(field_id="f1", label="Gender identity", field_type="select", options=["Woman", "Man"], taxonomy_id="gender")
    ]

    withheld = resolve(fields, Facts(preferences={"gender": "Woman", "eeoOptIn": False}), {}, "")
    assert withheld.answers == []
    assert withheld.unresolved[0].reason == "needs_confirmation"

    shared = resolve(fields, Facts(preferences={"gender": "Woman", "eeoOptIn": True}), {}, "")
    assert shared.answers[0].value == "Woman"


def test_profile_facts_fill_identity_fields():
    fields = [
        FieldIn(field_id="f1", label="First name"),
        FieldIn(field_id="f2", label="Email address"),
        FieldIn(field_id="f3", label="LinkedIn profile"),
    ]
    profile = {"fullName": "Jordan Lee", "email": "jordan@example.com", "linkedin": "linkedin.com/in/jordan-lee"}

    result = resolve(fields, Facts(profile=profile), {}, "")

    assert [answer.value for answer in result.answers] == [
        "Jordan",
        "jordan@example.com",
        "https://linkedin.com/in/jordan-lee",
    ]
    assert {answer.source for answer in result.answers} == {"profile"}


def test_an_unanswered_question_is_left_for_the_user():
    fields = [FieldIn(field_id="f1", label="What are your salary expectations?", field_type="number", taxonomy_id="desiredSalary")]

    result = resolve(fields, Facts(preferences={}), {}, "")

    assert result.status == "needs_user"
    assert result.unresolved[0].reason == "missing_fact"


def test_an_answer_outside_the_portal_options_is_not_offered():
    fields = [
        FieldIn(
            field_id="f1",
            label="What is your current visa status?",
            field_type="select",
            options=["F-1", "Green Card"],
            taxonomy_id="visaStatus",
        )
    ]

    result = resolve(fields, Facts(preferences={"visaStatus": "H-1B"}), {}, "")

    assert result.answers == []
    assert result.unresolved[0].reason == "invalid"


def test_remembered_answers_resolve_without_being_asked_again():
    fields = [FieldIn(field_id="f1", label="What is your greatest strength?", field_type="narrative")]

    result = resolve(fields, Facts(), {"f1": {"value": "Turning vague briefs into shipped features", "corrections": 0}}, "")

    answer = result.answers[0]
    assert answer.source == "memory"
    assert answer.tier == "0"


def test_a_demoted_memory_is_not_served():
    fields = [FieldIn(field_id="f1", label="What is your greatest strength?", field_type="narrative")]

    result = resolve(fields, Facts(), {"f1": {"value": "Debugging", "corrections": 2}}, "")

    assert result.answers == []
    assert result.unresolved[0].reason == "needs_inference"


def test_a_typo_length_memory_is_not_served():
    fields = [FieldIn(field_id="f1", label="Preferred name")]

    assert resolve(fields, Facts(), {"f1": {"value": "ok"}}, "").answers == []


def test_company_scoped_questions_get_company_scoped_ids():
    signature = memory.signature("Why do you want to work here?")

    assert memory.is_company_scoped("Why do you want to work here?", "whyCompany")
    assert memory.answer_doc_id(signature, scoped=True, company="Acme") != memory.answer_doc_id(
        signature, scoped=True, company="Globex"
    )
    assert not memory.is_company_scoped("Tell us about a project you are proud of", "bestProject")


def test_a_narrative_question_asks_for_inference():
    fields = [
        FieldIn(
            field_id="f1",
            label="Why do you want to join Acme?",
            field_type="narrative",
            taxonomy_id="whyCompany",
        )
    ]

    result = resolve(fields, Facts(), {}, "Acme")

    assert result.status == "needs_inference"


def test_a_partly_answered_step_still_returns_what_it_knows():
    fields = [
        FieldIn(field_id="f1", label="Email address"),
        FieldIn(field_id="f2", label="Why do you want to join Acme?", field_type="narrative", taxonomy_id="whyCompany"),
    ]

    result = resolve(fields, Facts(profile={"email": "jordan@example.com"}), {}, "Acme")

    assert result.status == "needs_inference"
    assert [answer.field_id for answer in result.answers] == ["f1"]


def test_known_inputs_are_read_in_one_batch(store):
    store.put("alice", ("profile", "current"), {"fullName": "Jordan Lee"})
    store.put("alice", ("preferences", "current"), {"requiresSponsorship": "no"})
    fields = [
        FieldIn(field_id="f1", label="First name"),
        FieldIn(field_id="f2", label="Do you require sponsorship?", taxonomy_id="requiresSponsorship"),
    ]

    facts, memories = load_known(store, "alice", fields, "Acme")

    assert len(store.reads) == 1
    assert facts.profile["fullName"] == "Jordan Lee"
    assert facts.preferences["requiresSponsorship"] == "no"
    assert memories == {}
