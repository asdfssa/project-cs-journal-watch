// loginLimiter นับเฉพาะล็อกอินที่พลาด — `node --test tests/login-limiter.test.js`
Object.assign(process.env, { DB_HOST: 'x', DB_USER: 'x', DB_NAME: 'x', JWT_SECRET: 'x'.repeat(48), NODE_ENV: 'production' });
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { loginLimiter } = require('../src/middlewares/rateLimit');

test('ล็อกอินสำเร็จกี่ครั้งก็ไม่ติด · พลาดครบ 5 ครั้งแล้วครั้งที่ 6 ได้ 429 RATE_LIMIT', async () => {
  const app = express();
  app.post('/login', loginLimiter, (req, res) => res.status(req.query.ok ? 200 : 401).json({}));
  const server = app.listen(0);
  const post = (ok) => fetch(`http://127.0.0.1:${server.address().port}/login${ok ? '?ok=1' : ''}`, { method: 'POST' });
  try {
    for (let i = 0; i < 8; i++) assert.equal((await post(true)).status, 200, `สำเร็จครั้งที่ ${i + 1}`);
    for (let i = 0; i < 5; i++) assert.equal((await post(false)).status, 401, `พลาดครั้งที่ ${i + 1}`);
    const blocked = await post(false);
    assert.equal(blocked.status, 429);
    assert.equal((await blocked.json()).code, 'RATE_LIMIT');
  } finally { server.close(); }
});
