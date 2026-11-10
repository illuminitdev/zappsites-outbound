-- AEO/GEO mentions audit settings per campaign.
alter table campaigns
  add column if not exists aeo_category text not null default '',
  add column if not exists aeo_prompts jsonb not null default
    '["Who are the best {category} in {city}?","Which {category} in {city} would you recommend? I want someone reliable.","I''m comparing {category} near {city}. Which firms should I shortlist and why?"]'::jsonb;

-- Quick filter: how often AI engines mention the lead (0-100), copied from audit->aeo.
alter table leads add column if not exists aeo_mention_rate int;
