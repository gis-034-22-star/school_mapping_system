# Connecting the system to Supabase (about 15 minutes)

Visitors never log in. Only the administrator uses `admin.html`.

## 1. Create the project
1. Go to https://supabase.com, sign in and click **New project** (free plan is enough).
2. Choose a name and a database password (keep it safe) and a nearby region.

## 2. Create the tables and security rules
1. Open **SQL Editor > New query**.
2. Open `supabase/setup.sql`, change `your-admin-email@example.com` (last lines) to YOUR admin email, paste the whole file and click **Run**.
3. New query again: paste `supabase/seed.sql` and click **Run** (loads the 183 existing schools). Run it only once.

## 3. Create the administrator account
1. **Authentication > Users > Add user > Create new user**.
2. Use the SAME email as in step 2, choose a strong password, tick **Auto Confirm User**.
3. Sign-ups: if you use **School Registrations and Updates** (section 6), keep **Allow new users to sign up** ON.
   Registered users can only submit; only the emails in the `admins` table (education officers) can change schools or approve submissions.

## 4. Connect the website
1. **Project Settings > API**. Copy the **Project URL** and the **anon public** key.
2. Open `js/config.js` and paste them between the quotes.
3. Upload the project to GitHub (including the new `admin.html`, `js/` files and `supabase/` folder).
   - The **anon public** key is meant to be public. The security comes from the rules in `setup.sql`.
   - NEVER put the **service_role** key anywhere in the project.

## 5. Use it
- Public pages (map, schools, dashboard) now read schools from Supabase.
- Administrator: open `admin.html`, sign in, then add, edit or delete schools. The public map shows changes straight away (refresh the page).
- **Backup (JSON)** downloads all schools as `schools-backup.json`.
- If Supabase cannot be reached, the pages fall back to `data/schools.json`.

## 6. School Registrations and Updates (registered users submit, education officers approve)
1. **SQL Editor > New query**: paste the whole of `supabase/registrations.sql` and click **Run** (once).
   It creates the submissions table, the Lilongwe City boundary, the private `school-evidence` storage bucket and the approval function.
2. **Authentication > Sign In / Providers > Email**: make sure **Allow new users to sign up** is ON.
   - **Confirm email**: if ON, new users must click a link in an email. Supabase's built-in email service only sends a few emails per hour
     ("email rate limit exceeded"), so for a demonstration you can turn **Confirm email** OFF, or set up your own SMTP under **Authentication > SMTP Settings**.
3. **Authentication > URL Configuration**: add your site address (for example `https://gis-034-22-star.github.io/school_mapping_system/registrations.html`)
   under **Redirect URLs**, so the confirmation and password-reset links return to the site.
4. Education officers = the emails in the `admins` table. To add one:
   `insert into public.admins (email) values ('officer@example.com');` (the officer must also have an account).
5. Upload `registrations.html`, `admin.html`, `index.html`, `data/lilongwe-boundary.json` and the `pages/about.html` file to GitHub.

How it works
- Anyone registers at `registrations.html`, then submits a new school or an update: name, level, ownership, type, location and supporting documents.
- Location: from GPS or by clicking the map. It is rejected if outside the Lilongwe City boundary, if the coordinates are invalid, or if another school is within 30 m.
  These checks run in the browser AND in the database, so they cannot be bypassed.
- Documents (PDF/JPG/PNG/WEBP, max 5 MB each, up to 5) are stored privately. Only the submitter and the education officers can open them.
- Officers open `admin.html` > **School Registrations and Updates**, check the details and documents, then **Approve and publish** or **Reject** (with a reason).
  Only approved submissions are added to / change the `schools` table, so only then do they appear on the public map.

### Replace the approximate city boundary
`registrations.sql` loads an approximate boundary (an outline of the existing schools plus a 0.7 km margin). When you have the official
Lilongwe City boundary as GeoJSON, update it in SQL Editor (the coordinates are [longitude, latitude]; the first and last point must be the same):

    update public.city_boundary
    set geojson = '{"type":"Polygon","coordinates":[[[33.66,-14.03],[33.70,-14.05],[33.66,-14.03]]]}'::jsonb
    where id = 1;

The same change in `data/lilongwe-boundary.json` is only a backup used if the database cannot be reached.
