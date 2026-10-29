# fonefans

## Image uploads

The admin form accepts image files for driver and team logos, driver images, car images, and race circuit layouts. Uploads are stored in the public `f1-assets` Supabase Storage bucket; only signed-in users can upload, and image files are limited to 10 MB.

In the Supabase SQL Editor, run `supabase/storage.sql` once to create the bucket and its access policies. Then sign in at `/admin` to upload images. The public image URLs are saved to the corresponding database fields.

## Team driver lineups

Run `supabase/team_driver_lineups.sql` in the Supabase SQL Editor to enable season-by-season team driver lineups on an existing database. In `/admin`, open **lineups**, choose a season, and assign two race drivers plus one reserve driver for each team. Past seasons can be selected and edited without replacing other years. Saved lineups are shown on each team page.

## Simulation setup

Run `supabase/simulation.sql` in the Supabase SQL Editor to add the optional driver, car, team, and circuit simulation fields, including the race circuit image URL and tyre image configuration. Existing race data remains intact. In `/admin`, edit a race to upload its circuit layout image, tune tyre wear, puncture risk, overheating threshold, and other circuit characteristics. Use the **tyre images** tab to upload an image for each compound; live timing displays the image instead of the compound name. The simulation displays the uploaded circuit layout when available; otherwise, it uses an illustrative schematic. `circuit_path` accepts an SVG path `d` value (for example `M 10 10 L 90 90`).

During a sprint or Grand Prix, select a driver in live timing or on the track map to open their telemetry and pit-command controls. Pit instructions are stored per driver for that race, and a tyre change resets tyre state without refuelling or repairing accumulated damage. The simulator is deterministic for the same seed and inputs; it is a game model, not an official sporting or vehicle-physics rules engine.
