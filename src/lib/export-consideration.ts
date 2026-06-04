// Client-side PDF export for the Consideration for Change panel. Builds an
// A4 portrait document programmatically with jsPDF (no html-to-canvas raster
// — text stays selectable / searchable / accessible in the output).
//
// The layout mirrors the structure of the in-app panel, restyled for print:
// optional banner strip → title + recruiter line → quote block → value chips →
// role comparison table → financial table → recruiter notes → footer.

import { jsPDF } from "jspdf";
import { saveAs } from "file-saver";
import {
  VALUE_LABELS,
  COMPARISON_FACTORS,
  FINANCIAL_ROWS,
} from "@/components/consideration-constants";

type Verdict = "left" | "right" | "both";

export interface Consideration {
  values: number[];
  comparison: Record<string, Verdict>;
  financial: Record<string, { l: string; r: string }>;
  candidate_reasons: string;
}

export interface BrandingForExport {
  banner?: string;
  bannerHeight?: number;
  companyName?: string;
  footer?: string;
}

export interface ExportArgs {
  caseName: string;
  recruiterName: string;
  newCompany: string;
  currentCompany: string;
  consideration: Consideration;
  recruiterNotes: string;
  branding: BrandingForExport;
}

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 18;
const CONTENT_W = PAGE_W - MARGIN * 2;

// Theme colours (matched to globals.css :root tokens so the PDF doesn't look
// out of place next to the in-app view).
const NAVY = "#111827";
const ACCENT = "#1e40af";
const ACCENT_LIGHT = "#eff6ff";
const TEXT_SECONDARY = "#4b5563";
const TEXT_MUTED = "#9ca3af";
const BORDER = "#e2e5ea";
const BORDER_LIGHT = "#eef0f3";
const SURFACE_ALT = "#f9fafb";
const GREEN = "#059669";
const GREEN_LIGHT = "#ecfdf5";

const FIN_TOTAL_IDX = 7;
const FIN_PENSION_IDX = 4;
const FIN_CURRENCY_INDICES = [0, 1, 2, 3, 5, 6];

function parseGbp(s: string): number {
  if (!s) return 0;
  const n = parseFloat(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function fmtGbp(n: number): string {
  return n <= 0 ? "—" : "£" + Math.round(n).toLocaleString("en-GB");
}

function safeFilename(name: string): string {
  const cleaned = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (cleaned || "candidate") + "-consideration.pdf";
}

// Probe an image data URL for its native dimensions so we can size the banner
// strip without distorting the aspect ratio.
function imageDimensions(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    if (typeof Image === "undefined") {
      reject(new Error("Image not available"));
      return;
    }
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// Page-break helper. Call before drawing a block of known height; returns the
// y coordinate the block should start at (resetting to top of a new page if it
// wouldn't fit).
class Cursor {
  y: number;
  doc: jsPDF;
  bottomLimit: number;
  constructor(doc: jsPDF, startY: number) {
    this.doc = doc;
    this.y = startY;
    this.bottomLimit = PAGE_H - MARGIN - 14; // leave room for footer
  }
  ensure(height: number): void {
    if (this.y + height > this.bottomLimit) {
      this.doc.addPage();
      this.y = MARGIN;
    }
  }
  advance(amount: number): void {
    this.y += amount;
  }
}

function drawSectionLabel(doc: jsPDF, label: string, c: Cursor) {
  c.ensure(8);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(TEXT_MUTED);
  doc.text(label.toUpperCase(), MARGIN, c.y, { baseline: "top" });
  c.advance(5.5);
}

function drawDivider(doc: jsPDF, c: Cursor) {
  doc.setDrawColor(BORDER);
  doc.setLineWidth(0.2);
  doc.line(MARGIN, c.y, MARGIN + CONTENT_W, c.y);
  c.advance(4);
}

function drawQuoteBlock(doc: jsPDF, text: string, c: Cursor) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(TEXT_SECONDARY);
  const padding = 5;
  const innerWidth = CONTENT_W - padding * 2;
  const lines = doc.splitTextToSize(text, innerWidth);
  const blockHeight = lines.length * 5 + padding * 2;
  c.ensure(blockHeight);
  // Left accent bar
  doc.setFillColor(ACCENT);
  doc.rect(MARGIN, c.y, 1.2, blockHeight, "F");
  // Light fill
  doc.setFillColor(SURFACE_ALT);
  doc.rect(MARGIN + 1.2, c.y, CONTENT_W - 1.2, blockHeight, "F");
  // Text
  doc.text(lines, MARGIN + padding + 1.5, c.y + padding, { baseline: "top" });
  c.advance(blockHeight + 4);
}

function drawValueChips(doc: jsPDF, indices: number[], c: Cursor) {
  if (indices.length === 0) return;
  const padX = 4;
  const padY = 1.6;
  const gap = 2;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  let xCursor = MARGIN;
  let rowH = 6;
  // Pre-flow into rows so we can ensure() per-row.
  const rows: Array<Array<{ text: string; w: number }>> = [[]];
  for (const i of indices) {
    const label = VALUE_LABELS[i];
    if (!label) continue;
    const w = doc.getTextWidth(label) + padX * 2;
    if (xCursor + w > MARGIN + CONTENT_W) {
      rows.push([]);
      xCursor = MARGIN;
    }
    rows[rows.length - 1].push({ text: label, w });
    xCursor += w + gap;
  }
  for (const row of rows) {
    if (row.length === 0) continue;
    c.ensure(rowH + 1.5);
    let x = MARGIN;
    for (const chip of row) {
      doc.setFillColor(ACCENT_LIGHT);
      doc.setDrawColor("#bfdbfe");
      doc.setLineWidth(0.2);
      doc.roundedRect(x, c.y, chip.w, rowH, 2.5, 2.5, "FD");
      doc.setTextColor(ACCENT);
      doc.text(chip.text, x + padX, c.y + rowH / 2, { baseline: "middle" });
      x += chip.w + gap;
    }
    c.advance(rowH + 1.5);
  }
  c.advance(2);
}

function drawRoleComparison(
  doc: jsPDF,
  left: string,
  right: string,
  comparison: Record<string, Verdict>,
  c: Cursor,
) {
  const rowH = 6;
  const headerH = 7;
  const colW = CONTENT_W / 2;

  let leftScore = 0, rightScore = 0;
  for (let i = 0; i < COMPARISON_FACTORS.length; i++) {
    const v = comparison[String(i)];
    if (v === "left") leftScore++;
    else if (v === "right") rightScore++;
    else if (v === "both") { leftScore++; rightScore++; }
  }

  const factorsToRender = COMPARISON_FACTORS
    .map((factor, i) => ({ factor, v: comparison[String(i)] as Verdict | undefined }))
    .filter((row) => row.v); // only show factors with a verdict

  const totalHeight = headerH + (factorsToRender.length * rowH) + 9 /* footer */;
  c.ensure(totalHeight);

  // Header row
  doc.setFillColor(ACCENT_LIGHT);
  doc.rect(MARGIN, c.y, colW, headerH, "F");
  doc.setFillColor(SURFACE_ALT);
  doc.rect(MARGIN + colW, c.y, colW, headerH, "F");
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(ACCENT);
  doc.text(left.toUpperCase(), MARGIN + 3, c.y + headerH / 2, { baseline: "middle" });
  doc.setTextColor(TEXT_MUTED);
  doc.text(right.toUpperCase(), MARGIN + colW + 3, c.y + headerH / 2, { baseline: "middle" });
  // Borders
  doc.setDrawColor(BORDER);
  doc.setLineWidth(0.2);
  doc.rect(MARGIN, c.y, CONTENT_W, headerH, "S");
  c.advance(headerH);

  // Factor rows
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  for (const { factor, v } of factorsToRender) {
    c.ensure(rowH);
    const leftOn = v === "left" || v === "both";
    const rightOn = v === "right" || v === "both";
    // Cell backgrounds (subtle, only for the winning side)
    if (leftOn) {
      doc.setFillColor(ACCENT_LIGHT);
      doc.rect(MARGIN, c.y, colW, rowH, "F");
    }
    if (rightOn) {
      doc.setFillColor(SURFACE_ALT);
      doc.rect(MARGIN + colW, c.y, colW, rowH, "F");
    }
    // Text
    doc.setTextColor(leftOn ? ACCENT : TEXT_MUTED);
    doc.text((leftOn ? "✓ " : "  ") + factor, MARGIN + 3, c.y + rowH / 2, { baseline: "middle" });
    doc.setTextColor(rightOn ? GREEN : TEXT_MUTED);
    doc.text((rightOn ? "✓ " : "  ") + factor, MARGIN + colW + 3, c.y + rowH / 2, { baseline: "middle" });
    // Row separator
    doc.setDrawColor(BORDER_LIGHT);
    doc.line(MARGIN, c.y + rowH, MARGIN + CONTENT_W, c.y + rowH);
    c.advance(rowH);
  }

  // Score footer
  c.ensure(9);
  doc.setFillColor(ACCENT_LIGHT);
  doc.rect(MARGIN, c.y, colW, 9, "F");
  doc.setFillColor(SURFACE_ALT);
  doc.rect(MARGIN + colW, c.y, colW, 9, "F");
  doc.setDrawColor(BORDER);
  doc.setLineWidth(0.3);
  doc.rect(MARGIN, c.y, CONTENT_W, 9, "S");
  // Numbers + labels
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(ACCENT);
  doc.text(String(leftScore), MARGIN + 4, c.y + 4.3, { baseline: "middle" });
  doc.setTextColor(NAVY);
  doc.text(String(rightScore), MARGIN + colW + 4, c.y + 4.3, { baseline: "middle" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(TEXT_MUTED);
  doc.text("factors favour " + left, MARGIN + 12, c.y + 5.4, { baseline: "middle" });
  doc.text("factors favour " + right, MARGIN + colW + 12, c.y + 5.4, { baseline: "middle" });
  c.advance(9 + 4);
}

function drawFinancialTable(
  doc: jsPDF,
  left: string,
  right: string,
  financial: Record<string, { l: string; r: string }>,
  c: Cursor,
) {
  const headerH = 7;
  const rowH = 6;
  const totalH = 8;
  const itemColW = CONTENT_W * 0.4;
  const valueColW = (CONTENT_W - itemColW) / 2;

  // Filter to rows that have any value.
  const populated = FINANCIAL_ROWS.slice(0, FIN_TOTAL_IDX)
    .map((label, i) => ({ label, i, row: financial[String(i)] }))
    .filter((x) => x.row && (x.row.l || x.row.r));

  if (populated.length === 0) return;

  let tl = 0, tr = 0;
  for (const i of FIN_CURRENCY_INDICES) {
    const row = financial[String(i)];
    if (row) {
      tl += parseGbp(row.l ?? "");
      tr += parseGbp(row.r ?? "");
    }
  }

  const blockH = headerH + populated.length * rowH + totalH;
  c.ensure(blockH);

  // Header
  doc.setFillColor(SURFACE_ALT);
  doc.rect(MARGIN, c.y, CONTENT_W, headerH, "F");
  doc.setDrawColor(BORDER);
  doc.setLineWidth(0.2);
  doc.rect(MARGIN, c.y, CONTENT_W, headerH, "S");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(TEXT_MUTED);
  doc.text("ITEM", MARGIN + 3, c.y + headerH / 2, { baseline: "middle" });
  doc.setTextColor(ACCENT);
  doc.text(left.toUpperCase(), MARGIN + itemColW + 3, c.y + headerH / 2, { baseline: "middle" });
  doc.setTextColor(TEXT_MUTED);
  doc.text(right.toUpperCase(), MARGIN + itemColW + valueColW + 3, c.y + headerH / 2, { baseline: "middle" });
  c.advance(headerH);

  // Rows
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  for (const { label, i, row } of populated) {
    c.ensure(rowH);
    const isPension = i === FIN_PENSION_IDX;
    const fmt = (raw: string) => {
      if (!raw) return "—";
      const n = parseGbp(raw);
      if (n <= 0) return raw;
      return isPension ? `${n}%` : fmtGbp(n);
    };
    doc.setTextColor(TEXT_SECONDARY);
    doc.text(label, MARGIN + 3, c.y + rowH / 2, { baseline: "middle" });
    doc.setTextColor(NAVY);
    doc.text(fmt(row!.l), MARGIN + itemColW + 3, c.y + rowH / 2, { baseline: "middle" });
    doc.text(fmt(row!.r), MARGIN + itemColW + valueColW + 3, c.y + rowH / 2, { baseline: "middle" });
    doc.setDrawColor(BORDER_LIGHT);
    doc.line(MARGIN, c.y + rowH, MARGIN + CONTENT_W, c.y + rowH);
    c.advance(rowH);
  }

  // Total row
  c.ensure(totalH);
  doc.setFillColor(SURFACE_ALT);
  doc.rect(MARGIN, c.y, CONTENT_W, totalH, "F");
  doc.setDrawColor(BORDER);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, c.y, MARGIN + CONTENT_W, c.y);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(TEXT_SECONDARY);
  doc.text("Total Package (est.)", MARGIN + 3, c.y + totalH / 2, { baseline: "middle" });
  doc.setTextColor(tl > tr && tl > 0 ? GREEN : NAVY);
  doc.text(fmtGbp(tl), MARGIN + itemColW + 3, c.y + totalH / 2, { baseline: "middle" });
  doc.setTextColor(tr > tl && tr > 0 ? GREEN : NAVY);
  doc.text(fmtGbp(tr), MARGIN + itemColW + valueColW + 3, c.y + totalH / 2, { baseline: "middle" });
  doc.setDrawColor(BORDER);
  doc.setLineWidth(0.2);
  doc.rect(MARGIN, c.y, CONTENT_W, totalH, "S");
  c.advance(totalH + 4);

  // Highlight pill row
  if (tl > 0 || tr > 0) {
    const pillH = 14;
    c.ensure(pillH);
    const gap = 6;
    const pillW = (CONTENT_W - gap) / 2;
    const drawPill = (x: number, label: string, value: number, highlight: boolean) => {
      doc.setFillColor(highlight ? GREEN_LIGHT : SURFACE_ALT);
      doc.setDrawColor(highlight ? "#a7f3d0" : BORDER);
      doc.setLineWidth(0.4);
      doc.roundedRect(x, c.y, pillW, pillH, 2, 2, "FD");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(highlight ? GREEN : TEXT_MUTED);
      doc.text(
        highlight ? "HIGHER TOTAL PACKAGE" : " ",
        x + pillW / 2, c.y + 3,
        { baseline: "middle", align: "center" },
      );
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(TEXT_MUTED);
      doc.text(label, x + pillW / 2, c.y + 7, { baseline: "middle", align: "center" });
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(highlight ? GREEN : NAVY);
      doc.text(value > 0 ? fmtGbp(value) : "—", x + pillW / 2, c.y + 11.5, { baseline: "middle", align: "center" });
    };
    drawPill(MARGIN, left, tl, tl > tr && tl > 0);
    drawPill(MARGIN + pillW + gap, right, tr, tr > tl && tr > 0);
    c.advance(pillH + 4);
  }
}

function drawFooter(doc: jsPDF, branding: BrandingForExport) {
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(BORDER);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, PAGE_H - MARGIN - 6, PAGE_W - MARGIN, PAGE_H - MARGIN - 6);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(TEXT_MUTED);
    const company = branding.companyName?.trim();
    const footer = branding.footer?.trim();
    const left = company ? `Prepared by ${company}` : "Prepared via OfferShield";
    doc.text(left, MARGIN, PAGE_H - MARGIN - 2, { baseline: "bottom" });
    if (footer) {
      doc.text(footer, PAGE_W - MARGIN, PAGE_H - MARGIN - 2, { baseline: "bottom", align: "right" });
    }
    doc.text(`Page ${p} / ${pages}`, PAGE_W / 2, PAGE_H - MARGIN - 2, { baseline: "bottom", align: "center" });
  }
}

export async function exportConsiderationPdf(args: ExportArgs): Promise<void> {
  const {
    caseName, recruiterName, newCompany, currentCompany,
    consideration, recruiterNotes, branding,
  } = args;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const cursor = new Cursor(doc, MARGIN);

  // ── Banner (optional) ──
  if (branding.banner) {
    try {
      const { w: nw, h: nh } = await imageDimensions(branding.banner);
      const aspect = nh / nw;
      const targetW = CONTENT_W;
      const targetH = Math.min(40, targetW * aspect);
      doc.addImage(branding.banner, "JPEG", MARGIN, cursor.y, targetW, targetH, undefined, "FAST");
      cursor.advance(targetH + 6);
    } catch {
      // ignore — proceed without the banner if it can't be decoded
    }
  }

  // ── Title block ──
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(TEXT_MUTED);
  doc.text("CONSIDERATION FOR CHANGE", MARGIN, cursor.y, { baseline: "top" });
  cursor.advance(5);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(NAVY);
  doc.text(caseName || "Candidate", MARGIN, cursor.y, { baseline: "top" });
  cursor.advance(9);

  // Subheading: "Prepared by X · Agency"
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(TEXT_SECONDARY);
  const company = branding.companyName?.trim();
  const subParts: string[] = [];
  if (recruiterName.trim()) subParts.push(`Prepared by ${recruiterName.trim()}`);
  if (company) subParts.push(company);
  if (subParts.length > 0) {
    doc.text(subParts.join("  ·  "), MARGIN, cursor.y, { baseline: "top" });
    cursor.advance(6);
  }
  drawDivider(doc, cursor);

  // ── Roles line ──
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(TEXT_SECONDARY);
  doc.text("Considering:", MARGIN, cursor.y, { baseline: "top" });
  doc.setFont("helvetica", "bold");
  doc.setTextColor(ACCENT);
  doc.text(newCompany || "New company", MARGIN + 24, cursor.y, { baseline: "top" });
  cursor.advance(5.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(TEXT_SECONDARY);
  doc.text("Current:", MARGIN, cursor.y, { baseline: "top" });
  doc.setFont("helvetica", "bold");
  doc.setTextColor(NAVY);
  doc.text(currentCompany || "Current company", MARGIN + 24, cursor.y, { baseline: "top" });
  cursor.advance(8);

  // ── Quote block ──
  if (consideration.candidate_reasons.trim()) {
    drawSectionLabel(doc, "Your reasons for making this move", cursor);
    drawQuoteBlock(doc, consideration.candidate_reasons.trim(), cursor);
  }

  // ── Value chips ──
  if (consideration.values.length > 0) {
    drawSectionLabel(doc, "What matters to you in your work", cursor);
    drawValueChips(doc, consideration.values, cursor);
  }

  // ── Role comparison ──
  if (Object.keys(consideration.comparison).length > 0) {
    drawSectionLabel(doc, "Role comparison", cursor);
    drawRoleComparison(
      doc,
      newCompany || "New company",
      currentCompany || "Current company",
      consideration.comparison,
      cursor,
    );
  }

  // ── Financial ──
  const hasFinancial = FINANCIAL_ROWS.slice(0, FIN_TOTAL_IDX)
    .some((_, i) => {
      const row = consideration.financial[String(i)];
      return row && (row.l || row.r);
    });
  if (hasFinancial) {
    drawSectionLabel(doc, "Financial comparison", cursor);
    drawFinancialTable(
      doc,
      newCompany || "New company",
      currentCompany || "Current company",
      consideration.financial,
      cursor,
    );
  }

  // ── Recruiter notes ──
  if (recruiterNotes.trim()) {
    drawSectionLabel(doc, "Recruiter notes", cursor);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(TEXT_SECONDARY);
    const lines = doc.splitTextToSize(recruiterNotes.trim(), CONTENT_W);
    const h = lines.length * 5;
    cursor.ensure(h);
    doc.text(lines, MARGIN, cursor.y, { baseline: "top" });
    cursor.advance(h + 4);
  }

  // ── Footer (every page) ──
  drawFooter(doc, branding);

  const blob = doc.output("blob");
  saveAs(blob, safeFilename(caseName));
}
