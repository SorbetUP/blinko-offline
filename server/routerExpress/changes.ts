import express from 'express';
import { prisma } from '../prisma';
import { getTokenFromRequest } from '../lib/helper';

const router = express.Router();

router.use(express.json({ limit: '50mb' }));

const requireAuth = async (req: any, res: any, next: any) => {
  try {
    const token = await getTokenFromRequest(req);
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = token;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
};

const normalizePayload = (value: any) => {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return '{}';
  }
};

const toSyncOpResponse = (row: any) => ({
  id: row.id,
  entity_type: row.entityType,
  entity_id: row.entityId,
  op: row.op,
  payload_json: row.payloadJson,
  ts: row.ts instanceof Date ? row.ts.toISOString() : row.ts,
  device_id: row.deviceId,
});

router.get('/', requireAuth, async (req: any, res) => {
  const sinceRaw = req.query?.since as string | undefined;
  const since = sinceRaw ? Number(sinceRaw) : undefined;
  if (sinceRaw && Number.isNaN(since)) {
    return res.status(400).json({ error: 'Invalid cursor' });
  }

  const accountId = Number(req.user.id);
  const rows = await prisma.syncChanges.findMany({
    where: {
      accountId,
      ...(since ? { id: { gt: since } } : {})
    },
    orderBy: { id: 'asc' },
    take: 500
  });

  const cursor = rows.length ? String(rows[rows.length - 1].id) : (sinceRaw ?? null);

  return res.json({
    cursor,
    ops: rows.map(toSyncOpResponse)
  });
});

router.post('/', requireAuth, async (req: any, res) => {
  const ops = req.body?.ops;
  if (!Array.isArray(ops)) {
    return res.status(400).json({ error: 'ops must be an array' });
  }

  const accountId = Number(req.user.id);

  const data = ops.map((op: any) => {
    const entityType = op.entity_type ?? op.entityType ?? '';
    const entityId = op.entity_id ?? op.entityId ?? '';
    const deviceId = op.device_id ?? op.deviceId ?? '';
    const payloadJson = normalizePayload(op.payload_json ?? op.payloadJson ?? op.payload);
    const ts = op.ts ? new Date(op.ts) : new Date();
    const opValue = op.op ?? '';

    return {
      accountId,
      entityType,
      entityId,
      op: opValue,
      payloadJson,
      ts: Number.isNaN(ts.getTime()) ? new Date() : ts,
      deviceId,
    };
  });

  if (!data.length) {
    return res.json({ ok: true, count: 0 });
  }

  await prisma.syncChanges.createMany({ data });

  return res.json({ ok: true, count: data.length });
});

export default router;
