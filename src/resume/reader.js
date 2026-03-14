import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { logger } from '../utils/logger.js';

// Dynamically import docx since it's ESM
async function getDocx() {
  return import('docx');
}

export async function readResume(inputPath) {
  const absPath = resolve(inputPath);
  let buffer;
  try {
    buffer = readFileSync(absPath);
  } catch (err) {
    throw new Error(`Could not read resume at ${absPath}: ${err.message}`);
  }

  const { Document } = await getDocx();

  // docx package reads .docx files — we extract text paragraph by paragraph
  // We use the lower-level approach: read the XML directly via JSZip (bundled in docx)
  // since docx@9 changed its API for reading existing documents
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buffer);

  const wordDoc = zip.file('word/document.xml');
  if (!wordDoc) throw new Error('Invalid .docx file: missing word/document.xml');

  const xml = await wordDoc.async('string');

  // Extract text from <w:t> elements — the raw text nodes in a .docx
  const textMatches = xml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? [];
  const lines = textMatches.map(m => m.replace(/<[^>]+>/g, '').trim()).filter(Boolean);

  // Group into paragraphs by splitting on paragraph markers in the XML
  // We do a simple join here — the tailor prompt does not need perfect structure
  const fullText = lines.join('\n');

  logger.info(`[resume] Read ${lines.length} text segments from resume`);
  return fullText;
}
