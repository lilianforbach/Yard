import json
from datetime import timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

from backend import server


ADMIN_EMAIL = "admin@yard.local"
ADMIN_PASSWORD = "YardAccess2026!"
TEST_SEED_FILE = Path(__file__).parent / "fixtures" / "seed_data.test.json"


def get_activation_token(invite_link: str) -> str:
    parsed = urlparse(invite_link)
    return parse_qs(parsed.query).get("token", [""])[0]


@pytest.fixture
def isolated_app(tmp_path, monkeypatch):
    data_file = tmp_path / "data_store.json"
    build_dir = tmp_path / "frontend_build"

    monkeypatch.setattr(server, "DATA_FILE", data_file)
    monkeypatch.setattr(server, "USE_MONGO", False)
    monkeypatch.setattr(server, "client", None)
    monkeypatch.setattr(server, "db", None)
    monkeypatch.setattr(server, "SELF_REGISTRATION_ENABLED", True)
    monkeypatch.setattr(server, "PRIMARY_FRONTEND_ORIGIN", "http://localhost:3000")
    monkeypatch.setattr(server, "FRONTEND_BUILD", build_dir)
    monkeypatch.setattr(server, "FRONTEND_INDEX", build_dir / "index.html")
    monkeypatch.setattr(server, "FRONTEND_STATIC", build_dir / "static")
    monkeypatch.setenv("YARD_SEED_FILE", str(TEST_SEED_FILE))

    return server.app, data_file


@pytest.fixture
def client(isolated_app):
    app, _ = isolated_app
    with TestClient(app) as test_client:
        yield test_client


def login(client: TestClient):
    response = client.post(
        "/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    assert response.status_code == 200
    return response


def login_as(client: TestClient, email: str, password: str = "TestPass123!"):
    response = client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
    )
    assert response.status_code == 200
    return response


def register_and_login(client: TestClient, email: str, name: str, password: str = "TestPass123!"):
    response = client.post(
        "/api/auth/register",
        json={"email": email, "password": password, "name": name},
    )
    assert response.status_code == 200
    return response


def test_seed_database_uses_json_fallback(client, isolated_app):
    _, data_file = isolated_app

    health = client.get("/api/health")
    readiness = client.get("/api/health/ready")

    assert health.status_code == 200
    assert health.json()["storage"] == "json"
    assert readiness.status_code == 200
    assert readiness.json()["ready"] is True
    assert readiness.json()["storageStatus"] == "ok"
    assert data_file.exists()

    payload = json.loads(data_file.read_text(encoding="utf-8"))
    assert any(user["email"] == ADMIN_EMAIL for user in payload["users"])
    assert len(payload["projects"]) > 0
    assert len(payload["milestones"]) > 0


def test_corrupt_local_store_prevents_startup(isolated_app):
    app, data_file = isolated_app
    data_file.write_text("{ definitely-not-json", encoding="utf-8")

    with pytest.raises(server.LocalStoreCorruptionError):
        with TestClient(app):
            pass


def test_root_route_redirects_to_frontend_when_build_is_missing(client):
    root_response = client.get("/", follow_redirects=False)
    dashboard_response = client.get("/dashboard", follow_redirects=False)

    assert root_response.status_code == 307
    assert root_response.headers["location"] == "http://localhost:3000/login"
    assert dashboard_response.status_code == 307
    assert dashboard_response.headers["location"] == "http://localhost:3000/dashboard"


def test_self_registration_can_be_disabled(isolated_app, monkeypatch):
    app, _ = isolated_app
    monkeypatch.setattr(server, "SELF_REGISTRATION_ENABLED", False)

    with TestClient(app) as test_client:
        response = test_client.post(
            "/api/auth/register",
            json={
                "email": "blocked.user@lakemere.ac.uk",
                "password": "BlockedPass123!",
                "name": "Blocked User",
            },
        )

    assert response.status_code == 403
    assert response.json()["detail"] == "Self-registration is disabled. Ask a Yard administrator for an invite."


def test_auth_flow_and_refresh(client):
    login_response = login(client)

    assert "token" not in login_response.json()
    set_cookie_header = "\n".join(login_response.headers.get_list("set-cookie"))
    assert "access_token=" in set_cookie_header
    assert "refresh_token=" in set_cookie_header

    me_response = client.get("/api/auth/me")
    refresh_response = client.post("/api/auth/refresh")

    assert me_response.status_code == 200
    assert me_response.json()["email"] == ADMIN_EMAIL
    assert refresh_response.status_code == 200
    assert refresh_response.json()["email"] == ADMIN_EMAIL
    assert "token" not in refresh_response.json()


def test_admin_reset_flow_invalidates_previous_session_and_forces_password_change(isolated_app):
    app, _ = isolated_app

    with TestClient(app) as admin_client, TestClient(app) as user_client:
        created_user = register_and_login(
            user_client,
            "k.asante@lakemere.ac.uk",
            "Dr. Kwame Asante",
            password="LeadPass123!",
        ).json()

        login(admin_client)
        reset_response = admin_client.post(f"/api/admin/users/{created_user['id']}/reset-password")

        assert reset_response.status_code == 200
        reset_payload = reset_response.json()
        assert reset_payload["user"]["mustChangePassword"] is True
        assert reset_payload["temporaryPassword"]
        assert reset_payload["expiresInHours"] == server.TEMP_PASSWORD_EXPIRY_HOURS

        stale_session_response = user_client.post(
            "/api/projects/sousbot/updates",
            json={
                "title": "Should fail",
                "content": "The previous session should be invalidated after reset.",
                "author": "",
            },
        )
        assert stale_session_response.status_code == 401
        assert stale_session_response.json()["detail"] == "Session expired"

        forced_login = user_client.post(
            "/api/auth/login",
            json={
                "email": "k.asante@lakemere.ac.uk",
                "password": reset_payload["temporaryPassword"],
            },
        )
        assert forced_login.status_code == 200
        assert forced_login.json()["mustChangePassword"] is True

        blocked_write = user_client.post(
            "/api/projects/sousbot/updates",
            json={
                "title": "Still blocked",
                "content": "Users must change their password before protected writes resume.",
                "author": "",
            },
        )
        assert blocked_write.status_code == 403
        assert blocked_write.json()["detail"] == "Password change required"

        changed_password = user_client.post(
            "/api/auth/change-password",
            json={"newPassword": "FreshLeadPass123!"},
        )
        assert changed_password.status_code == 200
        assert changed_password.json()["mustChangePassword"] is False

        resumed_write = user_client.post(
            "/api/projects/sousbot/updates",
            json={
                "title": "Back again",
                "content": "Protected writes should work again after the forced password change.",
                "author": "",
            },
        )
        assert resumed_write.status_code == 200


def test_admin_onboard_member_creates_profile_and_temporary_access(isolated_app):
    app, _ = isolated_app

    with TestClient(app) as admin_client, TestClient(app) as researcher_client:
        login(admin_client)

        onboard_response = admin_client.post(
            "/api/admin/onboard-member",
            json={
                "name": "Dr. Mira Haldane",
                "role": "postdoc",
                "institution": "lakemere",
                "title": "Postdoctoral Fellow - Topological Data Analysis",
                "email": "m.haldane@lakemere.ac.uk",
                "createAccount": True,
            },
        )

        assert onboard_response.status_code == 200
        payload = onboard_response.json()
        assert payload["person"]["email"] == "m.haldane@lakemere.ac.uk"
        assert payload["user"]["linkedPersonId"] == payload["person"]["id"]
        assert payload["user"]["mustChangePassword"] is False
        assert payload["user"]["activationPending"] is True
        assert payload["inviteLink"]
        assert payload["expiresInHours"] == server.INVITE_LINK_EXPIRY_HOURS

        token = get_activation_token(payload["inviteLink"])
        assert token

        activation_status = researcher_client.get("/api/auth/activation-status", params={"token": token})
        assert activation_status.status_code == 200
        assert activation_status.json()["email"] == "m.haldane@lakemere.ac.uk"

        activation_response = researcher_client.post(
            "/api/auth/activate-account",
            json={"token": token, "password": "MiraLaunch123!"},
        )
        assert activation_response.status_code == 200
        assert activation_response.json()["email"] == "m.haldane@lakemere.ac.uk"

        login_response = researcher_client.post(
            "/api/auth/login",
            json={
                "email": "m.haldane@lakemere.ac.uk",
                "password": "MiraLaunch123!",
            },
        )
        assert login_response.status_code == 200
        assert login_response.json()["mustChangePassword"] is False
        assert login_response.json()["personId"] == payload["person"]["id"]

        permissions_response = researcher_client.get("/api/auth/permissions")
        assert permissions_response.status_code == 200
        assert permissions_response.json()["linkedPersonId"] == payload["person"]["id"]


def test_admin_invite_link_uses_trusted_frontend_origin(isolated_app, monkeypatch):
    app, _ = isolated_app
    monkeypatch.setattr(server, "ALLOWED_ORIGINS", ["http://localhost:3000"])
    monkeypatch.setattr(server, "PRIMARY_FRONTEND_ORIGIN", "http://localhost:3000")

    with TestClient(app) as admin_client:
        login(admin_client)

        onboard_response = admin_client.post(
            "/api/admin/onboard-member",
            headers={"Origin": "https://evil.example"},
            json={
                "name": "Dr. Talia Mercer",
                "role": "postdoc",
                "institution": "lakemere",
                "title": "Postdoctoral Fellow - Programme Security",
                "email": "t.mercer@lakemere.ac.uk",
            },
        )

    assert onboard_response.status_code == 200
    assert onboard_response.json()["inviteLink"].startswith("http://localhost:3000/activate?token=")


def test_project_visual_uploads_require_project_edit_access(client):
    register_and_login(client, "a.bakari@lakemere.ac.uk", "Aisha Bakari")

    blocked_upload = client.post(
        "/api/uploads/visual",
        data={"projectId": "sousbot"},
        files={"file": ("blocked.svg", "<svg xmlns='http://www.w3.org/2000/svg'></svg>", "image/svg+xml")},
    )
    assert blocked_upload.status_code == 403

    register_and_login(client, "k.asante@lakemere.ac.uk", "Dr. Kwame Asante")
    allowed_upload = client.post(
        "/api/uploads/visual",
        data={"projectId": "sousbot"},
        files={"file": ("allowed.svg", "<svg xmlns='http://www.w3.org/2000/svg'></svg>", "image/svg+xml")},
    )
    assert allowed_upload.status_code == 200

    uploaded_filename = allowed_upload.json()["filename"]
    assert uploaded_filename.startswith("sousbot--")

    login_as(client, "a.bakari@lakemere.ac.uk")
    blocked_delete = client.delete(
        f"/api/uploads/visual/{uploaded_filename}",
        params={"projectId": "sousbot"},
    )
    assert blocked_delete.status_code == 403

    login_as(client, "k.asante@lakemere.ac.uk")
    allowed_delete = client.delete(
        f"/api/uploads/visual/{uploaded_filename}",
        params={"projectId": "sousbot"},
    )
    assert allowed_delete.status_code == 200
    assert allowed_delete.json()["deleted"] is True


def test_startup_migrations_do_not_overwrite_runtime_project_or_people_changes(isolated_app):
    app, _ = isolated_app

    with TestClient(app) as first_client:
        login(first_client)

        cleared_slides = first_client.put(
            "/api/projects/recipegraph",
            json={"slidesUrl": "", "publish": False},
        )
        assert cleared_slides.status_code == 200
        assert cleared_slides.json()["slidesUrl"] == ""

        custom_update = first_client.post(
            "/api/projects/sousbot/updates",
            json={
                "title": "Runtime-only update",
                "content": "This update should still exist after the next startup migration pass.",
                "author": "",
            },
        )
        assert custom_update.status_code == 200

        cleared_equipment = first_client.put(
            "/api/people/priya",
            json={"equipment": []},
        )
        assert cleared_equipment.status_code == 200
        assert cleared_equipment.json()["equipment"] == []

    with TestClient(app) as second_client:
        recipegraph = second_client.get("/api/projects/recipegraph")
        assert recipegraph.status_code == 200
        assert recipegraph.json()["slidesUrl"] == ""

        sousbot = second_client.get("/api/projects/sousbot")
        assert sousbot.status_code == 200
        assert sousbot.json()["updates"][0]["title"] == "Runtime-only update"

        priya = second_client.get("/api/people/priya")
        assert priya.status_code == 200
        assert priya.json()["equipment"] == []


def test_concept_notes_reject_unknown_related_projects(client):
    register_and_login(client, "k.asante@lakemere.ac.uk", "Dr. Kwame Asante")

    invalid_create = client.post(
        "/api/conceptnotes",
        json={
            "title": "Invalid related project",
            "contributors": ["kwame"],
            "rationale": "Checking referential integrity on create.",
            "relatedProjects": ["not-a-real-project"],
        },
    )
    assert invalid_create.status_code == 404
    assert invalid_create.json()["detail"] == "Project not found: not-a-real-project"

    created = client.post(
        "/api/conceptnotes",
        json={
            "title": "Valid concept note",
            "contributors": ["kwame"],
            "rationale": "Checking referential integrity on update.",
            "relatedProjects": ["sousbot"],
        },
    )
    assert created.status_code == 200

    invalid_update = client.put(
        f"/api/conceptnotes/{created.json()['id']}",
        json={"relatedProjects": ["still-not-real"]},
    )
    assert invalid_update.status_code == 403
    assert invalid_update.json()["detail"] == "Only admins can update concept note stewardship"

    login(client)
    admin_invalid_update = client.put(
        f"/api/conceptnotes/{created.json()['id']}",
        json={"relatedProjects": ["still-not-real"]},
    )
    assert admin_invalid_update.status_code == 404
    assert admin_invalid_update.json()["detail"] == "Project not found: still-not-real"


def test_existing_profile_access_creation_survives_profile_email_edit(isolated_app):
    app, _ = isolated_app

    with TestClient(app) as admin_client, TestClient(app) as researcher_client:
        login(admin_client)

        created_person = admin_client.post(
            "/api/people",
            json={
                "name": "Dr. Lukas Bergstrom",
                "role": "postdoc",
                "institution": "lakemere",
                "title": "Postdoctoral Fellow - Sensor Safety",
                "email": "l.bergstrom2@lakemere.ac.uk",
            },
        )
        assert created_person.status_code == 200
        person = created_person.json()

        create_access_response = admin_client.post(
            f"/api/admin/people/{person['id']}/create-account",
            json={},
        )
        assert create_access_response.status_code == 200
        payload = create_access_response.json()
        assert payload["user"]["linkedPersonId"] == person["id"]
        assert payload["user"]["activationPending"] is True
        assert payload["inviteLink"]

        token = get_activation_token(payload["inviteLink"])
        assert token

        activation_status = researcher_client.get("/api/auth/activation-status", params={"token": token})
        assert activation_status.status_code == 200
        assert activation_status.json()["email"] == "l.bergstrom2@lakemere.ac.uk"

        activation_response = researcher_client.post(
            "/api/auth/activate-account",
            json={"token": token, "password": "LaunchBergstrom123!"},
        )
        assert activation_response.status_code == 200

        forced_login = researcher_client.post(
            "/api/auth/login",
            json={
                "email": "l.bergstrom2@lakemere.ac.uk",
                "password": "LaunchBergstrom123!",
            },
        )
        assert forced_login.status_code == 200
        assert forced_login.json()["mustChangePassword"] is False
        assert forced_login.json()["personId"] == person["id"]

        changed_password = researcher_client.post(
            "/api/auth/change-password",
            json={"currentPassword": "LaunchBergstrom123!", "newPassword": "FreshBergstrom123!"},
        )
        assert changed_password.status_code == 200
        assert changed_password.json()["mustChangePassword"] is False
        assert changed_password.json()["personId"] == person["id"]

        updated_profile = researcher_client.put(
            f"/api/people/{person['id']}",
            json={"email": "lukas.bergstrom@lakemere.ac.uk"},
        )
        assert updated_profile.status_code == 200
        assert updated_profile.json()["email"] == "lukas.bergstrom@lakemere.ac.uk"

        permissions_after = researcher_client.get("/api/auth/permissions")
        assert permissions_after.status_code == 200
        assert permissions_after.json()["linkedPersonId"] == person["id"]


def test_admin_reset_endpoint_rejects_current_session_account(client):
    admin_user = login(client).json()

    reset_response = client.post(f"/api/admin/users/{admin_user['id']}/reset-password")

    assert reset_response.status_code == 400
    assert reset_response.json()["detail"] == "Use the password change flow for your current account"


def test_write_endpoints_require_auth_and_validate_input(client):
    unauthenticated = client.post(
        "/api/milestones",
        json={
            "project": "recipegraph",
            "title": "Protected milestone",
            "dueDate": "2026-06-30",
            "type": "research",
        },
    )
    assert unauthenticated.status_code == 401

    login(client)

    invalid_create = client.post(
        "/api/milestones",
        json={"project": "recipegraph"},
    )
    assert invalid_create.status_code == 422

    created = client.post(
        "/api/milestones",
        json={
            "project": "recipegraph",
            "title": "Integration test milestone",
            "dueDate": "2026-06-30",
            "type": "research",
        },
    )
    assert created.status_code == 200

    milestone_id = created.json()["id"]
    # Unknown fields are ignored by Pydantic; with no valid fields the
    # model_validator raises a 422 (unprocessable entity).
    invalid_update = client.put(f"/api/milestones/{milestone_id}", json={"unknown": "field"})
    assert invalid_update.status_code == 422

    # Bad date format should also be rejected
    bad_date_update = client.put(f"/api/milestones/{milestone_id}", json={"dueDate": "not-a-date"})
    assert bad_date_update.status_code == 422

    complete_response = client.post(
        f"/api/milestones/{milestone_id}/complete",
        json={"completedDate": "2026-06-29"},
    )
    assert complete_response.status_code == 200
    assert complete_response.json()["computedStatus"] == "completed"
    assert complete_response.json()["completedDate"] == "2026-06-29"

    reopen_response = client.post(f"/api/milestones/{milestone_id}/reopen", json={})
    assert reopen_response.status_code == 200
    assert reopen_response.json()["computedStatus"] in {"approaching", "on-track"}
    assert "completedDate" not in reopen_response.json()


def test_project_updates_and_challenges_persist_to_store(client):
    register_and_login(client, "k.asante@lakemere.ac.uk", "Dr. Kwame Asante")

    update_response = client.post(
        "/api/projects/sousbot/updates",
        json={
            "title": "Integration test update",
            "content": "Confirmed that update writes persist in JSON fallback mode.",
            "author": "",
        },
    )
    challenge_response = client.post(
        "/api/projects/sousbot/challenges",
        json={
            "description": "Integration test challenge",
            "severity": "slowing",
            "raisedBy": "",
        },
    )
    project_response = client.get("/api/projects/sousbot")

    assert update_response.status_code == 200
    assert challenge_response.status_code == 200
    assert project_response.status_code == 200
    assert project_response.json()["updates"][0]["title"] == "Integration test update"
    assert update_response.json()["author"] == "Dr. Kwame Asante"
    assert any(
        challenge["description"] == "Integration test challenge"
        for challenge in project_response.json()["currentChallenges"]
    )
    assert challenge_response.json()["raisedBy"] == "Dr. Kwame Asante"


def test_project_write_permissions_follow_role_rules(client):
    register_and_login(client, "a.bakari@lakemere.ac.uk", "Aisha Bakari")
    contributor_update = client.post(
        "/api/projects/sousbot/updates",
        json={"title": "Should fail", "content": "Contributors cannot post updates", "author": ""},
    )
    contributor_feedback = client.post(
        "/api/projects/sousbot/feedback",
        json={"title": "Should fail", "content": "Contributors cannot post feedback", "author": ""},
    )
    contributor_challenge = client.post(
        "/api/projects/sousbot/challenges",
        json={"description": "Contributor challenge", "severity": "slowing", "raisedBy": ""},
    )

    assert contributor_update.status_code == 403
    assert contributor_feedback.status_code == 403
    assert contributor_challenge.status_code == 403

    register_and_login(client, "k.asante@lakemere.ac.uk", "Dr. Kwame Asante")
    lead_feedback = client.post(
        "/api/projects/sousbot/feedback",
        json={"title": "Lead should not post feedback", "content": "Feedback belongs to project PIs", "author": ""},
    )
    lead_update = client.post(
        "/api/projects/sousbot/updates",
        json={"title": "Lead update", "content": "Lead can post updates", "author": ""},
    )

    assert lead_feedback.status_code == 403
    assert lead_update.status_code == 200

    register_and_login(client, "k.yamamoto@lakemere.ac.uk", "Prof. Kenji Yamamoto")
    pi_feedback = client.post(
        "/api/projects/sousbot/feedback",
        json={"title": "PI feedback", "content": "Project PI can post feedback", "author": ""},
    )
    pi_update = client.post(
        "/api/projects/sousbot/updates",
        json={"title": "PI should not post update", "content": "Only the lead can post updates", "author": ""},
    )

    assert pi_feedback.status_code == 200
    assert pi_feedback.json()["author"] == "Prof. Kenji Yamamoto"
    assert pi_update.status_code == 403

    register_and_login(client, "a.osei@thornbridge.ac.uk", "Prof. Amara Osei")
    unrelated_pi_feedback = client.post(
        "/api/projects/sousbot/feedback",
        json={
            "title": "External PI feedback",
            "content": "Unrelated PIs can leave review feedback",
            "author": "",
            "audience": "team",
            "includeReviewers": True,
        },
    )

    assert unrelated_pi_feedback.status_code == 200
    assert unrelated_pi_feedback.json()["author"] == "Prof. Amara Osei"

    register_and_login(client, "n.adeyemi@thornbridge.ac.uk", "Nkechi Adeyemi")
    programme_manager_feedback = client.post(
        "/api/projects/sousbot/feedback",
        json={"title": "Programme manager feedback", "content": "Programme management follow-up", "author": ""},
    )

    assert programme_manager_feedback.status_code == 200
    assert programme_manager_feedback.json()["author"] == "Nkechi Adeyemi"


def test_feedback_edit_is_limited_to_author_or_admin(client):
    register_and_login(client, "k.yamamoto@lakemere.ac.uk", "Prof. Kenji Yamamoto")
    created = client.post(
        "/api/projects/sousbot/feedback",
        json={"title": "Original feedback", "content": "Only the author should edit this", "author": ""},
    )
    assert created.status_code == 200

    register_and_login(client, "e.whitfield@thornbridge.ac.uk", "Prof. Eleanor Whitfield")
    other_pi_edit = client.put(
        "/api/projects/sousbot/feedback/0",
        json={"content": "Trying to edit someone else's feedback"},
    )
    assert other_pi_edit.status_code == 403

    register_and_login(client, "n.adeyemi@thornbridge.ac.uk", "Nkechi Adeyemi")
    programme_manager_edit = client.put(
        "/api/projects/sousbot/feedback/0",
        json={"content": "The programme manager can edit feedback entries"},
    )
    assert programme_manager_edit.status_code == 403

    login(client)
    admin_edit = client.put(
        "/api/projects/sousbot/feedback/0",
        json={"content": "Admins can edit feedback entries"},
    )
    assert admin_edit.status_code == 200
    assert admin_edit.json()["feedback"][0]["content"] == "Admins can edit feedback entries"


def test_feedback_visibility_respects_audience_scopes(client):
    register_and_login(client, "a.osei@thornbridge.ac.uk", "Prof. Amara Osei")
    lead_only = client.post(
        "/api/projects/sousbot/feedback",
        json={"title": "Lead-only feedback", "content": "Just for the lead.", "author": "", "audience": "lead", "includeReviewers": False},
    )
    full_team = client.post(
        "/api/projects/sousbot/feedback",
        json={"title": "Team feedback", "content": "For the full team.", "author": "", "audience": "team", "includeReviewers": False},
    )
    review_scope = client.post(
        "/api/projects/sousbot/feedback",
        json={"title": "Review feedback", "content": "Visible to the project team plus PIs and reviewers.", "author": "", "audience": "team", "includeReviewers": True},
    )
    lead_plus_reviewers = client.post(
        "/api/projects/sousbot/feedback",
        json={"title": "Lead plus reviewers", "content": "Visible to the lead and reviewers.", "author": "", "audience": "lead", "includeReviewers": True},
    )
    assert lead_only.status_code == 200
    assert full_team.status_code == 200
    assert review_scope.status_code == 200
    assert lead_plus_reviewers.status_code == 200

    client.cookies.clear()

    public_project = client.get("/api/projects/sousbot")
    assert public_project.status_code == 200
    assert public_project.json()["feedback"] == []

    public_projects = client.get("/api/projects")
    assert public_projects.status_code == 200
    sousbot_public = next(project for project in public_projects.json() if project["id"] == "sousbot")
    assert sousbot_public["feedback"] == []

    register_and_login(client, "k.asante@lakemere.ac.uk", "Dr. Kwame Asante")
    lead_project = client.get("/api/projects/sousbot")
    assert lead_project.status_code == 200
    lead_titles = {entry["title"] for entry in lead_project.json()["feedback"]}
    assert {"Lead-only feedback", "Team feedback", "Review feedback", "Lead plus reviewers"}.issubset(lead_titles)

    register_and_login(client, "a.bakari@lakemere.ac.uk", "Aisha Bakari")
    contributor_project = client.get("/api/projects/sousbot")
    assert contributor_project.status_code == 200
    contributor_titles = {entry["title"] for entry in contributor_project.json()["feedback"]}
    assert "Lead-only feedback" not in contributor_titles
    assert "Lead plus reviewers" not in contributor_titles
    assert {"Team feedback", "Review feedback"}.issubset(contributor_titles)

    login_as(client, "a.osei@thornbridge.ac.uk")
    author_project = client.get("/api/projects/sousbot")
    assert author_project.status_code == 200
    author_titles = {entry["title"] for entry in author_project.json()["feedback"]}
    assert {"Lead-only feedback", "Team feedback", "Review feedback", "Lead plus reviewers"}.issubset(author_titles)

    register_and_login(client, "d.chen@aldhelm.ac.uk", "Prof. David Chen")
    unrelated_pi_project = client.get("/api/projects/sousbot")
    assert unrelated_pi_project.status_code == 200
    unrelated_titles = {entry["title"] for entry in unrelated_pi_project.json()["feedback"]}
    assert "Lead-only feedback" not in unrelated_titles
    assert "Team feedback" not in unrelated_titles
    assert "Review feedback" in unrelated_titles
    assert "Lead plus reviewers" in unrelated_titles

    register_and_login(client, "n.adeyemi@thornbridge.ac.uk", "Nkechi Adeyemi")
    programme_manager_project = client.get("/api/projects/sousbot")
    assert programme_manager_project.status_code == 200
    programme_manager_titles = {entry["title"] for entry in programme_manager_project.json()["feedback"]}
    assert "Lead-only feedback" not in programme_manager_titles
    assert "Team feedback" not in programme_manager_titles
    assert "Review feedback" in programme_manager_titles
    assert "Lead plus reviewers" in programme_manager_titles


def test_milestone_permissions_follow_project_lead(client):
    register_and_login(client, "k.asante@lakemere.ac.uk", "Dr. Kwame Asante")
    created = client.post(
        "/api/milestones",
        json={
            "project": "sousbot",
            "title": "Lead-owned milestone",
            "dueDate": "2026-06-30",
            "type": "research",
        },
    )
    assert created.status_code == 200
    milestone_id = created.json()["id"]

    register_and_login(client, "k.yamamoto@lakemere.ac.uk", "Prof. Kenji Yamamoto")
    pi_update = client.post(
        f"/api/milestones/{milestone_id}/complete",
        json={"completedDate": "2026-06-29"},
    )
    pi_create = client.post(
        "/api/milestones",
        json={
            "project": "sousbot",
            "title": "PI should not create this",
            "dueDate": "2026-07-30",
            "type": "research",
        },
    )

    assert pi_update.status_code == 403
    assert pi_create.status_code == 403

    register_and_login(client, "a.bakari@lakemere.ac.uk", "Aisha Bakari")
    contributor_update = client.post(
        f"/api/milestones/{milestone_id}/complete",
        json={"completedDate": "2026-06-29"},
    )
    assert contributor_update.status_code == 403

    login_as(client, "k.asante@lakemere.ac.uk")
    lead_update = client.post(
        f"/api/milestones/{milestone_id}/complete",
        json={"completedDate": "2026-06-29"},
    )
    assert lead_update.status_code == 200
    assert lead_update.json()["computedStatus"] == "completed"


def test_concept_note_updates_require_contributor_or_admin(client):
    register_and_login(client, "a.bakari@lakemere.ac.uk", "Aisha Bakari")
    notes_response = client.get("/api/conceptnotes")
    assert notes_response.status_code == 200
    note_id = notes_response.json()[0]["id"]

    blocked_update = client.put(
        f"/api/conceptnotes/{note_id}",
        json={"nextSteps": "Updated during an authenticated integration test."},
    )
    assert blocked_update.status_code == 403

    register_and_login(client, "p.ramanathan@lakemere.ac.uk", "Dr. Priya Ramanathan")
    allowed_update = client.put(
        f"/api/conceptnotes/{note_id}",
        json={"nextSteps": "Updated during a contributor integration test."},
    )

    assert allowed_update.status_code == 200
    assert allowed_update.json()["nextSteps"] == "Updated during a contributor integration test."


def test_concept_note_stewardship_fields_require_admin(client):
    register_and_login(client, "a.bakari@lakemere.ac.uk", "Aisha Bakari")
    notes_response = client.get("/api/conceptnotes")
    assert notes_response.status_code == 200
    note_id = notes_response.json()[0]["id"]
    related_note_id = notes_response.json()[1]["id"]

    denied = client.put(
        f"/api/conceptnotes/{note_id}",
        json={"progressSignals": [{"kind": "connection-made", "note": "Introduced two groups."}]},
    )
    assert denied.status_code == 403

    login(client)

    allowed = client.put(
        f"/api/conceptnotes/{note_id}",
        json={
            "progressSignals": [{"kind": "connection-made", "note": "Introduced two groups."}],
            "relatedConceptNoteIds": [related_note_id],
        },
    )
    assert allowed.status_code == 200
    assert allowed.json()["progressSignals"][0]["kind"] == "connection-made"
    assert allowed.json()["relatedConceptNoteIds"] == [related_note_id]


def test_concept_note_active_window_extensions_are_admin_only(client):
    notes_response = client.get("/api/conceptnotes")
    assert notes_response.status_code == 401

    login(client)
    notes_response = client.get("/api/conceptnotes")
    assert notes_response.status_code == 200
    note = notes_response.json()[0]
    note_id = note["id"]
    original_active_until = note["activeUntil"]

    register_and_login(client, "a.bakari@lakemere.ac.uk", "Aisha Bakari")
    denied = client.post(f"/api/conceptnotes/{note_id}/extend-active")
    assert denied.status_code == 403

    login(client)
    extended = client.post(f"/api/conceptnotes/{note_id}/extend-active")
    assert extended.status_code == 200
    assert extended.json()["activeUntil"] > original_active_until
    assert extended.json()["lastActiveExtension"]["previousActiveUntil"] == original_active_until

    undone = client.post(f"/api/conceptnotes/{note_id}/undo-active-extension")
    assert undone.status_code == 200
    assert undone.json()["activeUntil"] == original_active_until
    assert "lastActiveExtension" not in undone.json()


def test_new_record_ids_are_collision_safe_hex_strings(client):
    login(client)

    milestone_a = client.post(
        "/api/milestones",
        json={
            "project": "recipegraph",
            "title": "Collision-safe milestone A",
            "dueDate": "2026-08-01",
            "type": "research",
        },
    )
    milestone_b = client.post(
        "/api/milestones",
        json={
            "project": "recipegraph",
            "title": "Collision-safe milestone B",
            "dueDate": "2026-08-02",
            "type": "research",
        },
    )
    register_and_login(client, "k.yamamoto@lakemere.ac.uk", "Prof. Kenji Yamamoto")
    concept_note_a = client.post(
        "/api/conceptnotes",
        json={
            "title": "Collision-safe note A",
            "contributors": ["kenji"],
            "rationale": "A promising early direction worth keeping in view.",
        },
    )

    register_and_login(client, "a.osei@thornbridge.ac.uk", "Prof. Amara Osei")
    concept_note_b = client.post(
        "/api/conceptnotes",
        json={
            "title": "Collision-safe note B",
            "contributors": ["amara"],
            "rationale": "Another promising early direction worth keeping in view.",
        },
    )

    assert milestone_a.status_code == 200
    assert milestone_b.status_code == 200
    assert concept_note_a.status_code == 200
    assert concept_note_b.status_code == 200
    assert milestone_a.json()["id"] != milestone_b.json()["id"]
    assert concept_note_a.json()["id"] != concept_note_b.json()["id"]
    assert milestone_a.json()["id"].startswith("m")
    assert concept_note_a.json()["id"].startswith("cn")
    assert concept_note_a.json()["contributors"] == ["kenji"]
    assert concept_note_a.json()["activeUntil"] == server.compute_concept_note_active_until(concept_note_a.json()["createdAt"])


def test_get_admin_password_allows_dev_default(monkeypatch):
    monkeypatch.delenv("ADMIN_PASSWORD", raising=False)
    monkeypatch.setattr(server, "IS_PRODUCTION", False)

    assert server.get_admin_password() == server.DEFAULT_ADMIN_PASSWORD


def test_get_admin_password_rejects_missing_or_default_in_production(monkeypatch):
    monkeypatch.setattr(server, "IS_PRODUCTION", True)

    monkeypatch.delenv("ADMIN_PASSWORD", raising=False)
    with pytest.raises(RuntimeError, match="ADMIN_PASSWORD must be set"):
        server.get_admin_password()

    monkeypatch.setenv("ADMIN_PASSWORD", server.DEFAULT_ADMIN_PASSWORD)
    with pytest.raises(RuntimeError, match="development default"):
        server.get_admin_password()


def test_compute_milestone_status_variants():
    today = server.utc_now()

    assert server.compute_milestone_status({"status": "completed", "dueDate": "2026-01-01"}) == "completed"
    assert server.compute_milestone_status({"completedDate": "2026-01-08", "dueDate": "2026-01-01"}) == "completed"
    assert server.compute_milestone_status({"dueDate": (today - timedelta(days=3)).strftime("%Y-%m-%d")}) == "overdue"
    assert server.compute_milestone_status({"dueDate": (today + timedelta(days=7)).strftime("%Y-%m-%d")}) == "approaching"
    assert server.compute_milestone_status({"dueDate": (today + timedelta(days=90)).strftime("%Y-%m-%d")}) == "on-track"
    assert server.compute_milestone_status({"dueDate": "not-a-date"}) == "on-track"
