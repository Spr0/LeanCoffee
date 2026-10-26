-- Scale fixes from the 12-person test (wave 1). Backward compatible: no table, column or RPC
-- signature changes, and the client does not depend on this migration.
-- clean_text keeps the zero-width joiner inside an emoji sequence (U+200D between emoji, as in
-- the woman technologist or a rainbow flag) and the zero-width non-joiner between Arabic-script
-- letters (U+200C, which Persian spelling needs). Both are still removed anywhere else, so a name
-- cannot hide an invisible character next to letters. Bidi embeddings, overrides and isolates,
-- the other zero-width characters, control characters and the BOM are removed as before
-- (SCALE-12).
--
-- private.touch() is deliberately unchanged: its board_state update on every write is the only
-- Realtime trace of a deleted action or a removed person (Postgres Changes sends no DELETE event
-- through a board filter), and browsers reload those two tables when they see it.

-- Untrusted text: drop control, bidi and stray zero-width characters, collapse whitespace, trim.
create or replace function private.clean_text(p text) returns text
language sql immutable
set search_path = ''
as $$
  with chars as (
    -- Built with chr() so the source has no invisible characters.
    select
      -- Pictographs and symbols an emoji sequence joins, with the emoji presentation selector
      -- U+FE0F that often ends one: U+00A9, U+00AE, U+203C, U+2049, U+2122, U+2139,
      -- U+2190-21FF arrows, U+2300-23FF technical, U+24C2, U+25A0-27BF shapes, symbols and
      -- dingbats, U+2900-297F and U+2B00-2BFF arrows, U+3030, U+303D, U+3297, U+3299, U+FE0F and
      -- U+1F000-1FAFF (skin tones U+1F3FB-1F3FF are in it).
      '[' || chr(169) || chr(174) || chr(8252) || chr(8265) || chr(8482) || chr(8505)
        || chr(8592) || '-' || chr(8703) || chr(8960) || '-' || chr(9215) || chr(9410)
        || chr(9632) || '-' || chr(10175) || chr(10496) || '-' || chr(10623)
        || chr(11008) || '-' || chr(11263) || chr(12336) || chr(12349) || chr(12951) || chr(12953)
        || chr(65039) || chr(126976) || '-' || chr(129791) || ']' as emoji,
      -- Arabic-script letters: U+0600-06FF, U+0750-077F, U+08A0-08FF, U+FB50-FDFF, U+FE70-FEFF.
      '[' || chr(1536) || '-' || chr(1791) || chr(1872) || '-' || chr(1919)
        || chr(2208) || '-' || chr(2303) || chr(64336) || '-' || chr(65023)
        || chr(65136) || '-' || chr(65279) || ']' as arabic,
      chr(8205) as zwj,
      chr(8204) as zwnj
  )
  select btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(coalesce(p, ''),
          -- Control chars, zero-width space U+200B, marks U+200E-200F, bidi embeddings and
          -- overrides U+202A-202E, isolates U+2066-2069, BOM U+FEFF.
          '[[:cntrl:]' || chr(8203) || chr(8206) || chr(8207) || chr(8234) || '-' || chr(8238)
            || chr(8294) || '-' || chr(8297) || chr(65279) || ']', '', 'g'),
        -- U+200D only with emoji on both sides.
        '(?<!' || c.emoji || ')' || c.zwj || '|' || c.zwj || '(?!' || c.emoji || ')', '', 'g'),
      -- U+200C only with Arabic-script letters on both sides.
      '(?<!' || c.arabic || ')' || c.zwnj || '|' || c.zwnj || '(?!' || c.arabic || ')', '', 'g'),
    '\s+', ' ', 'g'))
  from chars c;
$$;
