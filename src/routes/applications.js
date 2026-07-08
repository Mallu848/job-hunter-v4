import { Router } from 'express';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { applications, jobs, applicationEvents } from '../db/schema.js';
import { getUserId } from '../lib/seed.js';

const router = Router();

const STATUSES = ['saved', 'applied', 'interview', 'rejected', 'offer'];

function toJson(row, job) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.userId,
    job_id: row.jobId,
    resume_id: row.resumeId,
    status: row.status,
    applied_at: row.appliedAt,
    next_action: row.nextAction,
    next_action_date: row.nextActionDate,
    notes: row.notes,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    job: job ? { title: job.title, company: job.company, url: job.url } : null,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const userId = await getUserId();
    const rows = await db
      .select({ app: applications, job: jobs })
      .from(applications)
      .leftJoin(jobs, eq(applications.jobId, jobs.id))
      .where(eq(applications.userId, userId))
      .orderBy(desc(applications.createdAt));

    res.json(rows.map((r) => toJson(r.app, r.job)));
  } catch (err) {
    next(err);
  }
});

const postSchema = z
  .object({
    job_id: z.number().int(),
    status: z.enum(STATUSES).optional(),
  })
  .strict();

router.post('/', async (req, res, next) => {
  try {
    const parsed = postSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid input', details: parsed.error.issues });
    }

    const userId = await getUserId();
    const { job_id, status } = parsed.data;

    const [job] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, job_id), eq(jobs.userId, userId)))
      .limit(1);

    if (!job) {
      return res.status(400).json({ error: 'job_id does not exist' });
    }

    const initialStatus = status ?? 'saved';
    const appliedAt = initialStatus === 'applied' ? new Date() : null;

    const [row] = await db
      .insert(applications)
      .values({
        userId,
        jobId: job_id,
        status: initialStatus,
        appliedAt,
      })
      .returning();

    await db.insert(applicationEvents).values({
      applicationId: row.id,
      fromStatus: null,
      toStatus: initialStatus,
    });

    res.status(201).json(toJson(row, job));
  } catch (err) {
    next(err);
  }
});

const patchSchema = z
  .object({
    status: z.enum(STATUSES).optional(),
    resume_id: z.number().int().nullable().optional(),
    applied_at: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    next_action: z.string().nullable().optional(),
    next_action_date: z.string().nullable().optional(),
  })
  .strict();

router.patch('/:id', async (req, res, next) => {
  try {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid input', details: parsed.error.issues });
    }

    const userId = await getUserId();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const [current] = await db
      .select()
      .from(applications)
      .where(and(eq(applications.id, id), eq(applications.userId, userId)))
      .limit(1);

    if (!current) return res.status(404).json({ error: 'Not found' });

    const d = parsed.data;
    const updates = { updatedAt: new Date() };
    if (d.resume_id !== undefined) updates.resumeId = d.resume_id;
    if (d.applied_at !== undefined) updates.appliedAt = d.applied_at ? new Date(d.applied_at) : null;
    if (d.notes !== undefined) updates.notes = d.notes;
    if (d.next_action !== undefined) updates.nextAction = d.next_action;
    if (d.next_action_date !== undefined) updates.nextActionDate = d.next_action_date;

    let statusChanged = false;
    if (d.status !== undefined && d.status !== current.status) {
      statusChanged = true;
      updates.status = d.status;
      if (d.status === 'applied' && !current.appliedAt && updates.appliedAt === undefined) {
        updates.appliedAt = new Date();
      }
    }

    const [row] = await db
      .update(applications)
      .set(updates)
      .where(and(eq(applications.id, id), eq(applications.userId, userId)))
      .returning();

    if (statusChanged) {
      await db.insert(applicationEvents).values({
        applicationId: id,
        fromStatus: current.status,
        toStatus: d.status,
      });
    }

    const [job] = await db.select().from(jobs).where(eq(jobs.id, row.jobId)).limit(1);
    res.json(toJson(row, job));
  } catch (err) {
    next(err);
  }
});

router.get('/:id/events', async (req, res, next) => {
  try {
    const userId = await getUserId();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const [app] = await db
      .select()
      .from(applications)
      .where(and(eq(applications.id, id), eq(applications.userId, userId)))
      .limit(1);

    if (!app) return res.status(404).json({ error: 'Not found' });

    const rows = await db
      .select()
      .from(applicationEvents)
      .where(eq(applicationEvents.applicationId, id))
      .orderBy(desc(applicationEvents.occurredAt));

    res.json(
      rows.map((r) => ({
        id: r.id,
        application_id: r.applicationId,
        from_status: r.fromStatus,
        to_status: r.toStatus,
        occurred_at: r.occurredAt,
        note: r.note,
      })),
    );
  } catch (err) {
    next(err);
  }
});

export default router;
