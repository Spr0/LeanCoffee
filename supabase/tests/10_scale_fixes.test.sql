-- Scale fixes (wave 1): clean_text keeps emoji sequences and Persian spelling but still strips
-- invisible and bidi characters elsewhere (SCALE-12).
begin;
select plan(16);

-- Characters are built with chr() so this file has no invisible ones.

-- Emoji joined by U+200D survive whole.
select is(private.clean_text(chr(128105) || chr(8205) || chr(128187)),
  chr(128105) || chr(8205) || chr(128187), 'woman technologist keeps its joiner');
select is(private.clean_text(chr(128581) || chr(8205) || chr(9792) || chr(65039)),
  chr(128581) || chr(8205) || chr(9792) || chr(65039), 'a gendered gesture keeps its joiner');
select is(private.clean_text(chr(127987) || chr(65039) || chr(8205) || chr(127752)),
  chr(127987) || chr(65039) || chr(8205) || chr(127752), 'rainbow flag: the joiner after U+FE0F stays');
select is(private.clean_text(chr(128104) || chr(8205) || chr(128105) || chr(8205) || chr(128103)
                             || chr(8205) || chr(128102)),
  chr(128104) || chr(8205) || chr(128105) || chr(8205) || chr(128103) || chr(8205) || chr(128102),
  'a family of four keeps all three joiners');
select is(private.clean_text(chr(129489) || chr(127997) || chr(8205) || chr(9877) || chr(65039)),
  chr(129489) || chr(127997) || chr(8205) || chr(9877) || chr(65039),
  'a skin tone before the joiner keeps it');
select is(private.clean_text(chr(128008) || chr(8205) || chr(11035)), chr(128008) || chr(8205) || chr(11035),
  'black cat: a joiner before a square keeps it');
select is(private.clean_text('Ship it ' || chr(128105) || chr(8205) || chr(128187) || ' today'),
  'Ship it ' || chr(128105) || chr(8205) || chr(128187) || ' today', 'emoji inside a topic');

-- Anywhere else U+200D is removed, so a name cannot hide it between letters.
select is(private.clean_text('Fr' || chr(8205) || 'an'), 'Fran', 'a joiner between letters is removed');
select is(private.clean_text(chr(128105) || chr(8205) || 'x'), chr(128105) || 'x',
  'a joiner between an emoji and a letter is removed');
select is(private.clean_text(chr(8205) || chr(128187)), chr(128187), 'a leading joiner is removed');
select is(private.clean_text(chr(128105) || chr(8205) || chr(8205) || chr(128187)),
  chr(128105) || chr(128187), 'a run of joiners is removed');

-- U+200C stays between Arabic-script letters only (Persian: mi-khaham).
select is(private.clean_text(chr(1605) || chr(1740) || chr(8204) || chr(1582) || chr(1608) || chr(1575) || chr(1607) || chr(1605)),
  chr(1605) || chr(1740) || chr(8204) || chr(1582) || chr(1608) || chr(1575) || chr(1607) || chr(1605),
  'a non-joiner inside a Persian word stays');
select is(private.clean_text('Pa' || chr(8204) || 't'), 'Pat', 'a non-joiner between Latin letters is removed');

-- The rest is unchanged: bidi overrides and isolates, zero-width space and marks, BOM.
select is(private.clean_text('Ann' || chr(8238) || 'ie' || chr(8294) || ' ' || chr(8203) || 'Lee'
                             || chr(8206) || chr(8207) || chr(65279)),
  'Annie Lee', 'bidi overrides, isolates, zero-width spaces, marks and BOM are still removed');
select is(private.clean_text(chr(128105) || chr(8238) || chr(8205) || chr(128187)),
  chr(128105) || chr(8205) || chr(128187), 'an override hidden inside an emoji sequence is removed');

-- A joined emoji in a name and a topic, saved through the RPCs.
select tests.login(tests.u(1));
select set_config('t.created', public.create_board('Fran ' || chr(128105) || chr(8205) || chr(128187))::text, true);
select set_config('t.board', current_setting('t.created')::jsonb ->> 'board_id', true);
select public.start_phase(current_setting('t.board')::uuid, 'brainstorm');
select set_config('t.topic', public.add_topic(current_setting('t.board')::uuid,
  'Pride month ' || chr(127987) || chr(65039) || chr(8205) || chr(127752))::text, true);
select is((select text from public.topics where id = current_setting('t.topic')::uuid),
  'Pride month ' || chr(127987) || chr(65039) || chr(8205) || chr(127752), 'a topic keeps its flag');

select * from finish();
rollback;
