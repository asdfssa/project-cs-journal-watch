// B51: DECIMAL ต้องกลับมาเป็น number — `node --test tests/b51-decimal-numbers.test.js`
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const src = (p) => path.join(__dirname, '..', 'src', p);
let poolOptions;
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports }; };
stub(require.resolve('mysql2/promise'), {
  createPool: (o) => { poolOptions = o; return { getConnection: async () => ({ release() {} }) }; },
});
stub(src('config/index.js'), { db: { host: 'h', port: 3306, user: 'u', password: 'p', database: 'd', connectionLimit: 1 } });
require(src('config/database.js'));

test('pool เปิด decimalNumbers (DECIMAL → number)', () => {
  assert.equal(poolOptions.decimalNumbers, true);
});

test('ค่าเดิมของ pool ไม่หาย (DATE ยังเป็นสตริง, DATETIME ไม่โดน)', () => {
  assert.deepEqual(poolOptions.dateStrings, ['DATE']);
});

// ยืนยันว่า mysql2 ที่ติดตั้งอ่าน option นี้จริง (ชื่อ option ไม่พิมพ์ผิด) — ตรวจจากซอร์สของไลบรารี
test('mysql2 ที่ติดตั้งรองรับ option decimalNumbers', () => {
  const lib = path.join(path.dirname(require.resolve('mysql2/package.json')), 'lib', 'parsers', 'text_parser.js');
  assert.match(require('node:fs').readFileSync(lib, 'utf8'), /config\.decimalNumbers/);
});
