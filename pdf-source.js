import { createHash, randomUUID } from "node:crypto";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export const PDF_MAX_BYTES = 12 * 1024 * 1024;
export const PDF_MAX_PAGES = 100;
export const PDF_CAPSULE_CHAR_LIMIT = 50000;

const PDF_MAX_PAGE_CHARS = 12000;
const PDF_MAX_EXTRACTED_CHARS = 150000;
const PDF_INSPECTION_TTL_MS = 10 * 60 * 1000;
const PDF_INSPECTION_CACHE_LIMIT = 24;
const PDF_PARSE_TIMEOUT_MS = 20000;
const PDF_PAGE_TIMEOUT_MS = 4000;
const DIRECTIONAL_CONTROLS = /[\u202a-\u202e\u2066-\u2069]/g;
const pdfInspectionCache = new Map();

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(DIRECTIONAL_CONTROLS, "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function safeFileName(value) {
  const name = String(value || "").split(/[\\/]/).at(-1)?.trim() || "document.pdf";
  if (!name.toLowerCase().endsWith(".pdf")) throw httpError("Choose a PDF file.", 400);
  return cleanText(name, 180) || "document.pdf";
}

function decodePdfBase64(dataBase64) {
  if (typeof dataBase64 !== "string" || !dataBase64.length) throw httpError("The PDF upload is missing data.", 400);
  if (dataBase64.length > Math.ceil(PDF_MAX_BYTES / 3) * 4 + 4) {
    throw httpError(`PDFs must be ${Math.round(PDF_MAX_BYTES / (1024 * 1024))} MB or smaller.`, 413);
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64) || dataBase64.length % 4 === 1) {
    throw httpError("The PDF upload is not valid base64 data.", 400);
  }
  const buffer = Buffer.from(dataBase64, "base64");
  if (!buffer.length || buffer.length > PDF_MAX_BYTES) {
    throw httpError(`PDFs must be ${Math.round(PDF_MAX_BYTES / (1024 * 1024))} MB or smaller.`, 413);
  }
  if (!buffer.subarray(0, 1024).includes(Buffer.from("%PDF-"))) throw httpError("That file is not a valid PDF.", 422);
  return buffer;
}

function pageTextFromItems(items) {
  const lines = [];
  let line = "";
  let previousY = null;
  for (const item of items) {
    if (typeof item?.str !== "string") continue;
    const value = item.str.replace(DIRECTIONAL_CONTROLS, "").replace(/\s+/g, " ").trim();
    const y = Number(item.transform?.[5]);
    if (line && Number.isFinite(y) && Number.isFinite(previousY) && Math.abs(y - previousY) > 2) {
      lines.push(line.trim());
      line = "";
    }
    if (value) {
      const needsSpace = line && !/\s$/.test(line) && !/^[,.;:!?)]/.test(value);
      line += `${needsSpace ? " " : ""}${value}`;
    }
    if (item.hasEOL && line) {
      lines.push(line.trim());
      line = "";
    }
    if (Number.isFinite(y)) previousY = y;
  }
  if (line) lines.push(line.trim());
  return lines.filter(Boolean).join("\n").slice(0, PDF_MAX_PAGE_CHARS);
}

async function withTimeout(promise, timeoutMs, message) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(httpError(message, 408)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function pageLabel(text, pageNumber) {
  const firstLine = text.split("\n").map((line) => cleanText(line, 140)).find(Boolean);
  return firstLine || `Page ${pageNumber}`;
}

function pruneInspectionCache() {
  const now = Date.now();
  for (const [id, inspection] of pdfInspectionCache) {
    if (inspection.expiresAt <= now) pdfInspectionCache.delete(id);
  }
  while (pdfInspectionCache.size >= PDF_INSPECTION_CACHE_LIMIT) {
    pdfInspectionCache.delete(pdfInspectionCache.keys().next().value);
  }
}

function mappedPdfError(error) {
  if (error?.status) return error;
  if (error?.name === "PasswordException") {
    return httpError("Password-protected PDFs are not supported. Remove the password and try again.", 422);
  }
  if (["InvalidPDFException", "FormatError", "MissingPDFException"].includes(error?.name)) {
    return httpError("This PDF is malformed or unreadable. Export a fresh copy and try again.", 422);
  }
  return error;
}

export async function inspectPdfDocument({ fileName, mediaType, dataBase64 } = {}) {
  const normalizedFileName = safeFileName(fileName);
  if (mediaType && mediaType !== "application/pdf") throw httpError("Choose a PDF file.", 400);
  const buffer = decodePdfBase64(dataBase64);
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  let timeout;
  let pdf;
  try {
    pdf = await withTimeout(loadingTask.promise, PDF_PARSE_TIMEOUT_MS, "This PDF took too long to inspect.");
    if (pdf.numPages < 1) throw httpError("This PDF has no pages.", 422);
    if (pdf.numPages > PDF_MAX_PAGES) throw httpError(`PDFs can contain at most ${PDF_MAX_PAGES} pages.`, 413);

    const metadata = await pdf.getMetadata().catch(() => ({ info: {} }));
    const pages = [];
    let extractedCharacters = 0;
    const extractionDeadline = Date.now() + PDF_PARSE_TIMEOUT_MS;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const remainingMs = extractionDeadline - Date.now();
      if (remainingMs <= 0) throw httpError("This PDF took too long to extract.", 408);
      let page;
      try {
        const pageTimeout = Math.min(PDF_PAGE_TIMEOUT_MS, remainingMs);
        page = await withTimeout(pdf.getPage(pageNumber), pageTimeout, `Page ${pageNumber} took too long to open.`);
        const textContent = await withTimeout(
          page.getTextContent({ disableNormalization: false, includeMarkedContent: false }),
          Math.min(PDF_PAGE_TIMEOUT_MS, extractionDeadline - Date.now()),
          `Page ${pageNumber} took too long to extract.`
        );
        const text = pageTextFromItems(textContent.items);
        extractedCharacters += text.length;
        if (extractedCharacters > PDF_MAX_EXTRACTED_CHARS) {
          throw httpError(`This PDF exceeds the ${PDF_MAX_EXTRACTED_CHARS.toLocaleString()}-character extraction limit.`, 413);
        }
        pages.push({ pageNumber, label: pageLabel(text, pageNumber), text, charCount: text.length });
      } finally {
        page?.cleanup();
      }
    }
    if (!pages.some((page) => page.text.length >= 12)) {
      throw httpError("No readable text was found. Scanned PDFs need OCR before they can be added to Fuse.", 422);
    }

    const metadataInfo = metadata?.info || {};
    const fallbackTitle = normalizedFileName.replace(/\.pdf$/i, "");
    const title = cleanText(metadataInfo.Title, 180) || fallbackTitle;
    const digest = createHash("sha256").update(buffer).digest("hex");
    let defaultCharacters = 0;
    const responsePages = pages.map((page) => {
      const estimated = Math.min(page.charCount, PDF_MAX_PAGE_CHARS) + 80;
      const selected = defaultCharacters + estimated <= PDF_CAPSULE_CHAR_LIMIT || defaultCharacters === 0;
      if (selected) defaultCharacters += estimated;
      return {
        pageNumber: page.pageNumber,
        label: page.label,
        excerpt: cleanText(page.text, 220),
        charCount: page.charCount,
        selected,
      };
    });
    const inspectionId = randomUUID();
    const inspectedAt = new Date().toISOString();
    pruneInspectionCache();
    pdfInspectionCache.set(inspectionId, {
      expiresAt: Date.now() + PDF_INSPECTION_TTL_MS,
      title,
      fileName: normalizedFileName,
      fileSize: buffer.length,
      digest,
      pageCount: pdf.numPages,
      inspectedAt,
      metadata: {
        author: cleanText(metadataInfo.Author, 180),
        subject: cleanText(metadataInfo.Subject, 300),
        keywords: cleanText(metadataInfo.Keywords, 300),
        creationDate: cleanText(metadataInfo.CreationDate, 80),
      },
      pages,
    });
    return {
      inspectionId,
      document: {
        title,
        fileName: normalizedFileName,
        fileSize: buffer.length,
        pageCount: pdf.numPages,
        digest,
        inspectedAt,
        ...pdfInspectionCache.get(inspectionId).metadata,
      },
      pages: responsePages,
      budget: {
        maxCharacters: PDF_CAPSULE_CHAR_LIMIT,
        maxPageCharacters: PDF_MAX_PAGE_CHARS,
        estimatedCharacters: Math.min(defaultCharacters, PDF_CAPSULE_CHAR_LIMIT),
        estimatedTokens: Math.ceil(Math.min(defaultCharacters, PDF_CAPSULE_CHAR_LIMIT) / 4),
      },
    };
  } catch (error) {
    throw mappedPdfError(error);
  } finally {
    clearTimeout(timeout);
    await loadingTask.destroy().catch(() => {});
  }
}

export function buildPdfCapsule({ inspectionId, pages: requestedPages, role = "Evidence" } = {}) {
  pruneInspectionCache();
  const inspection = pdfInspectionCache.get(String(inspectionId || ""));
  if (!inspection) throw httpError("That PDF preview expired. Inspect the file again.", 410);
  if (!new Set(["Content", "Evidence", "Constraint"]).has(role)) throw httpError("Choose a valid document role.", 400);
  if (!Array.isArray(requestedPages) || !requestedPages.length || requestedPages.length > PDF_MAX_PAGES) {
    throw httpError("Choose at least one PDF page.", 400);
  }
  const pageNumbers = [...new Set(requestedPages.map(Number))];
  if (pageNumbers.length !== requestedPages.length || pageNumbers.some((page) => !Number.isInteger(page) || page < 1 || page > inspection.pageCount)) {
    throw httpError("One or more selected PDF pages are invalid.", 400);
  }
  const selected = inspection.pages.filter((page) => pageNumbers.includes(page.pageNumber));
  const sections = [];
  const provenancePages = [];
  const omitted = [];
  let usedCharacters = 0;
  for (const page of selected) {
    const separator = sections.length ? "\n\n" : "";
    const header = `--- PAGE ${page.pageNumber}: ${page.label} ---\n`;
    const available = PDF_CAPSULE_CHAR_LIMIT - usedCharacters - separator.length - header.length;
    if (available <= 0) {
      omitted.push({ pageNumber: page.pageNumber, reason: "capsule budget exhausted" });
      continue;
    }
    const marker = page.text.length > available ? "\n[PAGE TRUNCATED]" : "";
    const text = page.text.slice(0, Math.max(0, available - marker.length));
    if (!text) {
      omitted.push({ pageNumber: page.pageNumber, reason: "no readable text" });
      continue;
    }
    const truncated = text.length < page.text.length;
    const section = `${separator}${header}${text}${truncated ? marker : ""}`;
    sections.push(section);
    usedCharacters += section.length;
    provenancePages.push({ pageNumber: page.pageNumber, label: page.label, truncated });
  }
  const content = sections.join("");
  if (!content) throw httpError("None of the selected pages fit within the document budget.", 422);
  return {
    title: inspection.title,
    sourceType: "pdf-document",
    role,
    summary: `${provenancePages.length} selected page${provenancePages.length === 1 ? "" : "s"} from ${inspection.fileName}. Cite claims as “${inspection.title}, p. #”.`,
    content,
    assets: [],
    provenance: {
      provider: "local-upload",
      fileName: inspection.fileName,
      fileSize: inspection.fileSize,
      sha256: inspection.digest,
      pageCount: inspection.pageCount,
      inspectedAt: inspection.inspectedAt,
      pages: provenancePages,
      metadata: inspection.metadata,
    },
    freshness: "snapshot",
    permissions: "local-upload",
    tokenEstimate: Math.ceil(content.length / 4),
    omitted,
  };
}

export function validPdfCapsule(capsule) {
  const validPages = Array.isArray(capsule?.provenance?.pages)
    && capsule.provenance.pages.length > 0
    && capsule.provenance.pages.length <= PDF_MAX_PAGES
    && capsule.provenance.pages.every((page) => (
      Number.isInteger(page?.pageNumber)
      && page.pageNumber >= 1
      && page.pageNumber <= capsule.provenance.pageCount
      && typeof page.label === "string"
      && page.label.length <= 140
      && typeof page.truncated === "boolean"
    ));
  return Boolean(
    capsule?.sourceType === "pdf-document"
    && typeof capsule.title === "string"
    && capsule.title.length >= 1
    && capsule.title.length <= 180
    && ["Content", "Evidence", "Constraint"].includes(capsule.role)
    && typeof capsule.summary === "string"
    && capsule.summary.length <= 1000
    && typeof capsule.content === "string"
    && capsule.content.length >= 1
    && capsule.content.length <= PDF_CAPSULE_CHAR_LIMIT
    && Array.isArray(capsule.assets)
    && capsule.assets.length === 0
    && capsule.provenance?.provider === "local-upload"
    && typeof capsule.provenance.fileName === "string"
    && capsule.provenance.fileName.toLowerCase().endsWith(".pdf")
    && capsule.provenance.fileName.length <= 180
    && Number.isInteger(capsule.provenance.fileSize)
    && capsule.provenance.fileSize > 0
    && capsule.provenance.fileSize <= PDF_MAX_BYTES
    && /^[a-f0-9]{64}$/i.test(capsule.provenance.sha256 || "")
    && Number.isInteger(capsule.provenance.pageCount)
    && capsule.provenance.pageCount >= 1
    && capsule.provenance.pageCount <= PDF_MAX_PAGES
    && validPages
    && capsule.freshness === "snapshot"
    && capsule.permissions === "local-upload"
    && Number.isInteger(capsule.tokenEstimate)
    && capsule.tokenEstimate >= 1
    && capsule.tokenEstimate <= Math.ceil(PDF_CAPSULE_CHAR_LIMIT / 4)
  );
}