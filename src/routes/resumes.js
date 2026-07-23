import { Router } from 'express';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { resumes, jobs, applications, aiUsage } from '../db/schema.js';
import { getUserId } from '../lib/seed.js';
import { renderResume } from '../lib/resume-render.js';
import {
  masterSchema,
  friendlyZodError,
  parseResumeRaw,
  lenientMaster,
  masterIssues,
  PARSE_MODEL,
} from '../lib/master-core.js';
import { extractDocxText } from '../lib/docx.js';
import { costUsd } from '../lib/pricing.js';

const router = Router();

// Save (or create) the structured master resume. Validated against masterSchema
// so we never persist a master that would make tailoring throw. Rendering is
// recomputed on the fly (renderedHtml cleared), so a print view always matches.
router.put('/master', async (req, res, next) => {
  try {
    const userId = await getUserId();
    let content;
    try {
      content = masterSchema.parse(req.body?.content);
    } catch (err) {
      if (err?.issues) return res.status(400).json({ error: friendlyZodError(err) });
      throw err;
    }

    const [existing] = await db
      .select({ id: resumes.id })
      .from(resumes)
      .where(and(eq(resumes.userId, userId), eq(resumes.kind, 'master')))
      .limit(1);

    let row;
    if (existing) {
      [row] = await db
        .update(resumes)
        .set({ content, renderedHtml: null })
        .where(eq(resumes.id, existing.id))
        .returning();
    } else {
      [row] = await db
        .insert(resumes)
        .values({ userId, kind: 'master', content })
        .returning();
    }
    res.json({ id: row.id, kind: 'master', saved: true });
  } catch (err) {
    next(err);
  }
});

// Import a .docx and AI-parse it into a structured master. Does NOT save — the
// parsed content is returned for the human to review and edit before PUT.
router.post('/master/import', async (req, res, next) => {
  try {
    const userId = await getUserId();
    const { filename, data_base64: dataBase64 } = req.body || {};

    if (!dataBase64 || typeof dataBase64 !== 'string') {
      return res.status(400).json({ error: 'No file data was received.' });
    }
    if (filename && !/\.docx$/i.test(filename)) {
      return res.status(400).json({ error: 'Please upload a .docx file.' });
    }

    let buffer;
    try {
      buffer = Buffer.from(dataBase64, 'base64');
    } catch {
      return res.status(400).json({ error: 'Could not decode the uploaded file.' });
    }
    if (!buffer.length) return res.status(400).json({ error: 'The uploaded file was empty.' });
    // A .docx is a ZIP — it must start with "PK".
    if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
      return res.status(400).json({ error: "That doesn't look like a .docx file." });
    }

    let text;
    try {
      text = await extractDocxText(buffer);
    } catch (err) {
      console.error('[master/import] docx extract failed:', err?.message || err);
      return res.status(422).json({ error: 'Could not read text from that .docx.' });
    }
    if (!text || text.length < 40) {
      return res.status(422).json({
        error:
          'That .docx had almost no readable text — it may store content in text boxes or images. Try “Edit master resume” to enter it by hand.',
      });
    }

    let raw;
    let usage;
    try {
      ({ raw, usage } = await parseResumeRaw(text));
    } catch (err) {
      const message = err?.message || String(err);
      console.error('[master/import] AI parse failed:', message);
      // An "anthropic <status>:" message is an API/service error; anything else
      // (no JSON, truncation) means the model didn't return usable JSON.
      if (/^anthropic \d+/i.test(message)) {
        return res
          .status(502)
          .json({ error: 'The AI service returned an error — wait a moment and try again.' });
      }
      return res.status(422).json({
        error:
          "The AI couldn't produce a complete resume from that file (yours may be very long). Try again, or use “Edit master resume”.",
      });
    }

    // Meter the parse call; failure to log must never fail the import.
    try {
      await db.insert(aiUsage).values({
        userId,
        purpose: 'resume_import',
        model: PARSE_MODEL,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsd: String(costUsd(PARSE_MODEL, usage.inputTokens, usage.outputTokens)),
      });
    } catch {
      /* usage metering is best-effort */
    }

    // Coerce leniently and report what (if anything) still blocks a save. The
    // frontend auto-saves when valid, or opens the editor pre-filled when not,
    // so a strict-schema miss never throws the parsed resume away.
    const content = lenientMaster(raw);
    const issues = masterIssues(content);
    if (issues.length) {
      console.warn('[master/import] parsed with issues:', issues.join('; '));
    }
    res.json({ content, valid: issues.length === 0, issues, text_chars: text.length });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const userId = await getUserId();
    const rows = await db
      .select({ resume: resumes, job: jobs })
      .from(resumes)
      .leftJoin(jobs, eq(resumes.jobId, jobs.id))
      .where(eq(resumes.userId, userId))
      .orderBy(desc(resumes.createdAt));
    res.json(
      rows.map(({ resume, job }) => ({
        id: resume.id,
        kind: resume.kind,
        job_id: resume.jobId,
        parent_id: resume.parentId,
        created_at: resume.createdAt,
        job: job ? { title: job.title, company: job.company } : null,
      })),
    );
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const userId = await getUserId();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

    const [row] = await db
      .select()
      .from(resumes)
      .where(and(eq(resumes.id, id), eq(resumes.userId, userId)))
      .limit(1);
    if (!row) return res.status(404).json({ error: 'Not found' });

    // Master rows have no stored renderedHtml — render on the fly so the
    // frontend print view works for the master too. Only possible when the
    // content is the structured form (raw_text-only masters stay null).
    let renderedHtml = row.renderedHtml;
    if (!renderedHtml && row.kind === 'master' && Array.isArray(row.content?.experience)) {
      renderedHtml = renderResume(row.content, null);
    }

    res.json({
      id: row.id,
      kind: row.kind,
      job_id: row.jobId,
      parent_id: row.parentId,
      created_at: row.createdAt,
      content: row.content,
      rendered_html: renderedHtml,
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const userId = await getUserId();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

    const [row] = await db
      .select()
      .from(resumes)
      .where(and(eq(resumes.id, id), eq(resumes.userId, userId)))
      .limit(1);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (row.kind !== 'tailored') {
      return res.status(400).json({ error: 'Only tailored resumes can be deleted' });
    }

    const [linked] = await db
      .select({ id: applications.id })
      .from(applications)
      .where(and(eq(applications.resumeId, id), eq(applications.userId, userId)))
      .limit(1);
    if (linked) {
      return res.status(409).json({
        error: `Application #${linked.id} is linked to this resume — unlink it first`,
      });
    }

    await db.delete(resumes).where(and(eq(resumes.id, id), eq(resumes.userId, userId)));
    res.json({ deleted: true, id });
  } catch (err) {
    next(err);
  }
});

export default router;
