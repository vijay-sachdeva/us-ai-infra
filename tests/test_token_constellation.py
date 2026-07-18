from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_text(encoding="utf-8")
JS = (ROOT / "app.js").read_text(encoding="utf-8")


def test_constellation_replaces_duplicate_jevons_panels():
    assert 'id="tokenConstellationChart"' in HTML
    assert 'id="jevonsP1"' not in HTML
    assert 'id="jevonsP2"' not in HTML
    assert 'id="jevonsP3"' not in HTML
    assert "tokenConstellationChart" in JS


def test_every_bubble_hover_exposes_decision_context():
    for detail in (
        "Modeled volume:",
        "Quarter share:",
        "Implied continuous power:",
        "Cheapest frontier price:",
        "dataset.definition",
    ):
        assert detail in JS


def test_meta_and_hosted_open_models_are_operationally_exclusive():
    assert 'name: "Meta-owned inference"' in HTML
    assert 'name: "Third-party hosted open models"' in HTML
    assert "excludes Meta-operated Llama traffic" in HTML
    assert "Meta-operated inference only" in JS
    assert "Third-party operated; Meta traffic excluded" in JS
