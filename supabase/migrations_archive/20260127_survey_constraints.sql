-- Add unique index to survey name per user (Per-user uniqueness, case-insensitive)
CREATE UNIQUE INDEX survey_packages_name_created_by_idx 
ON public.survey_packages (created_by, lower(name));
