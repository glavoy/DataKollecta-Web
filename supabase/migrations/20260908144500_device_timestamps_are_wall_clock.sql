-- `collected_at` and `changed_at` arrive from the device as bare local
-- wall-clock strings with no offset: `auto_fields.dart` builds them from a
-- local `DateTime`, and Dart's `toIso8601String()` emits no suffix for one.
-- A `timestamptz` column read those as UTC, which is why every record looked
-- collected three hours after it was submitted in a UTC+3 deployment:
--
--   collected_at 2026-09-08T13:49:08+00:00   (the device's wall clock)
--   submitted_at 2026-09-08T10:50:40+00:00   (now(), genuinely UTC)
--
-- The column now says what the value actually is. `submitted_at`,
-- `updated_at` and `formchanges.synced_at` are deliberately untouched --
-- all three are server-set and already correct, and keeping them
-- `timestamptz` is what makes the two conventions tellable apart: an
-- offset present means a server instant, an offset absent means a device
-- wall clock with no known offset.
--
-- `AT TIME ZONE 'UTC'` recovers the original device reading exactly. The
-- bug stored a naive local string as though it were UTC, so the stored
-- instant's UTC rendering *is* the wall clock the app sent. No recorded
-- value changes here; only the false offset goes away. That also means
-- every dependent keeps working unchanged: `get_submission_counts` reads
-- the same dates out of `DATE(collected_at)`, and every `ORDER BY` on
-- these columns sees the same digits in the same order.
--
-- Recovering the true *instant* of collection is a separate problem and
-- not solvable here: it needs the device to report its offset. See the
-- offline-first note in DESIGN.md.

ALTER TABLE public.submissions
  ALTER COLUMN collected_at TYPE timestamp without time zone
  USING collected_at AT TIME ZONE 'UTC';

ALTER TABLE public.formchanges
  ALTER COLUMN changed_at TYPE timestamp without time zone
  USING changed_at AT TIME ZONE 'UTC';

COMMENT ON COLUMN public.submissions.collected_at IS
  'Device wall clock when the interview was saved (the app''s stoptime). No offset: the device does not report one, so this is not comparable with submitted_at.';

COMMENT ON COLUMN public.formchanges.changed_at IS
  'Device wall clock when the field was edited. No offset: the device does not report one, so this is not comparable with synced_at.';
