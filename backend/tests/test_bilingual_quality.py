import pytest
from app.domain import assess_message, render_template


@pytest.mark.parametrize("body", [
    "Hi Alex, I read your request for help with your community project. I can share my experience. No thanks is a perfectly fine answer.",
    "Hallo Alex, ik las je verzoek om hulp bij de buurt. Ik kan mijn ervaring met je delen als dat past. Nee bedankt is ook helemaal goed.",
    "Hallo Alex, je vraag over die dienst spreekt me aan. Ik kan je daar wellicht bij helpen. Geen interesse is een prima antwoord, zonder vervolg.",
])
def test_english_and_dutch_context_and_decline_are_recognized(body):
    assert assess_message(body, {"name": "Alex"}) == (100, [])


@pytest.mark.parametrize("phrase", ["koop nu", "beperkte tijd", "gegarandeerd", "handel nu", "buy now"])
def test_pressure_remains_a_warning_in_both_languages(phrase):
    body = f"Hallo Alex, ik zag je verzoek om hulp bij het project. {phrase}! Nee bedankt zeggen mag altijd en ik respecteer je antwoord."
    assert "promotional_pressure" in assess_message(body, {"name": "Alex"})[1]


def test_dutch_is_not_a_shortcut_around_other_review_signals():
    _, flags = assess_message("Koop nu!!!", {"name": "Alex"})
    assert {"missing_name", "too_short", "missing_context", "promotional_pressure", "excessive_punctuation", "missing_easy_decline"}.issubset(flags)


def test_template_fields_stay_canonical_and_user_text_is_not_translated():
    assert render_template("Hallo {name}, over {campaign}: {notes}", {"name": "Alex", "campaign": "My original request", "notes": "nee bedankt"}) == "Hallo Alex, over My original request: nee bedankt"
