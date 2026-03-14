import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../utils/logger.js';

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function detectLineType(line) {
  const trimmed = line.trim();
  if (!trimmed) return 'blank';
  // ALL CAPS lines with no punctuation are likely section headers
  if (/^[A-Z\s&\/]{3,}$/.test(trimmed)) return 'heading';
  // Bullet points
  if (/^[-•·*]\s/.test(trimmed)) return 'bullet';
  return 'normal';
}

export async function writeResume(tailoredText, job, outputDir) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = await import('docx');

  const lines = tailoredText.split('\n');
  const children = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const type = detectLineType(line);

    if (type === 'blank') {
      children.push(new Paragraph({ text: '' }));
      continue;
    }

    if (type === 'heading') {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: trimmed, bold: true })],
        spacing: { before: 240, after: 120 },
      }));
      continue;
    }

    if (type === 'bullet') {
      const bulletText = trimmed.replace(/^[-•·*]\s*/, '');
      children.push(new Paragraph({
        bullet: { level: 0 },
        children: [new TextRun(bulletText)],
      }));
      continue;
    }

    // Normal paragraph
    children.push(new Paragraph({
      children: [new TextRun(trimmed)],
      spacing: { after: 60 },
    }));
  }

  const doc = new Document({
    sections: [{
      properties: {},
      children,
    }],
  });

  const date = new Date().toISOString().slice(0, 10);
  const filename = `${slugify(job.company)}-${slugify(job.title)}-${date}.docx`;
  const filePath = join(outputDir, 'resumes', filename);

  const buffer = await Packer.toBuffer(doc);
  writeFileSync(filePath, buffer);

  logger.info(`[writer] Saved tailored resume: ${filePath}`);
  return filePath;
}
