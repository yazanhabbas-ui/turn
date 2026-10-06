# Dor Administrator Guide

## 1. Who this guide is for

This guide is for the people who set up and run Dor: the **Super admin** of the whole organization and the **City admin** of one city. You decide how many cities, branches and desks exist, which services visitors can ask for, who works where, how tickets reach agents, and how the system looks and behaves.

There are two administrator roles. They use the same screens, but they do not see the same things.

|               | Super admin                                            | City admin                                                                       |
| ------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Scope         | The whole organization: every city and branch          | Only the city (or branches) the role was given for                               |
| Cities        | Creates, edits and archives cities                     | Cannot open the **Cities** page                                                  |
| Roles         | Creates, edits and clones roles                        | Can view roles only                                                              |
| Settings app  | Has it. Every section, at organization, city and branch level | Has no **Settings** app. Asks a super admin to change a setting |
| Users         | Can give any role, including organization-wide ones    | Can only give roles and scopes they hold themselves                              |
| Backup status | Sees the **Database backup** card on the Overview      | Does not see it                                                                  |

Your sidebar only shows the pages your role allows. If a page described here is missing, your role does not include it.

**Settings** is not part of Administration. It is a separate app, **Settings**, in the top bar next to **Administration**. Only super admins see it. Wherever this guide says to open a setting, a super admin does it there. A city admin asks a super admin.

> **Note:** Every change an administrator makes takes effect immediately and is written to the **Audit log** (in the **Settings** app, super admins only). There is nothing to restart.

## 2. Before you start

1. Open Dor in your browser and enter your **Email** and **Password**, then press **Sign in**. If the sign-in page asks for an **Organization code**, enter it too.
2. If two-step verification is on for your account, type the 6-digit code from your authenticator app and press **Verify**.
3. Press your name at the top of the page to open **My profile**, then follow the link **Password, two-step verification and language**. There you can **Change password**, set the **Interface language** (Arabic or English) and turn on two-step verification with an authenticator app. The light or dark theme can be switched from the top bar.
4. If your account has several workspaces, the top bar shows them as links. Pick **Administration**.

> **Tip:** Turn on two-step verification for every administrator account. In the **Settings** app, under **Security**, a super admin can make it compulsory for whole roles.

![The Overview page of the super admin](shot:admin-overview)

## 3. Know your screen

The **Overview** is the first page. It greets you and shows five counters: **Branches**, **Desks**, **Users**, **Visit reasons** and **Roles**. For a city admin the counters count only their own city.

![The Overview page of a city admin: fewer pages in the sidebar](shot:admin-overview-city)

Under the counters you may see warning cards:

- A **coverage** card appears when some branches have no way to issue tickets (no receptionist, agent walk-in issuing off and no kiosk paired). It has an **Open branches** button.
- A second card appears when a branch has services served in halls but nobody can serve them. It has an **Open settings** button, which opens the **Settings** app (super admins only).
- The card **Visitor ratings by agent** (if your role may view reports) lists the ratings visitors gave, with the visitor, the agent, the stars and the comment. It has its own **From** and **To** dates and an **Agent** filter. See 4.15.
- The **Database backup** card (super admin only) shows **Backed up**, **Backup is overdue**, **Last backup failed** or **No backup recorded**.

The sidebar lists the admin pages:

| Page                    | What it is for                                                             |
| ----------------------- | -------------------------------------------------------------------------- |
| **Overview**            | Counters and warnings                                                      |
| **Users**               | People who sign in, **Invitations** and account **Requests**               |
| **Roles & permissions** | What each role may do                                                      |
| **Cities**              | Cities and their configuration (super admin)                               |
| **Branches & desks**    | Branches, floors, desks and halls                                          |
| **Visit reasons**       | The services visitors come for                                             |
| **Agent groups**        | Teams of agents                                                            |
| **Distribution rules**  | How tickets reach agents                                                   |
| **Simulate**            | Test rules on a replayed day                                               |
| **Screens**             | Waiting-room screens, kiosks, announcements, voice (see the screens guide) |
| **Privacy requests**    | Export or erase a visitor's data                                           |

Settings, Reports and the live wallboard are separate workspaces in the top bar, not part of the Administration sidebar. **Settings** appears there only for super admins. The **Audit log** is not an Administration page either: it is in the **Settings** app (see 4.17).

## 4. Everyday tasks

### 4.1 First-time setup: the right order

Set things up in this order, because each step needs the one before it.

1. **Branding** (super admin, in the **Settings** app): **Settings > Branding**. Set the **Company name**, upload the **Logo**, choose colours.
2. **Cities** (super admin): add each city.
3. **Branches and desks**: add branches, floors and desks. Add halls if you use them.
4. **Visit reasons**: define each service, its ticket prefix, the data to collect, and who serves it.
5. **Users and agents**: create the people, give them roles, set up agents.
6. **Agent groups** (optional): put agents in teams.
7. **Shifts** (super admin, in the **Settings** app): **Settings > Agents**.
8. **Distribution rules**: choose how tickets reach agents, and test with **Simulate**.
9. **Settings review** (super admin, in the **Settings** app): numbering, reception, wait estimate, security and privacy.
10. **Screens, voice and kiosks**: follow the screens guide.

The **Going live checklist** at the end of this guide repeats the essentials.

### 4.2 Add a city (super admin)

1. Open **Cities** and press **Add city**.
2. Enter the name in Arabic and English and a **Code** (letters A-Z, digits, hyphen and underscore, for example `DAM`).
3. Save. The city appears as a card showing how many branches it has.

Each city card has a **Configuration** area. It shows how many settings the city overrides, how many branch overrides exist and how many visit reasons are hidden. Use **Open city settings** to change them. Use **Copy from another city** and **Copy configuration** to start a new city from an existing one. This replaces the new city's setting overrides and hidden reasons; branch overrides, shifts and message templates are not copied.

You can archive a city only when it has no active branches.

### 4.3 Add a branch, floors and desks

1. Open **Branches & desks** and press **Add branch**.
2. Choose the **City**, enter the **Branch code**, **Address** and **Time zone**. The time zone matters: the ticket numbering reset and the reports follow the branch's own time.
3. Tick **Default branch** if it should be the default. Save.
4. On the branch card, press **Add floor** if the building has several floors.
5. Press **Add desk**. Enter the **Number** (it is shown on screens and spoken, for example "Desk 3"), choose the **Floor** and, if you use multi-zone screens, a **Zone**.

Use the city filter at the top to narrow the list. If you use halls (rooms where one host receives several visitors together), add them in the branch's **Halls** block with **Add hall**: **Hall number**, **Capacity** (at least 2) and **Services accepted**. Halls only work once a super admin switches them on in the **Settings** app, under **Halls**.

![Branches and desks](shot:admin-branches)

### 4.4 Create visit reasons and intake fields

A visit reason is a service, such as "Contract renewal". Every ticket belongs to one.

1. Open **Visit reasons** and press **Add reason**.
2. In **Basics**, enter the names, a **Code** (lowercase, used in reports) and the **Ticket prefix** (1 to 3 letters, Latin or Arabic, for example `A`). Choose the **Default priority**.
3. Under **Service targets**, set **Expected service time (min)** and **Target waiting time (SLA, min)**. The SLA is used by reports and ordering, and the expected time by the wait estimate.
4. Tick **Show first at reception** to make it a large button for two-tap issuing.
5. Under **Visitor information to collect**, tick only the fields you really need (visitor name, mobile number, company, last 4 digits of ID, email, notes). Press **Add custom field** for others. Fields you do not tick are not shown.
6. Under **Where it is served**, choose **Desk** (one visitor at a time) or **Hall** (several visitors together).
7. Under **Appointments**, tick **Allow appointments** if needed. Under **Self check-in kiosk**, choose whether visitors may type this service themselves or whether it **Needs a member of staff**.
8. Under **Who serves this reason**, press **Add agent** or **Add group**. For each, set the **Proficiency** (1 to 5) and mark them **Primary** or **Backup**. Backups receive tickets when primary agents are busy.
9. Save.

> **Warning:** A reason with nobody assigned shows **Nobody assigned** in red: its tickets cannot be served until you assign someone.

You can archive a reason you no longer use. It disappears from reception, but history and reports keep it.

![Visit reasons](shot:admin-reasons)

### 4.5 Create users and agents

1. Open **Users** and press **Add user**.
2. Enter **Email**, **Full name**, **Mobile** and **Preferred language**.
3. Under **Roles**, press **Add role**. For each row choose the **Role** and the **Scope**: **Whole organization**, a city (all its branches) or a single branch. A city admin cannot choose the whole organization.
4. For people who serve visitors, switch on **Serves visitors** and set **Works at branch**, **Default desk** (or **Default hall** for a host), **Max tickets at once**, **Distribution weight**, **Groups** and **Shift**.
5. **Initial password**: type one, or leave it empty. If you leave it empty, Dor creates a set-password link, valid for 72 hours, and shows it on screen so you can copy it and send it to the user. If your server is set up to send email, Dor also emails the link to the user as an activation email.
6. Save.

> **Note:** The account emails Dor can send (activation, password link, approval) use built-in wording in Arabic and English. You do not need to write them, and they are sent only if your server is set up for email.

Open any user from the list to edit them. The dialog also has these actions:

| Action                        | Effect                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Reset password**            | Signs the user out everywhere and creates a new single-use link valid for 24 hours. **Also send by email** sends it too. |
| **Reset 2FA**                 | Turns off two-step verification, for example when a phone is lost.                                                       |
| **Sign out everywhere**       | Ends all of the user's sessions.                                                                                         |
| **Deactivate** / **Activate** | Blocks or restores sign-in. History is kept. You cannot deactivate yourself or the last administrator.                   |
| **Anonymize**                 | Permanently removes name, email, phone and picture. The account stays in history as a deleted user. Cannot be undone.    |

A padlock next to a user means the account is locked after too many failed sign-ins; **Activate** also clears a lock.

![Users list](shot:admin-users)

### 4.6 Invite people

An invitation lets a person choose their own password. Invitations are link-only: Dor creates a link and you give it to the person yourself, for example in your own chat or email. Dor does not send it for you.

1. In **Users**, press **Invite**.
2. Enter the person's name, **Email** and/or **Mobile** (at least one of them is needed).
3. Choose the **Role** and the branch, and the **Invitation language**.
4. Press **Create invitation**.
5. Dor shows "Invitation created. Share this link:" with a copy button. Copy the link and send it to the person.

Open the **Invitations** tab to follow each invitation: **Pending**, **Accepted**, **Expired** or **Revoked**. **Resend** creates a new link (which you copy again) and the old one stops working. **Revoke** cancels a pending invitation. An invitation stays valid for the number of hours set by a super admin in the **Settings** app, under **Security > Invitation validity (hours)**.

### 4.7 Approve or reject sign-up requests

If a super admin switches on **Let people request an account on the sign-up page (an administrator approves each request)** in the **Settings** app, under **Security**, a **Request an account** link appears on the sign-in page. People fill in their name, email, phone and a password.

1. Open **Users** and then the **Requests** tab. A number badge shows how many are waiting.
   ![The Requests tab with pending account requests](shot:admin-requests)
2. Press **Approve** on a request. Choose the **Role** and branch, then confirm. The person can sign in immediately with the password they chose.
3. Or press **Reject**. The person is told the request was not approved, and may apply again.

Nobody gets access before you approve. Turn the setting off when you no longer want requests.

### 4.8 Roles and permissions

Open **Roles & permissions**. There are four built-in roles: **Super admin**, **City admin**, **Receptionist** and **Agent**. They are marked **Built-in** and cannot be changed or deleted. Your organization may also have custom roles marked **Custom**.

To make a custom role (super admin only):

1. Press **Clone** on a built-in role, or **New role**.
2. Enter the name and tick the **Permissions** you want. They are grouped (Administration, Users & roles, Organization, Services & distribution, Tickets & appointments, Agent, Reports & monitoring, Data protection, Integrations).3. Save.

**Escalation rule:** nobody can give a role, or put a permission in a role, that they do not hold themselves. A city admin therefore cannot give someone a role that contains organization-level permissions such as managing cities, settings or roles.
![Roles and permissions](shot:admin-roles)

### 4.9 Agent groups

A group is a team, such as "Customer service". Assign a group to a visit reason instead of listing every agent.

1. Open **Agent groups** and press **Add group**.
2. Enter the name, choose the **Supervisor**, and add **Members**.
3. Save.

### 4.10 Shifts and breaks

- **Shifts**: in the **Settings** app (super admin), open **Agents**, press **Add shift**. Give it a **Code**, a start and an end. If the end is earlier than the start, the shift runs past midnight. A city has its own shifts as well as the organization's. Then assign shifts to agents in the user dialog.
- **How shifts are used** has three choices. **Ignored**: shifts are only labels. **Guide (recommended)**: used in reports, and agents outside their shift get no automatic assignments but can still be called manually. **Strict**: an agent cannot become available outside their shift and is signed out after it ends (with a grace period in minutes).
- **Break types**: in the **Settings** app, under **Break types** (super admin). Add types with a **Maximum minutes** and whether they **Count as productive time**.
- **Break limit**: in the **Settings** app, **Break limit** limits how many agents of a branch may be on a break at once.

### 4.11 Distribution rules

Open **Distribution rules**. Use **Applies to** at the top to choose **All branches (default)**, one branch, or one visit reason in a branch. A narrower scope can override the default.

1. Choose the **Mode**:
   - **Pull (bank style)**: tickets wait in the queue; an agent presses **Call next**.
   - **Auto-assign**: each ticket is reserved for one agent at once, chosen by the strategy steps you set. Steps apply in order, each one breaking ties left by the previous one: **Least recently assigned**, **Fewest waiting tickets**, **Longest idle agent**, **Highest proficiency first**, **Weighted (agent weight)**, **Random**, **Strict rotation**.
   - **Hybrid**: auto-assign, but if the agent does not call the ticket within the minutes you set, it is released to everyone and a supervisor can be alerted.
   - **Manual**: the receptionist or a supervisor chooses the agent.
   - **Round robin**: a fixed rotation; absent or full agents are skipped.
2. Tune **Order inside the queue** (weights for waiting time, priority and SLA pressure, appointment boost, priority lanes, a **Maximum wait guarantee**, **Aging steps**).
3. Set **Agent capacity**, **Overflow to backup agents**, **Returning visitors** (prefer the agent who served the visitor last time) and the **No-show policy** (automatic recall, then close the ticket or send it to the end of the queue).
4. Save. The message **Rules saved. They apply from the next ticket.** appears.

When a branch or reason has its own rules, the page says **This scope overrides the inherited rules.** Use **Remove override** to go back to the default.

![Distribution rules](shot:admin-distribution)

### 4.12 Test rules with the simulator

Before changing live rules, try them on a pretend day.

1. Open **Simulate**.
2. Choose the **Branch**. For **Visitors**, choose **Generated day** (set the **Number of visitors**, **VIP share**, **Elderly share**) or **Replay a real day** (pick the **Day to replay**).
3. Select the **Agents**. Use **Extra generic agents (what-if)** to see the effect of more staff.
4. Under **Rules to compare**, keep **Current rules** and press **Add candidate** to add alternatives.
5. Press **Run simulation**. The **Results** table compares average, median and 90th percentile wait, longest wait, **Within SLA (%)** and **Fairness**, and marks the **Best** value. Charts show people waiting over the day and visitors per agent.

The simulator uses the same engine as the live system but changes no real ticket. From **Distribution rules**, the button **Try these rules in the simulator** takes you straight there.

### 4.13 Settings

Settings is its own app, separate from Administration. Only super admins have it: press **Settings** in the top bar, next to **Administration**. City admins and other administrators do not see it. They still use Administration for users, branches and desks, visit reasons, agent groups, distribution rules, screens and privacy requests, as their permissions allow, and they ask a super admin to change a setting. They cannot open the audit log either (see 4.17). The old address `/admin/settings` redirects to the Settings app.

In the Settings app the left menu lists the sections, grouped as General, Visitors & tickets, Agents & service, Screens & reports, Security & privacy. Choose one to open it. A **Search settings...** box at the top of the page finds any option.

The **Applies to** switcher decides the level you are editing. Values are inherited from the organization, then the city, then the branch. For a section that allows it, switch on **Override for this city** (or branch) to give that level its own value. **Reset to default** removes the override. Each section shows where its current value comes from. A bar shows **You have unsaved changes**; press **Save** or **Discard**.

| Section                                 | What you set                                                                                                                                                                     | Level               |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| **Branding**                            | **Company name**, **Logo** (PNG, JPEG, WebP or still GIF up to 5 MB) and a separate **Logo for dark backgrounds**, primary and accent colours, font, welcome text, ticket footer | Organization        |
| **Help center**                         | **Show the Help center**: the book icon in the top bar and the Help center page (the manuals). When it is off they are hidden for everyone | Organization        |
| **Language & calendar**                 | Digits on screens, tickets and voice (Western or Arabic-Indic), time format (12 or 24 hours), phone country code, **Show Hijri date**                                            | City                |
| **Tickets**                             | **Number digits** (3 gives `A-007`), **Separator**, **Daily numbering reset time**, **Print QR code on tickets**                                                                 | City                |
| **Reception**                           | One-tap issuing, automatic printing, priority and language choices, what happens after issuing, whether agents can issue walk-in tickets                                         | Branch              |
| **Self check-in**                       | Kiosk on or off, printing, limits, services offered, welcome text                                                                                                                | Branch              |
| **Wi-Fi**                               | Guest Wi-Fi details printed on the ticket                                                                                                                                        | Branch              |
| **Waiting time**                        | How the estimate shown to visitors is worked out (fixed, per reason, or learned from real visits), rounding, safety margin, wording                                              | Branch              |
| **Visitor page**                        | The page opened from the ticket QR code: turn it on or off                                                                                                                            | City                |
| **Feedback**                            | Ask visitors to rate the visit (faces or stars), comment, recommend question, what counts as a low score                                                                         | Branch              |
| **Priority lanes**                      | Priority levels, their weight and whether they form a separate lane                                                                                                              | Organization        |
| **Agents**                              | Several visitors at once, shifts                                                                                                                                                 | City                |
| **Halls**                               | Switch halls on, grouping, announcing                                                                                                                                            | Branch              |
| **Break limit**, **Break types**        | Breaks                                                                                                                                                                           | City / Organization |
| **Wallboard**                           | Look of the live wallboard and the waiting-room screens' default look                                                                                                            | Branch              |
| **Reports**                             | Service level minutes and target, target utilisation, forecast history                                                                                                           | City                |
| **Alerts**                              | Thresholds for long wait, queue size, idle agent, no-show spike, low satisfaction, and **Email recipients**                                                                      | Branch              |
| **Security**                            | See 4.14                                                                                                                                                                         | Organization        |
| **Data retention**, **Data protection** | See 4.16                                                                                                                                                                         | Organization        |

The **service day**: the **Daily numbering reset time** (in **Tickets**) is the branch-local time at which ticket numbers start again from 1.

Two more options in **Tickets**:

- **Restart numbers after**: during the day, after this ticket number the next one starts again at 1 (set 100 and the line goes `A-100`, then `A-001`). **0** keeps counting until the daily reset. A number still held by a waiting visitor is skipped, so two visitors never share a number.
- **Call visitors by the last digits of their phone number** (with **Digits called**, 3 by default): for desks without a printer. Reception types the visitor's phone number and the screens and the voice call its last digits instead of the ticket number. Only the last digits are stored. Two visitors in the line cannot have the same digits.

![Settings](shot:admin-settings)

### 4.14 Security settings (super admin)

In the **Settings** app, under **Security**:

- **Password policy**: **Minimum length**, and whether to require an uppercase letter, lowercase letter, number or symbol.
- **Lock after failed sign-ins** and **Lock duration (min)**.
- **Invitation validity (hours)**.
- **Let people request an account on the sign-up page...**: see 4.7.
- **Roles that must use 2FA**: tick the roles. People in those roles must use two-step verification.

### 4.15 Reports, visitor ratings and scheduled reports

Open **Reports** from the top bar (it needs the report permissions, which both administrator roles have). Choose a period (**Today**, **Yesterday**, **Last 7 days**, **Last 30 days**, **This month** or custom dates) and filters (branch, visit reason, agent, hall, hours, weekdays). The filters and the **Download** button stay above the tabs. The page has eight tabs:

| Tab                 | What it shows                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| **Overview**        | Key figures in four groups (**Waiting**, **Service**, **Visitors**, **Satisfaction**) and peak hours |
| **Volume & queue**  | Visitors per day, hour, weekday, branch and reason, ticket sources, queue length and throughput      |
| **Staff**           | Agents, shifts and halls                                                                             |
| **Reasons**         | Waits, service times and SLA per visit reason                                                        |
| **Satisfaction**    | Scores and comments on low scores                                                                    |
| **Visitor ratings** | Every rating with the visitor, desk, agent, stars and comment                                        |
| **Repeat visitors** | Visitors who came back                                                                               |
| **Forecast**        | Expected visitors and suggested agents                                                               |

- **Visitor ratings** lists each rating with the ticket and time, the visitor's name and phone as recorded by reception or the kiosk (and where it was entered), the agent and desk, the stars and the comment. In this tab the dates follow the page filters and you can also pick an **Agent**. The same list, with its own dates, is the card **Visitor ratings by agent** on the **Overview** of Administration. The newest 500 are shown. The phone number shows only its last 3 digits unless your role has the visitor privacy (personal data) permission. On a phone each rating is a card.
- **Download** exports **Excel (.xlsx)**, **CSV** or **PDF**, with the sections you pick.
- Open **Scheduled reports** at the bottom and press **Add scheduled report** to email a report automatically. Choose the **Frequency** (**Every day** covers the previous day; **Every week** covers the seven days ending yesterday), **Send at**, **File format**, **Report language**, branch, **Recipients** (one email per line) and sections. **Send now** tests it. If email is not configured nothing is sent.

### 4.16 Privacy tools and data retention

**Privacy requests** handles a visitor asking for their data.

1. Open **Privacy requests**. Type a phone number, name or ticket number and press **Search**.
2. Select the visitor. You see what is held (tickets, appointments, feedback, notifications).
3. **Export JSON** or **Export CSV** gives the person their data.
4. To erase, press **Erase now**, write a **Reason** (no names or numbers), tick **I confirm the identity of the person and want to erase their data.** and confirm. Name, phone and company are removed and notes and comments are cleared. Tickets and scores stay in reports. This cannot be undone.

Every request is listed under **Request history** without the person's details. To remove a staff member's personal data, use **Anonymize** in the user dialog.

**Retention** (**Settings** app, **Data retention**, super admin): set the number of days after which visitor data is anonymized, ticket notes and intake answers are cleared, feedback comments are cleared, notification details are cleared, audit entries are deleted and expired sign-in records are deleted. **0** keeps that data until you erase it by hand. The job runs by itself about once a day. **Preview** shows what it would change without changing anything. **Run now** applies it for good. **Data protection**, in the same app, holds the **Consent text on the reception form** and **Require consent before issuing a ticket**.

### 4.17 Audit log

Open the **Settings** app and press **Audit log** at the bottom of its left menu (address `/settings/audit`). Only super admins can open it. City admins and other administrators have no **Audit log** in Administration and cannot open it, and the old address `/admin/audit` redirects to the new one. Each row shows **When**, **Who**, **Action**, **Item** and **Details**, with **Before** and **After** values for changes. Filter by item type with **All items** and press **Load more** for older entries. Use it to answer "who changed this setting?"

![Audit log](shot:admin-audit)

### 4.18 Backups

Backups are taken by scripts on the server, not from this application. Ask whoever runs the server to schedule them, and read the file `docs/backup-restore.md`. The **Database backup** card on the Overview shows whether the last backup succeeded.

## 5. Good practice and tips

- Give each person the smallest role they need. Use a custom role such as a supervisor (reports, wallboard, reassign tickets) instead of making someone an administrator.
- Keep at least two administrators so you are never locked out.
- Set each branch's time zone correctly before the first ticket.
- Use **Simulate** before you change distribution rules on a busy branch.
- Have a super admin review the **Audit log** (**Settings** app) regularly, especially roles, users and settings.
- Collect only the visitor data you need and set retention periods.
- Make sure every visit reason has at least one primary agent and a branch has a way to issue tickets.

## 6. Common questions and troubleshooting

| Problem                                      | What to do                                                                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| A page in this guide is not in my sidebar    | Your role does not include it. A city admin has no **Cities** page and no **Settings** app. Ask a super admin.             |
| "Access denied"                              | Your role lacks the permission. Ask a super admin to change your role.                                                                  |
| I cannot give a role to someone              | You can only give roles whose permissions you hold, and only within your own scope.                                                     |
| Tickets for a service are never called       | Open the visit reason: nobody is assigned, or the assigned agents are not signed in or are outside their shift (**Settings** app, **Agents**). |
| A branch cannot issue tickets                | The Overview warning card tells you why. Add a receptionist, enable agent walk-in issuing, or pair a kiosk.                             |
| New user did not get an email                | Email may not be set up on the server. Copy the link from the dialog and send it yourself. Invitation links are never sent by Dor.      |
| The invitation link stopped working          | It expired or was replaced by **Resend**. Resend it.                                                                                    |
| A user is locked out                         | Open the user and press **Activate**, or wait for the lock duration. Use **Reset password** if needed.                                  |
| A user lost their phone                      | Open the user and press **Reset 2FA**.                                                                                                  |
| A setting change does not show at one branch | That branch may have its own override. A super admin can use the **Applies to** switcher in the **Settings** app and check the source badge. |
| Ticket numbers restarted at an odd moment    | Check **Daily numbering reset time** and the branch time zone.                                                                          |

## 7. Quick reference

| I want to...                       | Go to                                                 |
| ---------------------------------- | ----------------------------------------------------- |
| Add a city                         | **Cities > Add city**                                 |
| Add a branch, floor or desk        | **Branches & desks**                                  |
| Add a service                      | **Visit reasons > Add reason**                        |
| Assign agents to a service         | Visit reason > **Who serves this reason**             |
| Create a user                      | **Users > Add user**                                  |
| Invite a person (copy the link)    | **Users > Invite**                                    |
| Approve an account request         | **Users > Requests > Approve**                        |
| Reset a password or 2FA            | Open the user > **Reset password** / **Reset 2FA**    |
| Make a custom role                 | **Roles & permissions > Clone** or **New role**       |
| Change how tickets are assigned    | **Distribution rules**                                |
| Test rules safely                  | **Simulate > Run simulation**                         |
| Change logo, colours, numbering    | **Settings** app (super admin)                        |
| Set password rules and 2FA         | **Settings** app > **Security** (super admin)         |
| See visitor ratings by agent       | **Overview** card, or **Reports > Visitor ratings**   |
| Schedule a report email            | **Reports > Scheduled reports**                       |
| Erase a visitor's data             | **Privacy requests**                                  |
| See who changed something          | **Settings** app > **Audit log** (super admin)        |
| Pair screens and kiosks, set voice | **Screens** (see the screens guide)                   |

## 8. Going live checklist

Before the first day, make sure:

1. The **Company name** and **Logo** are set, and a test ticket looks right.
2. Every branch has the correct **Time zone**, desks with numbers, and a way to issue tickets (receptionist, agent walk-in issuing or a kiosk).
3. Every visit reason has a **Ticket prefix**, expected time, SLA and at least one primary agent.
4. All staff have accounts, the right role and scope, and agents have a **Default desk** and **Shift**.
5. **Distribution rules** are set and tried in **Simulate**.
6. **Daily numbering reset time**, digits and wait estimate are set.
7. **Settings** app, **Security**: password policy, 2FA for administrators, invitation validity, and the sign-up setting decided.
8. If you use scheduled reports or account emails, email is set up on the server and a test arrived.
9. Consent text and retention periods are set.
10. Screens, voice and kiosks are paired and checked (see the screens guide).
11. Backups are scheduled and the **Database backup** card is green.
12. At least two administrators exist, each with two-step verification.
