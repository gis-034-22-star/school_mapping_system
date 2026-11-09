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
3. **Authentication > Sign In / Providers (or Providers > Email)**: turn OFF **Allow new users to sign up**.
   (Even if left on, only the emails in the `admins` table can change schools.)

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
