import os
from pathlib import Path
from typing import Optional

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from models import KnowledgeDocument, utc_now


STATUS_PENDING = "pending"
STATUS_PROCESSING = "processing"
STATUS_COMPLETED = "completed"
STATUS_FAILED = "failed"
PROCESSING_STATUSES = {
    STATUS_PENDING,
    STATUS_PROCESSING,
    STATUS_COMPLETED,
    STATUS_FAILED,
}

PDF_EXTENSIONS = {"pdf"}
IMAGE_EXTENSIONS = {"png", "jpg", "jpeg"}
MAX_EXTRACTED_TEXT_CHARS = int(os.getenv("KNOWLEDGE_MAX_EXTRACTED_TEXT_CHARS", "200000"))

_ocr_reader = None


class DocumentProcessingError(Exception):
    """Raised for extraction errors that should be shown to users."""


def reset_document_processing_state(db: Session, document: KnowledgeDocument) -> KnowledgeDocument:
    document.processing_status = STATUS_PENDING
    document.extracted_text = None
    document.extraction_error = None
    document.processed_at = None
    db.commit()
    db.refresh(document)
    return document


def process_document(db: Session, document_id: int) -> Optional[KnowledgeDocument]:
    document = db.get(KnowledgeDocument, document_id)
    if document is None:
        return None

    try:
        _mark_processing(db, document)
        extracted_text = extract_document_text(document)
        _mark_completed(db, document, _limit_extracted_text(extracted_text))
    except DocumentProcessingError as exc:
        _mark_failed(db, document, str(exc))
    except Exception as exc:
        _mark_failed(db, document, f"Extraction failed: {_clean_error(exc)}")

    return document


def extract_document_text(document: KnowledgeDocument) -> str:
    file_path = Path(document.storage_path)
    if not file_path.exists() or not file_path.is_file():
        raise DocumentProcessingError("Extraction failed because the stored file could not be found.")

    extension = (document.file_extension or file_path.suffix.lstrip(".")).lower()
    if extension in PDF_EXTENSIONS:
        return extract_pdf_text(file_path)
    if extension in IMAGE_EXTENSIONS:
        return extract_image_text(file_path)

    raise DocumentProcessingError("Unsupported file type. Only PDF, PNG, JPG, and JPEG files can be processed.")


def extract_pdf_text(file_path: Path) -> str:
    try:
        import fitz
    except ImportError as exc:
        raise DocumentProcessingError("PDF extraction is not available. Install PyMuPDF and retry.") from exc

    page_text_blocks: list[str] = []

    try:
        with fitz.open(file_path) as pdf:
            for page_index, page in enumerate(pdf, start=1):
                page_text = (page.get_text("text") or "").strip()
                if page_text:
                    page_text_blocks.append(f"Page {page_index}\n{page_text}")
                else:
                    page_text_blocks.append(f"Page {page_index}")
    except Exception as exc:
        raise DocumentProcessingError(f"PDF extraction failed: {_clean_error(exc)}") from exc

    return "\n\n".join(page_text_blocks).strip()


def extract_image_text(file_path: Path) -> str:
    try:
        reader = _get_ocr_reader()
    except ImportError as exc:
        raise DocumentProcessingError("OCR is not available. Install EasyOCR and retry.") from exc
    except Exception as exc:
        raise DocumentProcessingError(f"OCR failed: {_clean_error(exc)}") from exc

    try:
        results = reader.readtext(str(file_path), detail=0, paragraph=True)
    except Exception as exc:
        raise DocumentProcessingError(f"OCR failed: {_clean_error(exc)}") from exc

    lines = [str(item).strip() for item in results if str(item).strip()]
    return "\n".join(lines).strip()


def _get_ocr_reader():
    global _ocr_reader
    if _ocr_reader is None:
        import easyocr

        _ocr_reader = easyocr.Reader(["en"], gpu=False)
    return _ocr_reader


def _mark_processing(db: Session, document: KnowledgeDocument) -> None:
    document.processing_status = STATUS_PROCESSING
    document.extraction_error = None
    document.processed_at = None
    _commit_status_update(db)


def _mark_completed(db: Session, document: KnowledgeDocument, extracted_text: str) -> None:
    document.processing_status = STATUS_COMPLETED
    document.extracted_text = extracted_text
    document.extraction_error = None
    document.processed_at = utc_now()
    _commit_status_update(db)


def _mark_failed(db: Session, document: KnowledgeDocument, error_message: str) -> None:
    document.processing_status = STATUS_FAILED
    document.extraction_error = error_message[:2000]
    document.processed_at = utc_now()
    _commit_status_update(db)


def _commit_status_update(db: Session) -> None:
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise


def _limit_extracted_text(text: str) -> str:
    normalized_text = (text or "").strip()
    if len(normalized_text) <= MAX_EXTRACTED_TEXT_CHARS:
        return normalized_text

    notice = f"\n\n[Extracted text truncated at {MAX_EXTRACTED_TEXT_CHARS} characters.]"
    if MAX_EXTRACTED_TEXT_CHARS <= len(notice):
        return normalized_text[:MAX_EXTRACTED_TEXT_CHARS]

    return normalized_text[: MAX_EXTRACTED_TEXT_CHARS - len(notice)].rstrip() + notice


def _clean_error(exc: Exception) -> str:
    return str(exc).strip() or exc.__class__.__name__
