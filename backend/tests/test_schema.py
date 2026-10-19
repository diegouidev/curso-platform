from django.core.management import call_command


def test_openapi_schema_is_valid_without_warnings(tmp_path):
    output = tmp_path / "schema.yml"

    call_command("spectacular", "--validate", "--fail-on-warn", "--file", str(output))

    content = output.read_text()
    assert "/api/auth/login" in content
    assert "/api/auth/refresh" in content
