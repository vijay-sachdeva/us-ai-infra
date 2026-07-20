"""Offline contract tests for the twice-daily dashboard refresh."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCHEDULED = ROOT / ".github" / "workflows" / "daily-refresh.yml"
RECOVERY = ROOT / ".github" / "workflows" / "refresh-data.yml"


def test_refresh_runs_at_six_and_two_pacific():
    workflow = SCHEDULED.read_text(encoding="utf-8")
    assert 'cron: "0 6,14 * * *"' in workflow
    assert 'timezone: "America/Los_Angeles"' in workflow


def test_every_programmatic_feed_is_in_the_scheduled_refresh():
    workflow = SCHEDULED.read_text(encoding="utf-8")
    required_scripts = (
        "fetch_grid.py",
        "fetch_power_econ.py",
        "build_queues.py",
        "build_siting.py",
        "fetch_gpu_prices.py",
        "fetch_sec_filings.py",
        "daily_refresh.py",
        "propose_connections.py",
        "archive_history.py",
    )
    missing = [script for script in required_scripts if script not in workflow]
    assert not missing, "scheduled refresh omits: %s" % ", ".join(missing)


def test_refresh_attempts_remaining_sources_and_reports_partial_failure():
    workflow = SCHEDULED.read_text(encoding="utf-8")
    assert "id: public_data" in workflow
    assert "continue-on-error: true" in workflow
    assert "Surface partial refresh failures" in workflow
    assert "Report failure as an issue" in workflow


def test_data_only_recovery_is_manual_not_a_second_schedule():
    workflow = RECOVERY.read_text(encoding="utf-8")
    assert "workflow_dispatch" in workflow
    assert "schedule:" not in workflow
    assert "group: dashboard-refresh" in workflow
