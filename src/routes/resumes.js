import { Router } from 'express';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { resumes, jobs, applications } from '../db/schema.js';
import { getUserId } from '../lib/seed.js';
import { renderResume } from '../lib/resume-render.js';

const router = Router();

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
