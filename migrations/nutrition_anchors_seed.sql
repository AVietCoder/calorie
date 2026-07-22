-- =============================================================================
-- nutrition_anchors_seed — A+B: đưa bảng tham chiếu VN (đang hardcode trong
-- lib/nutrition.js REFERENCE_PER100/REFERENCE_UNITS) vào DB dưới dạng anchor
-- ĐÃ VERIFY (source='vn_ref', verified=true, confidence='high').
--
-- Ý nghĩa: các mốc này hiển thị trong trang admin (bundle F), có thể mở rộng
-- KHÔNG cần deploy, và làm ấm cache (getAnchor hit ngay). Code vẫn giữ bảng
-- REFERENCE_* làm fallback offline (khi DB/mạng miss) nên không phá gì.
--
-- Chạy SAU nutrition_provenance.sql. Idempotent (on conflict do update).
-- Key khớp cacheKey engine sinh: "<kind>:<normKey(base)>" hoặc "unit:<đơn vị>:<base>".
-- =============================================================================

insert into public.nutrition_anchors (key, kind, per_unit, source, confidence, verified) values
  -- ── per 100ml / 100g ──
  ('volume:sua tuoi',   'volume', '{"calories":60,"protein":3.2,"fat":3.3,"carbs":4.8,"fiber":0,"sugar":4.8,"sodium":44}',      'vn_ref', 'high', true),
  ('volume:sua socola', 'volume', '{"calories":80,"protein":3.2,"fat":2.6,"carbs":10.5,"fiber":0,"sugar":10,"sodium":55}',      'vn_ref', 'high', true),
  ('mass:com trang',    'mass',   '{"calories":130,"protein":2.7,"fat":0.3,"carbs":28.2,"fiber":0.4,"sugar":0.1,"sodium":1}',    'vn_ref', 'high', true),
  -- ── per 1 đơn vị đếm (miếng/quả/tô/phần/lát...) ──
  ('unit:mieng:sushi',  'unit',   '{"calories":50,"protein":2.2,"fat":0.8,"carbs":8.5,"fiber":0.3,"sugar":1,"sodium":120}',      'vn_ref', 'high', true),
  ('unit:cai:sushi',    'unit',   '{"calories":50,"protein":2.2,"fat":0.8,"carbs":8.5,"fiber":0.3,"sugar":1,"sodium":120}',      'vn_ref', 'high', true),
  ('unit:qua:chuoi',    'unit',   '{"calories":105,"protein":1.3,"fat":0.4,"carbs":27,"fiber":3.1,"sugar":14.4,"sodium":1}',     'vn_ref', 'high', true),
  ('unit:trai:chuoi',   'unit',   '{"calories":105,"protein":1.3,"fat":0.4,"carbs":27,"fiber":3.1,"sugar":14.4,"sodium":1}',     'vn_ref', 'high', true),
  ('unit:to:pho',       'unit',   '{"calories":480,"protein":28,"fat":12,"carbs":62,"fiber":3,"sugar":5,"sodium":950}',          'vn_ref', 'high', true),
  ('unit:bat:pho',      'unit',   '{"calories":480,"protein":28,"fat":12,"carbs":62,"fiber":3,"sugar":5,"sodium":950}',          'vn_ref', 'high', true),
  ('unit:phan:pho',     'unit',   '{"calories":480,"protein":28,"fat":12,"carbs":62,"fiber":3,"sugar":5,"sodium":950}',          'vn_ref', 'high', true),
  ('unit:phan:com tam', 'unit',   '{"calories":650,"protein":32,"fat":22,"carbs":78,"fiber":4,"sugar":7,"sodium":1100}',         'vn_ref', 'high', true),
  ('unit:dia:com tam',  'unit',   '{"calories":650,"protein":32,"fat":22,"carbs":78,"fiber":4,"sugar":7,"sodium":1100}',         'vn_ref', 'high', true),
  ('unit:mieng:banh',   'unit',   '{"calories":300,"protein":4,"fat":14,"carbs":40,"fiber":1.2,"sugar":24,"sodium":220}',        'vn_ref', 'high', true),
  ('unit:lat:banh',     'unit',   '{"calories":300,"protein":4,"fat":14,"carbs":40,"fiber":1.2,"sugar":24,"sodium":220}',        'vn_ref', 'high', true)
on conflict (key) do update
  set per_unit   = excluded.per_unit,
      source     = excluded.source,
      confidence = excluded.confidence,
      verified   = excluded.verified,
      updated_at = now();
