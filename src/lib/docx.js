// Thin wrapper around mammoth for pulling plain text out of an uploaded .docx.
// Kept separate from master-core.js so the AI parser stays dependency-free and
// unit-testable without mammoth.

import mammoth from 'mammoth';

/**
 * Extract raw text from a .docx file buffer.
 * @param {Buffer} buffer
 * @returns {Promise<string>}
 */
export async function extractDocxText(buffer) {
  const { value } = await mammoth.extractRawText({ buffer });
  return (value || '').trim();
}
