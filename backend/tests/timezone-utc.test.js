// pool ต้องใช้ UTC ทั้งฝั่ง mysql2 และ session ของ MySQL — `node --test tests/timezone-utc.test.js`
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const captured = { opts: null, handler: null, sessionSql: [] };
const mysqlPath = require.resolve('mysql2/promise');
require.cache[mysqlPath] = {
  id: mysqlPath, filename: mysqlPath, loaded: true,
  exports: {
    createPool: (opts) => {
      captured.opts = opts;
      return {
        pool: { on: (ev, fn) => { if (ev === 'connection') captured.handler = fn; } },
        getConnection: () => Promise.resolve({ release() {} }),
      };
    },
  },
};
process.env.DB_HOST = process.env.DB_HOST || 'x';
require(path.join(__dirname, '..', 'src', 'config', 'database.js'));

test('createPool ตั้ง timezone เป็น Z (UTC)', () => {
  assert.equal(captured.opts.timezone, 'Z');
});

test('ทุก connection ใหม่สั่ง SET time_zone = +00:00', () => {
  assert.equal(typeof captured.handler, 'function');
  captured.handler({ query: (sql) => captured.sessionSql.push(sql) });
  assert.deepEqual(captured.sessionSql, ["SET time_zone = '+00:00'"]);
});
