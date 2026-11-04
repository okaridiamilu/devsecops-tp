const request = require('supertest');
const app = require('../src/app');

test('should return ok when calling /health', async () => {
  const res = await request(app).get('/health');
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('ok');
});

test('should greet the user when name is given', async () => {
  const res = await request(app).get('/hello?name=Lina');
  expect(res.text).toContain('Lina');
});
