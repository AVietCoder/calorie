/**
 * scripts/verify-family-menu-rules.mjs — Offline regression test cho Rule
 * Engine (lib/family-menu/rules.js). Chạy KHÔNG cần Supabase thật: mọi rule
 * được truyền trực tiếp làm fixture (rulesOverride), không gọi loadActiveRules().
 *
 * Chạy:  node scripts/verify-family-menu-rules.mjs
 * Thoát code 0 = pass toàn bộ; 1 = có test fail.
 */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { applyRules, dishAllowedForHousehold } = await import('../lib/family-menu/rules.js');

let passed = 0;
let failed = 0;
const pass = (name) => { passed++; console.log(`  ✓ ${name}`); };
const fail = (name, msg) => { failed++; console.error(`  ✗ ${name} — ${msg}`); };
const assert = (name, cond, msg) => (cond ? pass(name) : fail(name, msg || 'assertion failed'));

const RULES = [
  { id: 'r1', condition_type: 'allergy', condition_value: 'tôm', action_type: 'exclude', action_value: { tag: 'tôm' }, priority: 10, active: true },
  { id: 'r2', condition_type: 'allergy', condition_value: 'đậu phộng', action_type: 'exclude', action_value: { tag: 'đậu phộng' }, priority: 10, active: true },
  { id: 'r3', condition_type: 'disease', condition_value: 'tiểu đường', action_type: 'exclude', action_value: { tag: 'high-sugar' }, priority: 5, active: true },
  { id: 'r4', condition_type: 'disease', condition_value: 'gout', action_type: 'exclude', action_value: { tag: 'high-purine' }, priority: 5, active: true },
];

console.log('\n[1] Allergy exclusion');
{
  const person = { allergies: ['Tôm'], disease: '' };
  const dish = { name: 'Bún tôm', tags: ['tôm', 'hải sản'] };
  const result = await applyRules(person, dish, RULES);
  assert('dị ứng tôm loại món có nhãn tôm', result.allowed === false, JSON.stringify(result));
  assert('matches chứa rule r1', result.matches.some((m) => m.rule.id === 'r1'));
}

console.log('\n[2] Allergy — no false positive on unrelated dish');
{
  const person = { allergies: ['Tôm'], disease: '' };
  const dish = { name: 'Phở bò', tags: ['bò', 'nước dùng'] };
  const result = await applyRules(person, dish, RULES);
  assert('món không liên quan không bị loại', result.allowed === true, JSON.stringify(result));
}

console.log('\n[3] Disease exclusion (diabetes → high-sugar)');
{
  const person = { allergies: [], disease: 'Tiểu đường type 2' };
  const dish = { name: 'Chè đậu xanh', tags: ['high-sugar', 'tráng miệng'] };
  const result = await applyRules(person, dish, RULES);
  assert('tiểu đường loại món high-sugar', result.allowed === false, JSON.stringify(result));
  assert('matches chứa rule r3', result.matches.some((m) => m.rule.id === 'r3'));
}

console.log('\n[4] No allergy/disease → nothing fires');
{
  const person = { allergies: [], disease: '', dislikes: [] };
  const dish = { name: 'Bất kỳ món gì', tags: ['tôm', 'high-sugar', 'high-purine'] };
  const result = await applyRules(person, dish, RULES);
  assert('người dùng không có dị ứng/bệnh lý -> không rule nào chặn', result.allowed === true, JSON.stringify(result));
}

console.log('\n[5] Household-level: one member with a conflict blocks the shared dish');
{
  const members = [
    { id: 'm1', allergies: [], disease: '' },
    { id: 'm2', allergies: ['đậu phộng'], disease: '' },
  ];
  const dish = { name: 'Gỏi cuốn sốt đậu phộng', tags: ['đậu phộng'] };
  const result = await dishAllowedForHousehold(members, dish, RULES);
  assert('household bị chặn vì 1 thành viên dị ứng đậu phộng', result.allowed === false, JSON.stringify(result));
  assert('blockedMember đúng là m2', result.blockedMember?.id === 'm2');
}

console.log(`\n${passed} passed, ${failed} failed.\n`);
process.exit(failed > 0 ? 1 : 0);
