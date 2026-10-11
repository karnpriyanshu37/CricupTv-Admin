insert into public.sports (name, slug, sort_order) values
  ('Cricket','cricket',1),('Football','football',2),('F1','f1',3),('Tennis','tennis',4),
  ('UFC','ufc',5),('WWE','wwe',6),('Basketball','basketball',7),('Other Sports','other',8)
on conflict (slug) do nothing;
