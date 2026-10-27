import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('GET /api/health', () => {
  it('reports that the api is up', async () => {
    const res = await request(createApp()).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', service: 'northstar-api' });
  });

  it('answers unknown api routes with a JSON 404', async () => {
    const res = await request(createApp()).get('/api/nowhere');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });
});
