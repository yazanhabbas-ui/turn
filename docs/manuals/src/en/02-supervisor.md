# Dor Supervisor Guide

## 1. Who this guide is for

You are a **supervisor**. You watch the floor, spot problems early and read the reports that show how the service is doing. You do not issue tickets or serve visitors yourself. Your job is to see what is happening and tell the right people.

With the standard Supervisor role you can:

- Watch the **Live wallboard**: people waiting, desks, agent status, long waits and alerts, in real time.
- **Acknowledge alerts** when you have dealt with them.
- Open **Reports**, filter them, and download them as Excel, CSV or PDF.
- Read the **visitor ratings** with the visitor, the agent, the stars and the comment.
- Look at the branches, desks, halls, visit reasons, users and agent groups of your organization (view only).
- Manage your own profile, language, password and two-step verification.

> **Note:** Your administrator decides what the Supervisor role includes, and can change it. This guide describes the standard role. If a screen mentioned here is missing for you, your role does not include it. Ask your administrator.

What the standard Supervisor role does **not** include:

- It has no **Reception** and no **Agent workspace**. You cannot issue, cancel, edit, reprint, transfer or reassign tickets from a screen. If a visitor must be moved to another agent or a ticket must be cancelled, ask the receptionist or the agent, or ask your administrator to give you the Reception area.
- It cannot change settings, thresholds, visit reasons, users, groups or screens.
- It cannot create **scheduled reports** (the emailed reports). Ask an administrator if your team needs them.

## 2. Before you start

### Signing in

1. Open the Dor address given by your administrator.
2. Enter your **Email** and **Password**, then press **Sign in**.
3. If two-step verification is on for your account, enter the **Verification code** from your authenticator app and press **Verify**.

After signing in you see **Choose where to work** with three tiles: **Administration**, **Reports** and **Live wallboard**. Click one. You can switch at any time with the links at the top of every page.

![The page where you choose where to work](shot:supervisor-home)

### Language and theme

At the top right of every page you can change the theme (light or dark) and the language. Dor works in Arabic and English. The language you choose is remembered for your account.

### Password and two-step verification

Click your name at the top right, then the link **Password, two-step verification and language**. This opens **My account**.

- **Change password**: enter the **Current password**, the **New password** and **Confirm new password**, then save. Other devices where you were signed in are signed out.
- **Two-step verification (TOTP)**: press **Enable two-step verification**, scan the code with an authenticator app such as Microsoft Authenticator or Google Authenticator, then enter the 6-digit code. To remove it later, press **Turn off**.
- **Interface language**: choose Arabic or English.

![My account](shot:supervisor-account)

If you lose your phone, ask an administrator to reset your two-step verification.

## 3. Know your screen

### The top bar

Every page has the same bar. On the left are the areas you may open (**Administration**, **Reports**, **Live wallboard**). On the right are the theme button, the language switcher, your name (click it for **My profile**) and **Sign out**.

### The Live wallboard

Open **Live wallboard**. The page title is **Live operations** (your organization may have chosen a different title). It updates by itself. The text **Updated Ns ago** shows how fresh it is, and a small connection indicator shows whether the live link is working. If data cannot be loaded you see "Could not load live data. Retrying..." and Dor keeps trying.

![The live wallboard](shot:supervisor-wallboard)

At the top:

- **Branch** drop-down: shown only if you may see more than one branch. Pick the branch to watch.
- A clock, the theme button and **Fullscreen (F)**. Press the F key or the button to fill the screen, for example on a wall monitor. Press F again, or use **Exit fullscreen (F)**, to leave.

The tiles show today's numbers for the chosen branch:

| Tile                                                                              | What it tells you                                                                     |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Waiting**                                                                       | Visitors waiting for a call right now                                                 |
| **Longest wait**                                                                  | How long the visitor who has waited most has been waiting, in minutes                 |
| **Agents available** / **Agents busy** / **Agents on break** / **Agents offline** | How many agents are in each state (agents who are away count as offline)              |
| **Served today**                                                                  | Visitors whose service is completed today                                             |
| **No-shows today**                                                                | Visitors who were called and did not come                                             |
| **At desks now**                                                                  | Visitors called or being served at the moment                                         |
| **On hold**                                                                       | Tickets put on hold by an agent                                                       |
| **Average wait today**                                                            | Average time between arrival and being called                                         |
| **Service level today**                                                           | Share of visitors called within the waiting target of their visit reason              |
| **Satisfaction today**                                                            | Visitor ratings, only when visitor feedback is switched on and shown on the wallboard |

Below the tiles:

- **Desks**: one card per desk, "Desk 3" and so on. It shows the agent, their status (**Available**, **Busy**, **On break**, **Away**, **Offline**) and for how many minutes they have been in it, plus the ticket they hold (for example `A-014`, **Serving**, with minutes). A desk with no one signed in shows **No agent**. If an agent has several visitors at once, all are listed.
- **Halls**: shown only when halls are used in the branch. Each hall shows **Free**, **Group called** or **In session**, the host ("Host: name" or **No host**), and how many seats are taken ("3 / 6").
- **Alerts**: open alerts (see below).
- **Waiting by reason**: one bar per visit reason with the number waiting and the longest wait. A reason that has passed its waiting target shows "over the N min target" and its bar turns red.
- **Long waits**: up to ten tickets that have waited longer than the limit set by your administrator, longest first.

The wallboard shows ticket numbers and counts only. It never shows visitor names or phone numbers.

### Alerts

Dor raises an alert by itself when something looks wrong. The messages you may see:

- A ticket has waited too long ("Ticket A-014 has waited 25 min (limit 20)").
- Too many people are waiting ("N people are waiting (limit M)").
- An agent has been idle while people are waiting.
- Several no-shows in a short time.
- A visitor gave a low rating, or the average satisfaction fell below the limit (only if visitor feedback is on).

When a new alert appears the page flashes briefly. If you have clicked or pressed a key on the page at least once, it also plays a short chime. The same problem is not raised again for an hour, or while its alert is still open.

The limits that trigger alerts are set by your administrator. You cannot change them.

### Reports

Open **Reports**. The page is called **Reports** and says "Waiting times, service quality and workload for the selected period."

![The reports page](shot:supervisor-reports)

**Filters** (at the top):

- **From** and **To** dates, or one of the **Date presets**: **Today**, **Yesterday**, **Last 7 days**, **Last 30 days**, **This month**. A period can be at most the number of days shown next to the dates.
- **Branch**, **Visit reason**, **Agent** and **Hall** (the last only where halls are used).
- **From hour** and **To hour**, and **Weekdays**.
- **Clear filters** puts everything back to the default.

The filters are kept in the page address, so you can bookmark or share a link with the filters already set.

The page has eight **tabs** under the filters: **Overview**, **Volume & queue**, **Staff**, **Reasons**, **Satisfaction**, **Visitor ratings**, **Repeat visitors** and **Forecast**. The filters and the **Download** button stay above the tabs and apply to all of them. On a phone the tabs scroll sideways.

**What each tab contains** (sections with no data are left out):

- **Overview**: the **Key figures**, grouped in four blocks, and **Peak hours**, a weekday-by-hour map where darker cells are busier. The first row shows **Total visitors**, **Served** (with no-shows and cancelled), **Average wait** and **Service level** with **Target met** or **Below target**. Then:
  - **Waiting**: **Median wait**, **90th percentile wait**, **Longest wait**, **SLA compliance** and **Abandonment**.
  - **Service**: **Average service time**, **90th percentile service time**, **Fairness index** and **Still open**.
  - **Visitors**: **Recall rate**, **Transfer rate** and **Returning visitors**.
  - **Satisfaction**: **Visitor satisfaction** and the recommend score, only when visitor feedback is on.
- **Volume & queue**: visitors per day, by hour, by weekday, per branch and by visit reason; **How tickets were issued** where it applies; and **Queue length and throughput** (people waiting by hour, visitors served per hour, still waiting at the end of the day).
- **Staff**: a table per agent with **Served**, **No-show**, **Transferred out**, **Transferred in**, **Avg service**, **Logged in**, **Break**, **Serving**, **Idle**, **Utilisation** and **Satisfaction**, and a chart of visitors served per agent. An even spread means work is shared fairly. **By shift** and **Halls (group sessions)** also sit here where they apply.
- **Reasons**: visitors, waits, service times and SLA per visit reason.
- **Satisfaction**: scores, and comments on low scores.
- **Visitor ratings**: every rating with who gave it (see "Read visitor ratings" below).
- **Repeat visitors**: visitors who came back. A visitor's mobile number is partly hidden unless your role may see personal data.
- **Forecast**: expected visitors for the next 7 days and tomorrow by hour, with the number of agents suggested. It needs enough history. Otherwise you see "Not enough history to forecast yet."

Many figures have a small **(?)** icon next to them. Hover over it, focus it with the keyboard or tap it to read what the figure means.

### Read visitor ratings

The visitor ratings list shows each rating a visitor gave after a visit. You see it in two places, if your role may view reports:

- On the **Administration** overview, in the card **Visitor ratings by agent**. This card has its own **From** and **To** dates and an **Agent** drop-down.
- In **Reports**, in the **Visitor ratings** tab. Here the dates follow the filters of the page, and the tab has its own **Agent** drop-down.

Each row shows:

- the **ticket** and the time of the rating;
- the visitor's **name** and **phone**, as reception or the kiosk recorded them, and where it was entered (**Reception**, **Self check-in kiosk**, **Agent walk-in**, **Appointment** or **API**);
- the **agent** and the desk;
- the rating, from 1 to 5 stars;
- the visitor's comment, if there is one.

Above the list you see the number of ratings and their average, for example "12 ratings · average 4.3 / 5". The list shows the newest 500 ratings. If there are more, narrow the dates or choose one agent. On a phone every rating is a small card instead of a table row.

The phone number is hidden except for its last 3 digits unless your role has the personal-data permission. Visitors who gave no name or phone show a dash.

### Branches, groups and other pages

**Administration** opens an overview and a side menu. For the standard Supervisor role it contains these pages, all view only (the **Add** and edit buttons do not appear):

- **Overview**: counts of branches, desks, users, visit reasons and roles, a red warning if a branch has no way to issue tickets, and the card **Visitor ratings by agent**.
- **Users**: the list of people and their roles.
- **Branches & desks**: branches, floors, desks and halls.
- **Visit reasons**: the services and their targets.
- **Agent groups**: teams of agents, each with a supervisor and members.

![Agent groups](shot:supervisor-groups)

You are probably the **Supervisor** of one or more agent groups. This is a label for the team; it is set by an administrator.

## 4. Everyday tasks

### Watch the floor

1. Open **Live wallboard**.
2. Pick your **Branch** if there is a drop-down.
3. Press **Fullscreen (F)** if you are showing it on a monitor.
4. Glance at **Waiting**, **Longest wait** and the red bars in **Waiting by reason**.
5. Check the **Desks**. A desk with **No agent** while many people are waiting means a counter is not open.

### Respond to an alert

1. Read the alert in the **Alerts** box.
2. Act: ask an agent to open their desk, ask an agent on break to return, or ask a receptionist to check on a visitor who waits too long.
3. When it is handled, press **Acknowledge** next to the alert. It disappears for everyone.

Acknowledge only after you acted. You need the permission to acknowledge alerts; if the button is missing, tell your administrator.

### Check who is on break

1. On the wallboard, look at **Agents on break**.
2. In **Desks**, find the cards that say **On break** and read how many minutes they have been so.
3. For history, open **Reports**, go to the **Staff** tab and read **Logged in**, **Break**, **Serving** and **Idle** for each agent.

### Find out why waits are long

1. Open **Reports** and choose **Today** or **Yesterday**.
2. Read **Average wait**, **90th percentile wait** and **Longest wait**.
3. Open **Peak hours** (in **Overview**) and **Queue length and throughput** (in **Volume & queue**) to see when the queue grows.
4. In the **Reasons** tab, find the reason with the highest waits.
5. In the **Staff** tab, check **Idle**, **Utilisation** and **Transferred out**.
6. Use the **Forecast** tab to plan the agents needed tomorrow.

### Compare agents fairly

1. Open **Reports**, and set the period.
2. In the **Staff** tab, compare **Served**, **Avg service** and **Satisfaction**.
3. Look at the **Fairness index** in the **Service** block of the **Overview** tab. A value near 1 means the work was shared evenly.
4. Use the **Agent** filter to see one person's numbers on their own.

### Find out what visitors said about an agent

1. Open **Reports** and set the dates, or use the card **Visitor ratings by agent** on the **Administration** overview.
2. Open the **Visitor ratings** tab (in the card there is no tab).
3. Choose the **Agent**.
4. Read the stars and the comments. Look at the ticket and time if you need to find the visit.

### Download a report

1. Set the filters you want. The file follows them.
2. Press **Download** (top right of the page).
3. Under **File type** choose **Excel (.xlsx)**, **CSV** or **PDF**.
4. Choose the **Sections**, either with **Quick picks** (**Overview**, **Staff and shifts**, **Repeat visits**, **Visitor satisfaction**) or by ticking sections. **Select all** and **Clear** help. Sections marked **No data** will only contain headings.
5. Press **Download**.

To download a single section, press the small download icon at the top of its card. It uses the file type you chose last.

If the file cannot be created you see "The file could not be created. Please try again in a moment."

### Look up a group or a desk

1. Open **Administration**, then **Agent groups** to see each team, its **Supervisor** and its **Members**.
2. Open **Branches & desks** to see desk numbers, floors and halls.
3. Open **Users** to find a person's roles.

If something is wrong, tell an administrator. You cannot edit these pages.

### Update your profile

1. Click your name at the top right to open **My profile**.
2. To add a photo, press **Add a picture** (or **Change picture**), choose a PNG, JPEG or WebP file up to 2 MB, and press **Use this picture**. **Remove** takes it away.
3. The page also shows your **Roles**, **Member since** and **Last sign-in**, and under **My activity** the changes you made. Use the filters to choose the type and the period.
4. Use the link **Password, two-step verification and language** for your security settings.

![My profile](shot:supervisor-profile)

## 5. Good practice and tips

- Keep the wallboard open while you supervise and watch **Longest wait**, not just the number waiting.
- Handle alerts quickly and acknowledge them, so a new alert is easy to see.
- Compare like with like: use the same period and branch when you compare two days.
- Check **Idle** and **Break** together in the agents table before drawing conclusions about an agent.
- Use the **Forecast** and **Peak hours** to ask for more agents at the right time.
- Do not share downloaded reports outside your organization. They may contain personal data in some sections.
- Sign out when you leave a shared computer.

## 6. Common questions and troubleshooting

| Problem                                                           | What to do                                                                                                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I cannot see **Reports** or **Live wallboard** at the top.        | Your role does not include it. Ask an administrator.                                                                                                    |
| A page says **Access denied**.                                    | Your role does not include that page. Ask an administrator if you need it.                                                                              |
| I need to move a visitor to another agent or cancel a ticket.     | The standard Supervisor role has no screen for this. Ask the receptionist or the agent, or ask an administrator to add the Reception area to your role. |
| There is no **Acknowledge** button.                               | Your role cannot acknowledge alerts. Ask an administrator.                                                                                              |
| The wallboard shows "Could not load live data. Retrying..."       | Check your connection. Dor retries on its own. Reload the page if it continues.                                                                         |
| **Updated Ns ago** keeps growing.                                 | The live link is broken. Reload the page.                                                                                                               |
| There is no chime for a new alert.                                | Click anywhere on the page once. Browsers allow sound only after you interact with the page.                                                            |
| I do not see a **Branch** drop-down.                              | You may see only one branch.                                                                                                                            |
| The report says "No visitors in the selected period and filters." | Widen the dates or press **Clear filters**.                                                                                                             |
| **Forecast** says "Not enough history to forecast yet."           | The branch has too little past data. It improves over time.                                                                                             |
| The download fails.                                               | Try again. If it still fails, try fewer sections or another file type.                                                                                  |
| I cannot find **Scheduled reports**.                              | Your role cannot create them. Ask an administrator.                                                                                                     |
| Visitor numbers in the reports are partly hidden.                 | Your role is not allowed to see personal data. This is intended.                                                                                        |
| I lost my phone for two-step verification.                        | Ask an administrator to reset it, then enable it again from **My account**.                                                                             |

## 7. Quick reference

| Where          | Action                                                                 | What it does                                                                |
| -------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Wallboard      | **Branch**                                                             | Chooses which branch you watch                                              |
| Wallboard      | **Fullscreen (F)**                                                     | Fills the screen; press F again to leave                                    |
| Wallboard      | Theme button                                                           | Switches the wallboard between light and dark for you                       |
| Wallboard      | **Acknowledge**                                                        | Closes an alert you have handled                                            |
| Reports        | Date presets                                                           | **Today**, **Yesterday**, **Last 7 days**, **Last 30 days**, **This month** |
| Reports        | **Branch**, **Visit reason**, **Agent**, **Hall**, hours, **Weekdays** | Narrow the report                                                           |
| Reports        | **Clear filters**                                                      | Resets the filters                                                          |
| Reports        | Tabs (**Overview** to **Forecast**)                                    | Switch between the eight views of the report                                |
| Reports        | **Download**                                                           | Opens the dialog to get Excel, CSV or PDF                                   |
| Reports        | **Agent** (in **Visitor ratings**)                                     | Shows the ratings of one agent                                              |
| Reports        | Download icon on a card                                                | Downloads only that section                                                 |
| Administration | **Agent groups**, **Branches & desks**, **Users**                      | View teams, desks and people (read only)                                    |
| Top bar        | Your name                                                              | Opens **My profile**                                                        |
| My account     | **Change password**                                                    | Sets a new password                                                         |
| My account     | **Enable two-step verification**                                       | Adds a code from an authenticator app at sign-in                            |
| Top bar        | **Sign out**                                                           | Ends your session                                                           |
