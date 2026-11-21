"""Local, bounded document OCR. Dates are suggestions, never approval decisions."""

import io
import json
import re
import subprocess
import sys
import unicodedata
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Literal

from PIL import Image, ImageFilter, ImageOps, ImageStat

MAX_FILE = 5 * 1024 * 1024


@dataclass
class OcrDates:
    status: Literal["READ", "UNREADABLE", "UNAVAILABLE"]
    issued_on: str | None = None
    expires_on: str | None = None
    national_ids: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def response(self) -> dict:
        return {
            "status": self.status,
            "issuedOn": self.issued_on,
            "expiresOn": self.expires_on,
            "nationalIds": self.national_ids,
            "warnings": self.warnings,
        }


@dataclass
class ImageQuality:
    status: Literal["ACCEPTED", "RETAKE", "UNAVAILABLE"]
    reason: str

    def response(self) -> dict:
        return {"status": self.status, "reason": self.reason}


def image_quality(data: bytes) -> ImageQuality:
    try:
        with Image.open(io.BytesIO(data)) as source:
            if source.width * source.height > 20_000_000:
                return ImageQuality(status="RETAKE", reason="IMAGE_TOO_LARGE")
            image = ImageOps.exif_transpose(source).convert("L")
            if min(image.size) < 360 or max(image.size) < 640:
                return ImageQuality(status="RETAKE", reason="IMAGE_TOO_SMALL")
            image.thumbnail((1600, 1600))
            w, h = image.size
            crop = image.crop((w // 10, h // 10, w * 9 // 10, h * 9 // 10))
            stats = ImageStat.Stat(crop)
            if stats.mean[0] < 15 or (stats.mean[0] > 250 and stats.stddev[0] < 10):
                return ImageQuality(status="RETAKE", reason="IMAGE_EXPOSURE")
            edges = crop.filter(
                ImageFilter.Kernel(
                    (3, 3), (0, 1, 0, 1, -4, 1, 0, 1, 0), scale=1, offset=128
                )
            )
            # Pillow leaves a one-pixel kernel border unchanged; exclude it so
            # the white page border cannot make an out-of-focus image look sharp.
            edges = edges.crop((1, 1, edges.width - 1, edges.height - 1))
            if stats.stddev[0] < 12 or ImageStat.Stat(edges).var[0] < 50:
                return ImageQuality(status="RETAKE", reason="IMAGE_BLURRY")
            return ImageQuality(status="ACCEPTED", reason="IMAGE_ACCEPTED")
    except (OSError, ValueError, Image.DecompressionBombError):
        return ImageQuality(status="RETAKE", reason="IMAGE_INVALID")


def date_suggestions(text: str) -> OcrDates:
    """Use labeled dates only; refuse ambiguous dates instead of guessing."""
    normalized = "".join(
        c
        for c in unicodedata.normalize("NFD", text.lower())
        if not unicodedata.combining(c)
    ).replace("đ", "d")
    normalized = re.sub(r"\s+", " ", normalized)[:100_000]
    identity_label = (
        r"(?:\b(?:so\s*)?(?:cccd|can cuoc(?: cong dan)?|so dinh danh(?: ca nhan)?|"
        r"citizen id|national id|personal id|id number)\b|\bso\s*[:#])"
    )
    national_ids = sorted(
        {
            re.sub(r"[^0-9]", "", match[1])
            for match in re.finditer(
                identity_label + r"[^0-9]{0,40}(\d(?:[ \-]?\d){11})(?![ \-]?\d)",
                normalized,
            )
        }
    )[:5]
    date_pattern = (
        r"(?:ngay\s*)?(\d{1,2})\s*(?:[/.-]|thang)\s*"
        r"(\d{1,2})\s*(?:[/.-]|nam)\s*(20\d{2})"
    )

    def labeled_dates(pattern: str) -> set[str]:
        matches: set[str] = set()
        for match in re.finditer(pattern + r"[^0-9]{0,30}" + date_pattern, normalized):
            try:
                matches.add(
                    date(int(match[3]), int(match[2]), int(match[1])).isoformat()
                )
            except ValueError:
                continue
        return matches

    issued_dates = labeled_dates(
        r"(?:ngay cap|cap ngay|ngay kham|kham ngay|issued on|date of issue)"
    )
    expiry_dates = labeled_dates(
        r"(?:co gia tri den|gia tri den|hieu luc den|den het ngay|ngay het han|het han|"
        r"thoi han den|ngay ket thuc|valid until|expiry date|expiration date|expires on)"
    )
    # A training course's date range is not the card's expiry. Only a range
    # explicitly labeled as insurance coverage may supply an expiry here.
    time_prefix = r"(?:\d{1,2}\s*[:h]\s*\d{2}\s*(?:gio\s*)?)?"
    coverage = (
        r"(?:thoi (?:han|gian) bao hiem|hieu luc bao hiem|"
        # Tesseract may read a capital I as lowercase l after PDF rasterization.
        r"[il]nsurance period|coverage period|period of [il]nsurance)"
        r"\s*[:\-]?\s*(?:tu|from)\s*"
        + time_prefix
        + date_pattern
        + r"\s*(?:den|to|until)\s*"
        + time_prefix
        + date_pattern
    )
    for match in re.finditer(coverage, normalized):
        try:
            starts = date(int(match[3]), int(match[2]), int(match[1]))
            ends = date(int(match[6]), int(match[5]), int(match[4]))
            if starts <= ends:
                expiry_dates.add(ends.isoformat())
        except ValueError:
            continue
    issued = next(iter(issued_dates)) if len(issued_dates) == 1 else None
    expires = next(iter(expiry_dates)) if len(expiry_dates) == 1 else None
    warnings = ["OFFICER_MUST_CONFIRM_DATES"]
    if issued is None:
        warnings.append("ISSUE_DATE_NOT_DETERMINED")
    if expires is None:
        warnings.append("EXPIRY_DATE_NOT_DETERMINED")
    return OcrDates(
        status="READ" if issued or expires or national_ids else "UNREADABLE",
        issued_on=issued,
        expires_on=expires,
        national_ids=national_ids,
        warnings=warnings,
    )


class LocalDocumentOcr:
    def __init__(self, tesseract: str | None, pdftoppm: str | None) -> None:
        self.tesseract = tesseract
        self.pdftoppm = pdftoppm

    def inspect(self, data: bytes, media_type: str) -> dict:
        unavailable = OcrDates(
            status="UNAVAILABLE", warnings=["OCR_UNAVAILABLE_REVIEW_ORIGINAL"]
        )
        with TemporaryDirectory(prefix="smartsite-inspect-") as folder:
            root = Path(folder)
            text_pages: list[str] = []
            if media_type == "application/pdf":
                if not self.pdftoppm:
                    return {
                        "quality": ImageQuality("UNAVAILABLE", "OCR_ENGINE_UNAVAILABLE").response(),
                        "ocr": unavailable.response(),
                        "valid": None,
                    }
                source = root / "document.pdf"
                source.write_bytes(data)
                binary = Path(self.pdftoppm)
                info_binary = binary.with_name(
                    "pdfinfo.exe" if binary.suffix == ".exe" else "pdfinfo"
                )
                info = subprocess.run(
                    [str(info_binary), str(source)],
                    check=True, timeout=5, capture_output=True,
                )
                pages = re.search(rb"(?m)^Pages:\s*(\d+)", info.stdout)
                if pages is None or not 1 <= int(pages[1]) <= 4:
                    return {
                        "quality": ImageQuality("RETAKE", "PDF_TOO_MANY_PAGES").response(),
                        "ocr": unavailable.response(),
                        "valid": False,
                    }
                text_binary = binary.with_name(
                    "pdftotext.exe" if binary.suffix == ".exe" else "pdftotext"
                )
                try:
                    extracted = subprocess.run(
                        [str(text_binary), "-layout", str(source), "-"],
                        check=True, timeout=5, capture_output=True,
                    )
                    text_pages = extracted.stdout[:100_000].decode(
                        "utf-8", errors="replace"
                    ).split("\f")
                except (OSError, subprocess.SubprocessError):
                    pass
                try:
                    subprocess.run(
                        [self.pdftoppm, "-r", "150", "-scale-to", "2200",
                         "-png", str(source), str(root / "page")],
                        check=True, timeout=15, capture_output=True,
                    )
                except subprocess.CalledProcessError:
                    return {
                        "quality": ImageQuality("RETAKE", "IMAGE_INVALID").response(),
                        "ocr": unavailable.response(),
                        "valid": False,
                    }
                images = sorted(root.glob("page-*.png"))
                if len(images) != int(pages[1]):
                    return {
                        "quality": ImageQuality("RETAKE", "IMAGE_INVALID").response(),
                        "ocr": unavailable.response(),
                        "valid": False,
                    }
            else:
                source = root / "page.png"
                with Image.open(io.BytesIO(data)) as raw:
                    if raw.width * raw.height > 20_000_000:
                        return {
                            "quality": ImageQuality("RETAKE", "IMAGE_TOO_LARGE").response(),
                            "ocr": unavailable.response(),
                        "valid": False,
                        }
                    image = ImageOps.exif_transpose(raw).convert("RGB")
                    image.thumbnail((2500, 2500))
                    image.save(source)
                images = [source]
            quality = ImageQuality("ACCEPTED", "IMAGE_ACCEPTED")
            texts: list[str] = []
            partial = False
            for index, image_path in enumerate(images):
                checked = image_quality(image_path.read_bytes())
                if checked.status != "ACCEPTED":
                    quality = checked
                native = text_pages[index] if index < len(text_pages) else ""
                if len(re.sub(r"\s", "", native)) >= 40:
                    texts.append(native)
                elif self.tesseract:
                    try:
                        # Four OCR pages and PDF decoding must fit the parent 60-second limit.
                        result = subprocess.run(
                            [self.tesseract, str(image_path), "stdout",
                             "-l", "vie+eng", "--psm", "3"],
                            check=True, timeout=7, capture_output=True,
                        )
                        texts.append(result.stdout[:100_000].decode(
                            "utf-8", errors="replace"
                        ))
                    except (OSError, subprocess.SubprocessError):
                        partial = True
                else:
                    partial = True
            evidence = date_suggestions("\n".join(texts)) if texts else unavailable
            if partial and texts:
                evidence.warnings.append("OCR_PARTIAL_REVIEW_ORIGINAL")
            return {"quality": quality.response(), "ocr": evidence.response(), "valid": True}

    def validate_pdf(self, data: bytes) -> dict:
        if not self.pdftoppm:
            return {"valid": None}
        try:
            result = LocalDocumentOcr(None, self.pdftoppm).inspect(
                data, "application/pdf"
            )
            return {"valid": result.get("valid")}
        except subprocess.CalledProcessError:
            return {"valid": False}
        except (OSError, ValueError, subprocess.SubprocessError):
            return {"valid": None}

    def read(self, data: bytes, media_type: str) -> OcrDates:
        if not self.tesseract and not (
            media_type == "application/pdf" and self.pdftoppm
        ):
            return OcrDates(status="UNAVAILABLE", warnings=["OCR_ENGINE_NOT_CONFIGURED"])
        try:
            result = self.inspect(data, media_type)["ocr"]
            return OcrDates(
                status=result["status"],
                issued_on=result["issuedOn"],
                expires_on=result["expiresOn"],
                national_ids=result["nationalIds"],
                warnings=result["warnings"],
            )
        except (OSError, ValueError, subprocess.SubprocessError):
            return OcrDates(status="UNAVAILABLE", warnings=["OCR_ENGINE_UNAVAILABLE"])


def main() -> None:
    """Private stdin/stdout adapter; no HTTP server, database access or raw-text logs."""
    if len(sys.argv) != 5 or sys.argv[1] not in {"ocr", "inspect", "validate"}:
        raise SystemExit(2)
    operation, media_type, tesseract, pdftoppm = sys.argv[1:]
    if media_type not in {"image/jpeg", "image/png", "application/pdf"}:
        raise SystemExit(2)
    data = sys.stdin.buffer.read(MAX_FILE + 1)
    signatures = {
        "image/jpeg": b"\xff\xd8\xff",
        "image/png": b"\x89PNG\r\n\x1a\n",
        "application/pdf": b"%PDF-",
    }
    if not data or len(data) > MAX_FILE or not data.startswith(signatures[media_type]):
        raise SystemExit(2)
    engine = LocalDocumentOcr(tesseract or None, pdftoppm or None)
    try:
        if operation == "inspect":
            result = engine.inspect(data, media_type)
        elif operation == "validate":
            result = engine.validate_pdf(data)
        else:
            result = engine.read(data, media_type).response()
        print(json.dumps(result))
    except (OSError, ValueError, subprocess.SubprocessError):
        print(json.dumps({"quality": {"status": "UNAVAILABLE", "reason": "OCR_ENGINE_UNAVAILABLE"}}))

if __name__ == "__main__":
    main()
