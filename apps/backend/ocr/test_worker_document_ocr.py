"""Synthetic OCR fixtures; no document data, engine install or network required."""

import io
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont
from worker_document_ocr import LocalDocumentOcr, date_suggestions, image_quality


def test_labeled_dates_and_vietnamese_card_expiry() -> None:
    result = date_suggestions(
        "Ngày sinh 01/01/1990. Ngày cấp: 17/10/2026. Thẻ có giá trị đến ngày 17/10/2028."
    )
    assert result.issued_on == "2026-10-17"
    assert result.expires_on == "2028-10-17"
    assert result.status == "READ"


def test_unlabeled_and_ambiguous_dates_are_not_invented() -> None:
    assert date_suggestions("Ngày sinh 01/01/1990. 17/10/2026").expires_on is None
    result = date_suggestions("Hết hạn 17/10/2026. Hết hạn 18/10/2026")
    assert result.expires_on is None
    assert date_suggestions("Ngày cấp 30/02/2026").issued_on is None
    assert (
        date_suggestions("Giá trị đến ngày 17 tháng 10 năm 2028").expires_on
        == "2028-10-17"
    )


def test_missing_local_engines_remain_unavailable() -> None:
    assert (
        LocalDocumentOcr(None, None).read(b"synthetic", "image/jpeg").status
        == "UNAVAILABLE"
    )
    assert (
        LocalDocumentOcr("tesseract", None).read(b"%PDF-1.7", "application/pdf").status
        == "UNAVAILABLE"
    )


def test_sharp_document_is_accepted_and_blur_tiny_dark_are_rejected() -> None:
    image = Image.new("RGB", (1200, 800), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=28)
    for line in range(18):
        draw.text(
            (100, 60 + line * 36),
            "SYNTHETIC DOCUMENT - CLEAR TEXT 0123456789",
            fill="black",
            font=font,
        )

    def encoded(candidate: Image.Image) -> bytes:
        output = io.BytesIO()
        candidate.save(output, format="PNG")
        return output.getvalue()

    assert image_quality(encoded(image)).status == "ACCEPTED"
    assert (
        image_quality(encoded(image.filter(ImageFilter.GaussianBlur(8)))).status
        == "RETAKE"
    )
    assert image_quality(encoded(image.resize((240, 160)))).reason == "IMAGE_TOO_SMALL"
    assert (
        image_quality(encoded(Image.new("RGB", (1200, 800), "black"))).reason
        == "IMAGE_EXPOSURE"
    )


def test_citizen_ids_preserve_leading_zero_and_require_a_label_and_twelve_digits() -> (
    None
):
    result = date_suggestions("Số CCCD: 012345678901. National ID: 098 765 432 109")
    assert result.national_ids == ["012345678901", "098765432109"]
    assert result.status == "READ"
    assert date_suggestions("Số: 012345678901").national_ids == ["012345678901"]
    for text in [
        "Ngày sinh: 17/10/1990",
        "CCCD: 0123456789012",
        "CMND: 123456789",
        "012345678901",
    ]:
        assert date_suggestions(text).national_ids == []


def test_pdf_ocr_insurance_label_confusion_still_requires_an_explicit_coverage_period() -> (
    None
):
    result = date_suggestions("lnsurance period: from 17/10/2026 to 17/10/2027")
    assert result.expires_on == "2027-10-17"
    assert result.issued_on is None


def test_insurance_ranges_supply_expiry_without_inventing_issue_dates() -> None:
    for text in [
        "Thời hạn bảo hiểm: từ ngày 17/10/2026 đến ngày 17/10/2027",
        "Thời gian bảo hiểm: từ 00:00 ngày 17/10/2026 đến 24:00 ngày 17/10/2027",
        "Coverage period: from 17/10/2026 to 17/10/2027",
    ]:
        result = date_suggestions(text)
        assert result.expires_on == "2027-10-17"
        assert result.issued_on is None
    assert (
        date_suggestions(
            "Khóa huấn luyện từ ngày 17/10/2026 đến ngày 18/10/2026"
        ).expires_on
        is None
    )
    assert (
        date_suggestions(
            "Thời hạn bảo hiểm từ ngày 18/10/2027 đến ngày 17/10/2026"
        ).expires_on
        is None
    )
    assert (
        date_suggestions(
            "Thời hạn bảo hiểm từ ngày 17/10/2026 đến ngày 17/10/2027. Hết hạn 18/10/2027"
        ).expires_on
        is None
    )


def load_tests(loader, suite, pattern):
    import unittest

    return unittest.TestSuite(
        unittest.FunctionTestCase(value)
        for key, value in globals().items()
        if key.startswith("test_") and callable(value)
    )


def test_private_cli_validates_bytes_and_emits_only_bounded_suggestions():
    script = str(Path(__file__).with_name("worker_document_ocr.py"))
    args = [sys.executable, "-I", script, "ocr", "image/png", "", ""]
    for data in [b"wrong signature", b"\x89PNG\r\n\x1a\n" + b"x" * (5 * 1024 * 1024)]:
        rejected = subprocess.run(
            args, input=data, capture_output=True, timeout=5, check=False
        )
        assert rejected.returncode == 2
        assert rejected.stdout == b""
    image = Image.new("RGB", (1200, 800), "white")
    encoded = io.BytesIO()
    image.save(encoded, format="PNG")
    result = subprocess.run(
        args, input=encoded.getvalue(), capture_output=True, timeout=5, check=False
    )
    assert result.returncode == 0
    response = json.loads(result.stdout)
    assert response["status"] == "UNAVAILABLE"
    assert response["nationalIds"] == []
    assert set(response) == {
        "status",
        "issuedOn",
        "expiresOn",
        "nationalIds",
        "warnings",
    }


def test_combined_inspection_shares_rendered_pages_and_uses_native_pdf_text_first():
    from unittest.mock import patch
    from types import SimpleNamespace

    calls = []
    native = "SYNTHETIC HEALTH CERTIFICATE. Date of issue: 17/10/2026. " * 2

    def run(args, **kwargs):
        calls.append(Path(args[0]).stem)
        command = Path(args[0]).stem
        if command == "pdfinfo":
            return SimpleNamespace(stdout=b"Pages: 2\n", returncode=0)
        if command == "pdftotext":
            return SimpleNamespace(stdout=(native + "\f\f").encode(), returncode=0)
        if command == "pdftoppm":
            root = Path(args[-1]).parent
            for index in (1, 2):
                Image.new("RGB", (800, 600), "white").save(root / f"page-{index}.png")
            return SimpleNamespace(stdout=b"", returncode=0)
        assert command == "tesseract"
        return SimpleNamespace(stdout=b"Expiry date: 17/10/2028", returncode=0)

    with patch("worker_document_ocr.subprocess.run", side_effect=run):
        result = LocalDocumentOcr("tesseract", "pdftoppm").inspect(
            b"%PDF-synthetic", "application/pdf"
        )
    assert result["ocr"]["issuedOn"] == "2026-10-17"
    assert result["ocr"]["expiresOn"] == "2028-10-17"
    assert result["quality"]["status"] == "RETAKE"
    assert calls.count("pdftoppm") == 1
    assert calls.count("tesseract") == 1


def test_partial_pdf_ocr_preserves_native_evidence_when_scan_engine_fails():
    from unittest.mock import patch
    from types import SimpleNamespace

    def run(args, **kwargs):
        command = Path(args[0]).stem
        if command == "pdfinfo":
            return SimpleNamespace(stdout=b"Pages: 2\n", returncode=0)
        if command == "pdftotext":
            return SimpleNamespace(
                stdout=b"SYNTHETIC DOCUMENT. Date of issue: 17/10/2026. Native text.\f\f"
            )
        if command == "pdftoppm":
            root = Path(args[-1]).parent
            for index in (1, 2):
                Image.new("RGB", (800, 600), "white").save(root / f"page-{index}.png")
            return SimpleNamespace(stdout=b"")
        raise subprocess.TimeoutExpired(args, 10)

    with patch("worker_document_ocr.subprocess.run", side_effect=run):
        result = LocalDocumentOcr("tesseract", "pdftoppm").inspect(
            b"%PDF-synthetic", "application/pdf"
        )
    assert result["ocr"]["issuedOn"] == "2026-10-17"
    assert "OCR_PARTIAL_REVIEW_ORIGINAL" in result["ocr"]["warnings"]


def test_pdf_validation_enforces_actual_page_limit_and_reports_missing_tools():
    from unittest.mock import patch
    from types import SimpleNamespace

    engine = LocalDocumentOcr(None, "pdftoppm")
    for pages, expected in [(0, False), (1, True), (4, True), (5, False)]:
        def run(args, **kwargs):
            command = Path(args[0]).stem
            if command == "pdfinfo":
                return SimpleNamespace(stdout=f"Pages: {pages}\n".encode())
            if command == "pdftoppm":
                root = Path(args[-1]).parent
                for index in range(1, pages + 1):
                    Image.new("RGB", (800, 600), "white").save(
                        root / f"page-{index}.png"
                    )
            return SimpleNamespace(stdout=b"")
        with patch("worker_document_ocr.subprocess.run", side_effect=run):
            assert engine.validate_pdf(b"%PDF-synthetic")["valid"] is expected
    with patch("worker_document_ocr.subprocess.run",
               side_effect=subprocess.CalledProcessError(1, "pdfinfo")):
        assert engine.validate_pdf(b"%PDF-corrupt")["valid"] is False
    assert LocalDocumentOcr(None, None).validate_pdf(b"%PDF")["valid"] is None


def test_pdf_with_readable_metadata_but_broken_page_content_is_rejected():
    from unittest.mock import patch
    from types import SimpleNamespace

    def run(args, **kwargs):
        command = Path(args[0]).stem
        if command == "pdfinfo":
            return SimpleNamespace(stdout=b"Pages: 1\n")
        if command == "pdftotext":
            return SimpleNamespace(stdout=b"")
        raise subprocess.CalledProcessError(1, args)
    with patch("worker_document_ocr.subprocess.run", side_effect=run):
        engine = LocalDocumentOcr(None, "pdftoppm")
        assert engine.validate_pdf(b"%PDF-corrupt")["valid"] is False
        assert engine.inspect(b"%PDF-corrupt", "application/pdf")["quality"]["reason"] == "IMAGE_INVALID"


def test_large_image_reason_is_not_confused_with_tiny_image():
    output = io.BytesIO()
    Image.new("RGB", (5000, 4001), "white").save(output, format="PNG")
    assert image_quality(output.getvalue()).reason == "IMAGE_TOO_LARGE"
