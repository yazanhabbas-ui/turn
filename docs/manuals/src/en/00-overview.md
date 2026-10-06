# Dor: System overview, glossary and shared basics

Read this chapter first. It explains what Dor is, how a visit moves through the system, who does what, and the things every user does: signing in, choosing a language, protecting your account and understanding ticket statuses. After it, read the manual for your own role.

## 1. What Dor is and how a visit flows

Dor (دور) is a visitor queue system. Instead of a crowd standing in front of a counter, each visitor receives a numbered **ticket**, waits comfortably, and is called when it is their turn. The system decides which staff member serves the next visitor, shows the call on a screen and can announce it by voice.

A normal visit goes through these steps:

1. **The visitor arrives.** Some visitors have an appointment, others just walk in.
2. **A ticket is issued.** A receptionist issues it, or the visitor takes it alone from a kiosk (a self-service tablet). A visitor with an appointment is checked in by the receptionist, and the appointment becomes a ticket in the queue.
3. **The ticket waits in a queue.** Every ticket belongs to a visit reason (the service the visitor needs). The visitor can follow their place by scanning the QR code on the ticket with a phone.
4. **The distribution engine assigns it.** When an agent is free, the engine picks the next ticket for that agent using the branch rules: visit reason, priority, how long the visitor has waited and the agent's workload.
5. **The display screen and the voice call it.** The waiting-room screen shows the ticket number and the desk. If voice is enabled, it also announces the call.
6. **The agent serves the visitor.** The agent presses **Start service**, helps the visitor, then records the result.
7. **The visit is completed.** The ticket is closed. If your administrator has enabled feedback, the visitor can rate the visit on their phone.

| Step               | Who does it                             | What they do                                                   |
| ------------------ | --------------------------------------- | -------------------------------------------------------------- |
| Arrival and ticket | Receptionist, or the visitor at a kiosk | Chooses the visit reason and issues the ticket                 |
| Waiting            | The visitor                             | Waits and follows the ticket on a phone if they want           |
| Assignment         | The distribution engine                 | Chooses the next ticket for each free agent, automatically     |
| Calling            | Agent, display screen, voice            | The agent calls; the screen and voice announce                 |
| Service            | Agent                                   | Starts, serves, completes (or holds, transfers, marks no-show) |
| Follow-up          | Supervisor and administrator            | Watch the live wallboard, read reports, adjust settings        |

## 2. The roles in one page

Each person has one or more roles. A role decides which areas appear after you sign in. If you have several areas, Dor shows **Choose where to work**.

| Role                   | What the person does                                                                                                        | Where they work                      | Manual to read       |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------- |
| Receptionist           | Issues tickets for walk-in visitors, checks in appointments, edits or cancels tickets, reprints tickets                     | **Reception**                        | Receptionist manual  |
| Agent                  | Calls and serves visitors at a desk, holds, transfers, completes tickets                                                    | **Agent workspace**                  | Agent manual         |
| Supervisor             | Watches the queue live, reacts to alerts, reads reports, may reassign tickets                                               | **Live wallboard** and **Reports**   | Supervisor manual    |
| City Admin             | Runs one city or one branch: users, branches, desks, visit reasons, screens, rules, reports. Has no **Settings** app        | **Administration**                   | Administrator manual |
| Super Admin            | Everything a City Admin does, for all cities, plus cities and roles in **Administration** and the **Settings** app (branding, security and all other settings) | **Administration** and **Settings**  | Administrator manual |
| Screen and kiosk setup | An administrator pairs the waiting-room screens and kiosks with a pairing code                                              | **Administration**, then **Screens** | Administrator manual |

Good to know:

- Receptionist, Agent, City Admin and Super Admin are the built-in roles. The supervisor is usually a custom role that your administrator builds from permissions, so its exact abilities can differ between organizations.
- **Settings** is a separate app in the top bar, next to **Administration**. Only super admins see it. If you are a city admin and a setting needs changing, ask a super admin.
- A role can apply to the whole organization, to one city or to one branch.
- If you see **Access denied**, your role does not include that page. Ask an administrator.
- If you see "Your account has no workspace assigned yet", you have no role yet. Ask an administrator to give you one.

## 3. Shared basics

### Signing in

![The sign-in page](shot:overview-sign-in)

1. Open the Dor address your administrator gave you.
2. Type your **Email** and **Password**, then press **Sign in**.
3. If your email belongs to more than one organization, a new field **Organization code** appears. Enter the code and press **Sign in** again.
4. If two-step verification is on, enter the 6-digit **Verification code** and press **Verify**.

After too many wrong passwords your account is locked for a while (by default 5 attempts and 15 minutes). Wait, then try again. Sessions end automatically after some hours (12 by default), so you may need to sign in again. To leave, use **Sign out**.

### Language, light and dark theme

- Dor works in Arabic and English. Use the language button (it shows the other language) in the header. When you are signed in, your choice is saved on your profile. You can also change it on the **My account** page under **Interface language**.
- The staff screens have a light/dark switch (**Switch to dark mode** / **Switch to light mode**). The first time, it follows your device setting. The dark mode takes a tint from your organization's brand colour.

### Help icons: the (?) next to a field or figure

Wherever a field, setting or figure needs an explanation, you see a small **(?)** icon next to its name instead of a paragraph of text. Hover over it with the mouse, move to it with the Tab key, or tap it on a phone, and the explanation appears. This is used across the administration pages, the settings, the reports and the profile pages. If another manual says to read the explanation of a field, this is where to find it.

### Using Dor on a phone

The header (the menu with your workspaces, the language button and **Sign out**) shrinks to icons on a small screen and scrolls when needed. The tabs on the reports page scroll sideways, and long lists such as visitor ratings turn into cards.

### Install Dor as an app (PWA)

Dor can be installed like an app on a PC, tablet or phone, with its own window and icon.

1. Open Dor in Chrome or Edge (on a phone, Chrome or Safari).
2. Use the browser's install option: the install icon in the address bar on a PC, or **Add to Home screen** / **Install app** in the browser menu on a phone.
3. Open Dor from the new icon.

The app name and colour follow your organization's branding. Installing does not make Dor work offline: it always needs the network, and only shows the last page shell for a short outage.

### My account: password and two-step verification

![My account page](shot:overview-account)

Open **My profile** from the header, then follow the link **Password, two-step verification and language** to reach **My account**.

**Change your password**

1. In **Change password**, enter the **Current password**.
2. Enter the **New password** and **Confirm new password**.
3. Save. Your other sessions are signed out.

A new password must follow the rules shown on screen. By default it needs at least 10 characters, an uppercase letter, a lowercase letter and a number, must not be a common password and must not contain the first part of your email. Your administrator can change these rules.

**Turn on two-step verification**

1. Install an authenticator app such as Microsoft Authenticator or Google Authenticator.
2. In **Two-step verification (TOTP)**, press **Enable two-step verification**.
3. Scan the QR code with the app. If you cannot scan, type the key shown under **Or enter this key manually**.
4. Enter the 6-digit code from the app and press **Verify**.

From then on, every sign-in asks for a code. To turn it off, enter your current password and press **Turn off**. Your administrator may require two-step verification for some roles. If you lose your phone, ask an administrator to use **Reset 2FA** on your user.

### Forgot your password

Dor has no "forgot password" button on the sign-in page. Ask your administrator to open your user in **Administration**, then **Users**, and press **Reset password**. You are signed out everywhere and receive a single-use link, valid for 24 hours. If the administrator ticks **Also send by email**, the link arrives in your inbox; otherwise they pass it to you. Open the link, choose a new password and press **Save password**. If the link says it is invalid, already used or expired, ask for a new one.

### Getting an account

There are two ways.

**Accept an invitation.** An administrator invites you from **Users** and gives you a link (the administrator copies the link and sends it to you). The page says "Join" followed by your organization and the role you were invited as. Enter your name and a password, confirm it and press **Create my account**. An invitation link expires (after 72 hours by default) and works once. If it fails, ask for a new link.

**Request an account yourself.**

![The Request an account page](shot:overview-signup)

1. On the sign-in page, press **Request an account**. This link appears only if your administrator allows requests.
2. Enter **Your name**, **Email**, optional **Phone**, and a password twice.
3. Press **Send request**.
4. An administrator reviews the request, chooses your role and branch, and approves it. You can then sign in with the password you chose.

If you see "Account requests are not open", ask your administrator for an invitation.

## 4. Ticket statuses

A ticket is always in exactly one status. The status shows in the reception queue, the agent workspace, the wallboard and reports.

| Status          | Meaning                                                     | What can happen next                                          |
| --------------- | ----------------------------------------------------------- | ------------------------------------------------------------- |
| **Appointment** | The visitor has booked, but has not arrived and checked in  | Checked in (becomes Waiting) or cancelled                     |
| **Waiting**     | The ticket is in the queue for an agent                     | Called, put on hold, transferred, cancelled                   |
| **Called**      | An agent called the visitor and the screen shows the number | Service started, recalled, no-show, hold, transfer, cancelled |
| **Serving**     | The agent is serving the visitor now                        | Completed, put on hold, transferred                           |
| **On hold**     | Paused, for example the visitor stepped out                 | Resumed (back to Waiting), transferred, cancelled             |
| **Completed**   | The visit is finished                                       | Final. Can be undone for a short time after a mistake         |
| **No-show**     | The visitor was called but did not come                     | Final, unless sent back to the queue                          |
| **Cancelled**   | The ticket was cancelled                                    | Final. Can be undone for a short time after a mistake         |

Notes:

- Called and Serving tickets count towards an agent's limit of tickets at one time.
- Transfer is an action, not a status: the ticket goes back to Waiting in another service or for another agent.
- Depending on the branch policy, a no-show is either closed or sent to the end of the queue. An accidental no-show, completion or cancellation can be undone within the undo window set by your administrator (in seconds).

## 5. Glossary

| Term                 | Meaning                                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Ticket               | A numbered record of one visit, such as `A-014`. The letter (the prefix) belongs to the visit reason, and the number restarts each service day |
| Queue                | The tickets waiting for the same service in a branch                                                                                           |
| Visit reason         | The service the visitor needs, such as "Account opening". It decides the queue and which agents can serve it                                   |
| Desk                 | The counter or window where an agent serves. The screen announces the desk number                                                              |
| Hall / group session | A room with a fixed capacity where one host receives several visitors together. Halls are off unless the branch enables them                   |
| Branch               | One physical location with its own desks, agents, screens and settings                                                                         |
| City                 | A group of branches. A City Admin manages the branches of their city                                                                           |
| Priority             | A level that lets some tickets be called before others. Receptionists choose it when issuing a ticket, if priorities are set up                |
| No-show              | A visitor who was called but did not arrive                                                                                                    |
| Transfer             | Sending a ticket to another service or to a specific agent, with an optional note                                                              |
| Hold                 | Pausing a ticket without losing the visitor's place in history. It is resumed later                                                            |
| Walk-in              | A visitor without an appointment                                                                                                               |
| Appointment          | A booked visit. The visitor gives an appointment code, and the receptionist uses **Check in appointment**                                      |
| Display screen       | The waiting-room screen that shows the current calls. It is paired with a code and needs no sign-in                                            |
| Kiosk                | A self-service tablet where visitors choose a service and get a ticket                                                                         |
| Wallboard            | The live operations screen for supervisors: waiting counts, agent states, long waits and alerts                                                |
| CSAT                 | Customer satisfaction: the 1 to 5 rating a visitor can give after the visit                                                                    |

## 6. Frequently asked questions

**Who can see my tickets and reports?** Only people whose role allows it, and only for the branches or cities their role covers. Administrators can see more than agents.

**Why do I not see a menu or page that my colleague sees?** Your roles are different. You only see the areas your roles allow. Ask an administrator if you need another one.

**Can I use Dor in Arabic and English at the same time?** Each person uses one interface language at a time, and you can switch whenever you like. Visitor-facing text, such as the status page and the voice, follows the visitor's ticket language and the organization's voice settings.

**What does the ticket number mean?** It is the visit reason's letter, a separator and a number, such as `A-014`. Numbers start again at the start of each service day (at 03:00 by default, set by the administrator).

**How does a visitor follow their turn?** By scanning the QR code on the ticket (printed or on the reception or kiosk screen). The page shows people ahead and the estimated wait, and updates by itself.

**Does the visitor get messages?** No. Dor does not send messages to visitors about their turn. The visitor follows the turn on the status page opened from the QR code, which updates by itself, and hears or sees the call on the waiting-room screen.

**A visitor was called but is not here. What now?** The agent can recall them and finally mark **No-show**. If it was a mistake, use Undo quickly, or ask reception to send the ticket back to the queue.

**An agent steps away. Do they lose tickets?** An agent who is **Busy** keeps current visitors but gets no new ones. **On break**, **Away** and **Offline** also stop new visitors.

**I was signed out suddenly. Why?** Sessions end after a set time, and changing or resetting a password signs out the other sessions. Sign in again.

**My account is locked.** Too many wrong passwords. The message tells you how many minutes to wait. An administrator can also help.

**I lost my phone with the authenticator.** Ask an administrator to **Reset 2FA** on your user, then set it up again.

**The screen does not announce the call.** Browsers block sound until the screen is touched once. Touch the screen when it shows "Touch the screen to enable sound", and check that sound is on. If it persists, tell your administrator.

**Do I need to install anything?** No. Dor runs in the browser. Installing it as an app is optional and only gives you its own window.

**Who do I ask for a new account, role or branch change?** Your administrator.

## 7. Getting help

1. Check the section for your role in its manual, especially the troubleshooting table.
2. Ask your supervisor or colleague at the same branch.
3. Contact your administrator for accounts, passwords, roles, desks, screens and settings. Give them the screen name, what you pressed and the message you saw, and the ticket number if there is one.
4. If a page says **Something went wrong**, press **Reload page** first. This often fixes it after an application update.
5. The manuals are also in the **Help center**, opened with the book icon in the top bar. A super admin can hide the Help center for everyone (**Settings** app, **Help center**). When it is hidden, the icon and the page are gone and the manuals cannot be opened, so ask your administrator for the manual.
