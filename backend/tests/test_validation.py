import pytest

from app.validation import ValidationError, validate_faq_bytes


def test_accepts_utf8_markdown():
    text = "Q: What is your return window?\nA: " + ("Returns accepted within 30 days. " * 10)
    result = validate_faq_bytes("shop.md", text.encode("utf-8"))
    assert "return window" in result.lower()


def test_rejects_pdf_extension():
    with pytest.raises(ValidationError) as exc:
        validate_faq_bytes("shop.pdf", b"x" * 300)
    assert "extension" in exc.value.message.lower()


def test_rejects_empty_file():
    with pytest.raises(ValidationError) as exc:
        validate_faq_bytes("shop.txt", b"")
    assert "empty" in exc.value.message.lower()


def test_rejects_too_short():
    with pytest.raises(ValidationError) as exc:
        validate_faq_bytes("shop.txt", b"short")
    assert "200" in exc.value.message


def test_rejects_too_long():
    payload = ("word " * 3000).encode("utf-8")  # > 12000 chars
    with pytest.raises(ValidationError) as exc:
        validate_faq_bytes("shop.txt", payload)
    assert "12000" in exc.value.message.replace(",", "")


def test_rejects_invalid_utf8():
    with pytest.raises(ValidationError) as exc:
        validate_faq_bytes("shop.txt", b"\xff\xfe" + b"a" * 300)
    assert "utf-8" in exc.value.message.lower()
