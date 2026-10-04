# Dor Agent Guide

## 1. Who this guide is for

You are an **agent**: the staff member who serves visitors at a desk, or hosts a group of visitors in a hall. Visitors take a ticket (for example `A-014`), wait, and are called to you. You do the work with the visitor and then close the visit.

In the **Agent workspace** you can:

- Set your status (Available, Busy, On break, Away, Offline) and choose your desk.
- Call the next visitor, repeat the call, start the service and complete it.
- Mark a visitor as a no-show, put a visitor on hold, or transfer a visitor to another service or another agent.
- Serve more than one visitor at the same time, if your administrator allows it.
- Take a break, using the break types your organization has defined.
- Issue a ticket for a walk-in visitor yourself, if your administrator has enabled it.
- Host a hall session and call a group of visitors into a hall, if your branch uses halls.
- See your own progress and reports on your profile page.

## 2. Before you start

### Signing in

1. Open the Dor address your administrator gave you.
2. Enter your **Email** and **Password**, then press **Sign in**.
3. If you use two-step verification, enter the 6-digit **Verification code** from your authenticator app and press **Verify**.
4. If the page asks for an **Organization code**, enter it. This is only needed when your email belongs to more than one organization.

After too many wrong attempts the account is locked for a few minutes. Wait for the time shown, then try again.

Open **Agent workspace** from the menu at the top of the page. If you also have other roles, the same menu shows their areas (for example Reception or Reports).

> **Note:** If you see the message "You are not set up to serve visitors", your account has no agent profile yet. Ask your administrator to open your user and tick "Serves visitors", then choose your branch, desk and capacity.

### Language and theme

At the top right of every page you will find:

- A **theme** button that switches between light and dark mode.
- A **language** button that shows the name of the other language. Press it to switch between Arabic and English.
- Your picture or initials, which open **My profile**.
- **Sign out**.

You can also change the interface language from **My account**.

### Password and two-step verification

Open your profile (press your name at the top), then press **Password, two-step verification and language**. This opens **My account**.

![My account page](shot:agent-account)

**To change your password**

1. In **Change password**, enter your **Current password**.
2. Enter the **New password** twice (**New password** and **Confirm new password**).
3. Press **Change password**. If the password is too weak, the page lists what is missing (length, uppercase letter, lowercase letter, number, symbol, not a common password, must not contain your email name).
4. When it works you see "Password changed. Other sessions were signed out." You will have to sign in again on your other devices.

**To turn on two-step verification**

1. Install an authenticator app on your phone, such as Microsoft Authenticator or Google Authenticator.
2. In **Two-step verification (TOTP)**, press **Enable two-step verification**.
3. Scan the code shown on screen. If you cannot scan it, type the key shown under "Or enter this key manually".
4. Enter the 6-digit code from the app. You will see "Two-step verification is now on."

To switch it off, press **Turn off** in the same card.

## 3. Know your screen

![The agent workspace](shot:agent-workspace)

The workspace has three parts.

**The status bar (top)**

- **My status** buttons: **Available**, **Busy**, **On break**, **Away**, **Offline**. The sentence next to them explains the selected status.
- **Desk**: the desk you are working at.
- **New walk-in visitor** button (only if issuing is enabled for you).
- A small connection indicator. It shows **Live** while the screen receives updates, and "Reconnecting…" or an offline message when the connection is lost.
- If your branch has halls, a **Work at** switch with **Desk** and **Hall**.

**The main card (left)**

- Before you call anyone it shows "Ready when you are".
- When a visitor is called it shows the ticket number in large type, the status, the service (visit reason), how long the visitor **Waited**, the time since they were **Called** or since service started, and the **Visitor** details: name, phone (press it to call), company, the answers collected at the desk, and notes.
- **Visit history** shows whether this is a first or a returning visit, the date of the last visit and the earlier visits with their outcome.
- The big button at the bottom is the main action. It changes with the situation: **Call next**, **Start service**, then **Complete**.
- Smaller buttons: **Recall**, **No-show**, **Hold**, **Transfer**.

**The side column (right)**

- **My queues**: for each service you handle, how many visitors are waiting and how long the oldest has waited. A service marked "backup" is one you only cover when the main agents are busy. **Served today** shows your count for the day.
- **Reserved for you**: tickets that were assigned to you by name (for example by reception).
- **On hold**: visitors you have put on hold, each with a play button to bring them back.

### Statuses at a glance

| Status        | What it means                                       |
| ------------- | --------------------------------------------------- |
| **Available** | You receive new visitors.                           |
| **Busy**      | You keep your current visitors but get no new ones. |
| **On break**  | No new visitors until you are back.                 |
| **Away**      | No new visitors until you are back.                 |
| **Offline**   | You are signed off the queue.                       |

## 4. Everyday tasks

### Start your day

1. Open **Agent workspace**.
2. In **Desk**, choose your desk if it is not already selected.
3. Press **Available**. From now on the system can assign visitors to you.

### Serve a visitor (call, start, complete)

1. Press **Call next**. The system picks the visitor who should be served next from the services you handle. The visitor's number is announced on the display screen.
2. If nobody is waiting, a message tells you why, for example "Nobody is waiting for your services." or "Set yourself available to call visitors." If you still have a visitor in progress and are at your limit, it says "Finish your current visitor first."
3. When the visitor comes to your desk, press **Start service**. The timer now counts the service time.
4. When you are finished, press **Complete**. A window opens:
   - **Outcome** (optional): **Resolved**, **Needs follow-up**, **Referred** or **Information given**. Press an outcome again to deselect it.
   - **Notes** (optional).
   - **Tags (comma separated)** (optional).
5. Press **Complete** in the window. You see "A-014 completed". For a few seconds the message has an **Undo** button in case you pressed it by mistake.

You can use the keyboard instead of the mouse: press **Enter** for the main button (call, start, then the Complete window). In the Complete window the Complete button is already selected, so **Enter** confirms it.

### Recall a visitor who did not come

When a visitor is **Called** but has not arrived:

1. Press **Recall**, or press **R** on the keyboard. The call is repeated. The ticket shows how many times it was recalled.
2. If the visitor still does not come, press **No-show**. You see "A-014 marked as no-show" with an **Undo** button for a few seconds.

**Recall** and **No-show** only appear while the visitor is in the **Called** state. Once you start the service they are replaced by **Hold** and **Transfer**.

### Put a visitor on hold and bring them back

1. Press **Hold** (for example when you must wait for a document).
2. The visitor moves to the **On hold** list on the right and you are free to call someone else.
3. When ready, press the play button next to the ticket in **On hold** to resume.

### Transfer a visitor

Use this when the visitor needs another service or a specific colleague.

1. Press **Transfer**. The window "Transfer A-014" opens.
2. Under **Another service**, choose the new service. The current one is marked "Same service".
3. Optionally, under **A specific agent**, choose a colleague who handles that service. The list shows their status.
4. Optionally write a **Note for the next agent**.
5. Press **Transfer**. The button stays disabled until you change the service or choose an agent.

### Serve several visitors at once

Your administrator sets how many visitors you may serve at the same time. If the limit is higher than one:

- A row of tabs appears above the ticket, one per visitor, each marked **Called** or **Serving**. The counter shows, for example, "2 of 3 visitors".
- Press a tab to focus on that visitor. All buttons act on the visitor in focus.
- While you are below your limit and have a visitor in focus, a **Call another visitor** button appears under the main button.
- A newly called visitor gets the focus automatically. When you complete the focused visitor, the next one takes over.

### Issue a ticket for a walk-in visitor

The **New walk-in visitor** button appears only if two things are true: your role includes the permission "Issue walk-in tickets from the agent screen", and your administrator has set **Agents can issue walk-in tickets** to "Always", or to "Only when the branch has no receptionist" (and there is none). If you do not see the button, ask your administrator.

1. Press **New walk-in visitor**.
2. Choose what to do with the ticket:
   - **Serve now**: you take the visitor yourself straight away. Only the services you handle are offered. It is disabled with "You are already serving as many visitors as you can" when you are at your limit.
   - **Add to queue**: a normal ticket, called later by the next free agent. All services of the branch are offered.
3. If shown, choose the visitor's priority and language in the bar at the top of the window.
4. Choose the service.
5. Fill in the visitor details that the form asks for, accept the consent if it is required, and issue the ticket.
6. The ticket appears on screen. For **Add to queue** you see the number, how many people are ahead, the estimated wait and, if enabled, a QR code the visitor can scan to follow their place on their phone. For **Serve now** you see "You are now serving this visitor." and the visitor appears in your workspace.
7. Press **Print** to print the ticket, **Another visitor** to issue a new one, or **Close**. If this computer has no printer, tick "This computer has no printer" and show the ticket on screen instead.

### Take a break

1. Press **On break**.
2. If your organization defined break types, a window **Break type** lists them. Choose one. If there is only one, or you have already chosen one in this session, the system may use it without asking.
3. While you are on break, a badge shows the break type and a running timer. You get no new visitors.
4. When you return, press **Available**.

Some branches limit how many colleagues can be on break at the same time. You then see "Breaks: 1 of 2 colleagues on break".

If the limit is reached when you ask:

1. You join a break line: "You are in the break line" with your number in the line.
2. When a place is free, a green banner appears: "A break place is free for you", with a countdown, a soft chime and a message. Press **Start my break** before the countdown ends.
3. If you change your mind, press **Cancel**. If the time runs out, you see "Your break place expired, ask again." and must ask again.

> **Note:** The chime plays only after you have clicked or pressed a key on the page at least once, because browsers block sound until then. Keep the workspace tab open so you do not miss it.

If your administrator has set a shift for you, a bar at the top shows its name and times. When the shift is close to ending it shows "Ends in N min". Before your shift starts, depending on your branch, you either simply receive no automatic assignments until then, or you cannot go **Available** yet.

### Host a hall session (group call)

This section appears only if your branch has halls. In a hall, several visitors enter together to one agent.

1. In the status bar press **Hall** next to **Work at**. The switch is locked ("Finish your current visitors first.") while you have visitors or an open session.
2. Under **Hall**, choose your hall. Each option shows its name, number and capacity.
3. The card shows the seats as "Seats 0 / 20" and how many visitors are waiting and can be called now.
4. Press **Call next group**. If your branch allows it, a stepper lets you choose the group size with the minus and plus buttons before you call. The system calls the group (for example "3 visitors called").
   - If there are not enough visitors, you see "Waiting for at least N visitors".
   - If the hall is full, you see "The hall is full."
5. The session starts as **Gathering**. The list **Visitors in the hall** shows each visitor with their status: **Called**, **Inside**, **Done**, **No-show** or **Released**. Press a visitor to see their details below.
6. As visitors arrive, press **Entered** next to each one, or **Mark all entered**.
7. For a visitor who does not come, press **No-show**. To send a visitor back to the queue at their original place, press **Release**.
8. If seats remain, press **Top up** to call more visitors into the same group.
9. Press **Start session** once at least one visitor is inside. The status becomes **In session**.
10. If the group is late, press **Recall group** to repeat the call.
11. When finished, press **Close session**. A window tells you how many visitors inside will be marked as served and how many who never entered will be marked no-show. Choose an **Outcome for everyone** (optional) and press **Close session**.
12. If nobody has entered yet, **Cancel session** is available. The called visitors go back to the queue at their original places. Press **Keep session** to go back.

Keyboard in a hall: **Enter** = next step, **N** = call group, **E** = all entered, **S** = start, **C** = close, **R** = recall. These also work on an Arabic keyboard on the same physical keys.

### Your profile, progress and reports

Press your name or picture at the top to open **My profile**.

![My profile](shot:agent-profile)

- The top card shows your picture, roles, **Works at**, **Member since** and **Last sign-in**. Press **Add a picture** or **Change picture** to upload a PNG, JPEG or WebP picture up to 2 MB; it is shown as a circle. **Remove** deletes it.
- **My progress** shows your figures for **Today**, **This week** or **This month**, compared with the previous period: visitors served, average service time, average wait of your visitors, share completed, no-shows, available time, time on break, and, if you host halls, hall sessions hosted and visitors received. A feedback card shows what visitors scored you, when visitor feedback is switched on. It is meant for your own reflection.
- **My reports** is for your own work only. Nobody else sees it.

![My reports](shot:agent-reports)

To read a report:

1. Under **Period**, choose **Today**, **This week**, **This month** or **Custom**. For **Custom**, set **From** and **To** and press **Show report**. The range must be valid and not too long.
2. Read the summary figures, the **Daily summary**, **By visit reason**, **When you are busiest**, **Service time**, and **Comparison** with your previous period and the branch average (a total, with no names).
3. Under **Served visitors**, filter by **Outcome** or **Visit reason** and press **Load more** for older rows.
4. Use **Download** to save the report as **CSV**, **Excel** or **PDF**, or to **Print** it.

## 5. Good practice and tips

- Set yourself **Available** only when you are at your desk. Use **Busy** when you want to finish your current visitors without receiving new ones.
- Press **Recall** once or twice before **No-show**. If you press **No-show** by mistake, use **Undo** within a few seconds.
- Complete every visit as soon as it ends. It keeps the numbers on the display and in reports correct.
- Write a short note in **Notes** when the visitor will return, so the next agent has the context. Use **Transfer** with a note instead of asking the visitor to queue again.
- Look at **Visit history** before you start: it shows earlier visits and who served them.
- Keep the workspace page open and do not use two tabs for it.
- If you leave your desk, set **On break** or **Away**; do not just walk away while **Available**.
- Never share your password. Turn on two-step verification.

## 6. Common questions and troubleshooting

| Problem                                                                       | What to do                                                                                                                                                  |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I see "You are not set up to serve visitors".                                 | Your account has no agent profile. Ask an administrator to tick "Serves visitors" on your user.                                                             |
| **Call next** is disabled.                                                    | Choose your desk first. The button is disabled while no desk is selected.                                                                                   |
| I press **Call next** and nobody comes.                                       | Read the message under the button. Either nobody is waiting for your services, or you are not **Available**, or you must finish your current visitor first. |
| The **New walk-in visitor** button is missing.                                | Ask your administrator to enable agent issuing for your branch and to give you the permission to issue walk-in tickets.                                     |
| **Serve now** is disabled.                                                    | You are at your visitor limit. Complete one visitor first, or choose **Add to queue**.                                                                      |
| I cannot go **On break**.                                                     | The limit of colleagues on break may be reached. You join the break line and are notified.                                                                  |
| I missed the break notification.                                              | The place expires. Press **On break** again.                                                                                                                |
| I cannot go **Available** before my shift.                                    | Your branch is strict about shifts. Wait for the start time shown in the message.                                                                           |
| The **Hall** switch is locked.                                                | Finish your current visitors and close the open session first.                                                                                              |
| **Start session** is disabled.                                                | At least one visitor must have entered. Press **Entered** or **Mark all entered**.                                                                          |
| The connection indicator shows "Reconnecting…" or the screen does not update. | Check your internet connection and reload the page.                                                                                                         |
| I do not hear the chime.                                                      | Click anywhere on the page once and check the volume of your computer.                                                                                      |
| I forgot my password or lost my authenticator.                                | Contact your administrator. They can reset it for you.                                                                                                      |

## 7. Quick reference

| Button or action                                                 | What it does                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Available** / **Busy** / **On break** / **Away** / **Offline** | Sets your status.                                                               |
| **Desk**                                                         | Chooses the desk you work at.                                                   |
| **Call next**                                                    | Calls the next visitor for your services.                                       |
| **Call another visitor**                                         | Calls one more visitor while you serve others (below your limit).               |
| **Start service**                                                | Starts the service for the called visitor.                                      |
| **Complete**                                                     | Finishes the visit, with optional outcome, notes and tags.                      |
| **Recall**                                                       | Repeats the call for a called visitor. Keyboard: **R**.                         |
| **No-show**                                                      | Records that the called visitor did not come (can be undone for a few seconds). |
| **Hold**                                                         | Puts the visitor on hold; resume with the play button in **On hold**.           |
| **Transfer**                                                     | Sends the visitor to another service or a specific agent.                       |
| **New walk-in visitor**                                          | Issues a walk-in ticket: **Serve now** or **Add to queue**.                     |
| **Start my break**                                               | Takes a free break place offered to you.                                        |
| **Desk** / **Hall** (Work at)                                    | Switches between desk work and hosting a hall.                                  |
| **Call next group**                                              | Calls a group of visitors to your hall. Keyboard: **N**.                        |
| **Entered** / **Mark all entered**                               | Records that visitors came into the hall. Keyboard: **E**.                      |
| **Start session**                                                | Begins the hall session. Keyboard: **S**.                                       |
| **Close session**                                                | Ends the session and records the outcome. Keyboard: **C**.                      |
| **Enter** (keyboard)                                             | The main button: call, start, complete (desk) or next step (hall).              |
| **My profile**                                                   | Your picture, progress and reports.                                             |
| **My account**                                                   | Language, password and two-step verification.                                   |
