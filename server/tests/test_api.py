def test_healthz_is_open(anonymous_client):
    response = anonymous_client.get("/healthz")

    assert response.status_code == 200
    assert response.json()["ok"] is True


def test_a_call_without_a_token_is_rejected(anonymous_client):
    assert anonymous_client.post("/v1/sessions", json={"company": "Acme"}).status_code == 401


def test_a_malformed_authorization_header_is_rejected(anonymous_client):
    response = anonymous_client.post(
        "/v1/sessions", json={"company": "Acme"}, headers={"Authorization": "Basic abc"}
    )

    assert response.status_code == 401


def test_an_invalid_token_is_rejected(anonymous_client):
    response = anonymous_client.post(
        "/v1/sessions", json={"company": "Acme"}, headers={"Authorization": "Bearer nope"}
    )

    assert response.status_code == 401


def test_the_uid_comes_from_the_verified_token(token_client):
    response = token_client.post("/v1/sessions", json={"company": "Acme"}, headers={"Authorization": "Bearer good"})

    assert response.status_code == 201


def test_a_step_resolves_profile_and_preferences(client, seeded):
    session_id = client.post("/v1/sessions", json={"company": "Acme", "role": "Designer"}).json()["session_id"]

    response = client.post(
        f"/v1/sessions/{session_id}/step",
        json={
            "step": 1,
            "fields": [
                {"field_id": "f1", "label": "First name"},
                {"field_id": "f2", "label": "Email*"},
                {"field_id": "f3", "label": "Do you require sponsorship?", "field_type": "select", "options": ["Yes", "No"], "taxonomy_id": "requiresSponsorship"},
            ],
        },
    )

    body = response.json()
    assert response.status_code == 200
    assert body["status"] == "complete"
    assert {answer["field_id"]: answer["value"] for answer in body["answers"]} == {
        "f1": "Jordan",
        "f2": "jordan@example.com",
        "f3": "No",
    }
    assert body["stats"]["model_calls"] == 0
    assert body["stats"]["tier_counts"] == {"0": 3}


def test_a_narrative_field_asks_for_inference(client, seeded):
    session_id = client.post("/v1/sessions", json={"company": "Acme"}).json()["session_id"]

    body = client.post(
        f"/v1/sessions/{session_id}/step",
        json={
            "step": 1,
            "fields": [
                {"field_id": "f1", "label": "First name"},
                {"field_id": "f2", "label": "Why do you want to join Acme?", "field_type": "narrative", "taxonomy_id": "whyCompany"},
            ],
        },
    ).json()

    assert body["status"] == "needs_inference"
    assert [answer["field_id"] for answer in body["answers"]] == ["f1"]
    assert body["unresolved"] == [{"field_id": "f2", "reason": "needs_inference", "taxonomy_id": "whyCompany"}]


def test_reading_a_session_returns_the_last_result(client, seeded):
    created = client.post("/v1/sessions", json={"company": "Acme", "role": "Designer"}).json()

    client.post(f"/v1/sessions/{created['session_id']}/step", json={"step": 1, "fields": [{"field_id": "f1", "label": "Email"}]})
    body = client.get(f"/v1/sessions/{created['session_id']}").json()

    assert body["job"]["company"] == "Acme"
    assert body["step"] == 1
    assert body["status"] == "complete"
    assert body["last_result"]["answers"][0]["value"] == "jordan@example.com"


def test_another_user_cannot_read_or_step_the_session(client, bob_client, seeded):
    session_id = client.post("/v1/sessions", json={"company": "Acme"}).json()["session_id"]

    assert bob_client.get(f"/v1/sessions/{session_id}").status_code == 404
    assert bob_client.post(f"/v1/sessions/{session_id}/step", json={"fields": []}).status_code == 404


def test_an_unknown_session_is_not_found(client):
    assert client.get("/v1/sessions/nope").status_code == 404


def test_a_crafted_session_id_cannot_reach_another_path(client):
    assert client.get("/v1/sessions/..%2Fprofile").status_code == 404
