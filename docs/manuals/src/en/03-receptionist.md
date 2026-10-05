# Dor Receptionist Guide

## Who this guide is for

You work at the reception desk. Visitors arrive, you find out why they came, and you give them a ticket with a number. Dor then puts them in the line and calls them when an agent is free. You can also print the ticket, check in a visitor who booked an appointment, and help a visitor whose ticket needs a change.

With the Receptionist role you can:

- Issue a ticket for a visit reason, with priority, language and visitor details.
- Print a ticket, or print it again later.
- Check in a visitor who has an appointment.
- See the live queue of your branch and search it.
- Edit a ticket (priority and notes), put it on hold, or cancel it.

You cannot change settings, users, visit reasons or reports. Those belong to the administrator. If a button described here is missing on your screen, your administrator has not given your role that permission.

## Before you start

### Signing in

1. Open the Dor address your administrator gave you.
2. Type your **Email** and your **Password**, then press **Sign in**.
3. If your organization uses two-step verification, type the 6-digit code from your authenticator app in **Verification code** and press **Verify**.
4. You land on the **Reception** screen.

If the email belongs to more than one organization, Dor asks for the **Organization code**. Ask your administrator for it.

After several wrong passwords your account is locked for a few minutes. Wait for the time shown on the screen, then try again.

If you have no account yet, press **Request an account** on the sign-in page. An administrator must approve the request.

### Language and theme

- At the top of every page there are two small buttons next to your name: one for the **Colour theme** (light or dark) and one for the **Language** (Arabic or English). The page changes at once.
- This is your own screen language. The language of the visitor's ticket is a separate choice, described below.

### Password and two-step verification

1. Press your name at the top of the page. This opens **My profile**.
2. Press **Password, two-step verification and language**. This opens **My account**.
3. Under **Change password**, type the **Current password**, the **New password**, and the new password again in **Confirm new password**. Press the save button.
4. Dor tells you which rules the new password must meet (for example length, a capital letter, a number). When it works, you see "Password changed. Other sessions were signed out."
5. In the same page you can turn **Two-step verification (TOTP)** on or off, and change the **Interface language**.

> **Tip:** Never share your password. Press **Sign out** (top corner) when you leave the desk, so nobody issues tickets under your name.

![My profile page, with the link to password and language](shot:receptionist-profile)

![My account page](shot:receptionist-account)

## Know your screen

The Reception screen has one purpose: to issue a ticket in as few taps as possible.

![The reception console](shot:receptionist-console)

**Top line**

- **Branch**: a drop-down, shown only if you work in more than one branch. Dor remembers your last choice on this computer.
- A **Live** / **Reconnecting…** / **Offline** badge shows if the screen is receiving updates. If it says offline, the screen shows the last known state.
- **Waiting**, **Serving** and **Agents available**: three live counters for the branch.
- **Print automatically**: a tick box. See "Printing" below.
- **Check in appointment**: opens the appointment check-in window.

**Left side**

- A bar with **Priority** buttons and **Visitor language** buttons (your administrator can hide either one).
- **Choose the visit reason**: one large button for each reason. Each button shows the reason name, its letter prefix (for example A), and how many people are waiting for it. Popular reasons come first. A small key on the corner of a button is its keyboard shortcut. A search box (**Search reasons…**) finds a reason by name or prefix.
- Below the buttons, when a reason needs details, the form opens with the **Issue ticket** button.

**Right side: Live queue**

The list of today's tickets for the branch, with tabs **Active**, **Waiting**, **Called / serving**, **Finished** and **All**, and a box **Search by number, name or phone…**. Each row shows the number, the visitor name or reason, a priority tag if any, how many are ahead, who is serving, how long the visitor has been there, and a status badge. The three-dot button on the row opens the actions menu.

![The live queue](shot:receptionist-live-queue)

## Everyday tasks

### Issue a ticket (the usual way)

1. Greet the visitor and ask why they came.
2. If the visitor needs special priority, press the matching **Priority** button first (for example for elderly or VIP visitors; the names depend on your organization). Press it again to switch it off. After each ticket, the priority goes back to normal by itself.
3. If the visitor prefers another language, press **Arabic** or **English** under **Visitor language**. This language is kept for the next tickets until you change it.
4. Press the visit reason button (or press its shortcut key).
5. Two things can happen:
   - If the reason needs nothing typed, the ticket is issued at once.
   - If it needs details, the form opens. Fill in the fields marked with a red star, then press **Issue ticket**.
6. Dor shows the new number, how many people are ahead, and the estimated wait. Tell the visitor the number or hand over the printed ticket.

If your administrator chose the "big confirmation" style, a window **Ticket issued** opens with a very large number. Press **New ticket** (or Enter) to continue. Otherwise a small green strip with the number appears at the top and disappears after a few seconds, and you can press the next reason straight away.

> **Warning:** Press **Issue ticket** only once. If the network is slow, wait. Dor protects against a duplicate when you retry, but a second visitor must get a second ticket on purpose.

### Visitor details, phone number and consent

Each reason has its own fields. The common ones are **Visitor name**, **Mobile number**, **Company**, **Email**, **Last 4 digits of ID** and **Notes**.

- Fields with a red star are required. Press **Add details (optional)** to see the others.
- A mobile number lets Dor recognize a returning visitor and show their history to the agent. If the visitor later rates the visit, the name and number you typed are shown with the rating to supervisors, so type them correctly.
- If you type any personal detail and your organization requires consent, a **Consent** tick box appears with a sentence in the visitor's language. Read it to the visitor, or let them read it. Tick it only when they agree. **Issue ticket** stays grey until it is ticked.
- If a field is missing or wrong, a red message tells you which one ("Please fill in: ...").

> **Note:** If you issue with one tap and a required detail turns out to be missing, Dor opens the form for you instead of failing.

### Choose who serves the visitor

For most reasons you do nothing: the next free agent calls the ticket. For some reasons your administrator uses manual assignment. Then the form shows **Assign to agent**. Choose an agent, or leave **Next available agent**. This list also appears for you when your role has the reassign permission.

### Calling visitors by the last digits of their phone number

If your administrator turned on **Call visitors by the last digits of their phone number** (**Settings > Tickets**), a **Visitor phone number** field appears above the visit reasons. This is for desks with no ticket printer.

1. Type the visitor's phone number in **Visitor phone number**. The line next to it shows how it will be called, for example **Will be called as 472**.
2. Choose the visit reason as usual.
3. The confirmation shows the ticket number and **Will be called by the last digits of the phone**. Tell the visitor to listen for those digits.
4. When the turn comes, the screens show **Phone ending in 472** and the voice reads the digits one by one.

> **Note:** Only the last digits are kept, not the full number. If the field is empty or too short, the ticket is not issued and the message **Type the visitor's phone number first.** appears.

> **Tip:** If another visitor in the line already has the same last digits, you get **Another visitor in the line has a phone number ending in the same digits. Ask for another number.** Ask the visitor for a different number (for example a relative's).

### Print a ticket

Tickets print on a thermal receipt printer (80 mm). The printed ticket shows:

- the logo or company name, the ticket number in large digits, and the visit reason;
- the estimated wait, as your organization worded it;
- a QR code that opens the visitor's status page on their phone (if enabled);
- a Wi-Fi name, password and QR code (if your branch offers Wi-Fi);
- a footer and the date and time.

The ticket prints in the **visitor's language**, not yours.

How printing starts:

- With **Print automatically** ticked, the print window opens after every ticket.
- With it unticked, press **Print** on the green strip or in the confirmation window.
- To print an old ticket again, open its three-dot menu in the live queue and choose **Reprint**.

**If this computer has no printer:** untick **Print automatically** (the box is also in the confirmation window). The choice is remembered on this computer only; other reception computers keep their own. Then read the number to the visitor, show it on screen, or let them scan the QR code. Your administrator sets the default for new computers.

> **Tip:** If the print window opens each time and you want it silent, ask your technician to start the browser in kiosk-printing mode.

### Check in an appointment

1. Press **Check in appointment** at the top.
2. Type the **Appointment code** the visitor shows (letters and numbers, at least 3 characters). Press **Find**.
3. If found, Dor shows the reason, the date and time, and the visitor name.
4. Press **Check in and issue ticket**. The form opens for that reason, with the appointment linked.
5. Fill in what is needed and press **Issue ticket**. In the live queue the ticket carries an **Appointment** mark.

Messages you may see: "No appointment with this code." (check the code) and "This appointment was already checked in." (a ticket already exists; search the live queue).

### Help a visitor with an existing ticket

Open the three-dot menu on the visitor's row in the live queue. The choices you can see depend on your permissions and the ticket status.

| Action                  | When to use it                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| **Reprint**             | The visitor lost the paper ticket.                                                                      |
| **Edit**                | Change the **Priority** or the **Notes** of a ticket that is still active.                              |
| **Assign**              | Send a waiting ticket to a particular agent, or press **Release to everyone** to remove the assignment. |
| **Visitor stepped out** | A waiting visitor must leave for a moment. The ticket goes on hold so it is not called.                 |
| **Visitor is back**     | The visitor returned. The ticket is waiting again.                                                      |
| **Cancel ticket**       | The visitor left or no longer needs the service.                                                        |

After **Cancel ticket**, a message "Ticket ... cancelled" appears with **Undo** for about 8 seconds. Press **Undo** if you cancelled by mistake.

To find a ticket quickly, type the number, the name or the phone in **Search by number, name or phone…**. Use the tabs to see only waiting, called or finished tickets.

> **Note:** A visitor who needs a new ticket for a different reason gets a new ticket. Cancel the old one if it is no longer needed. There is no "convert" button.

### Switch branch

If you work in more than one branch, choose the branch in the **Branch** list at the top. The reasons and the queue change to that branch.

## What the visitor sees

### The status page on the phone

When the visitor scans the QR code on the ticket, their phone opens a page with no login. It shows:

- the branch, the visit reason and the ticket number in big digits;
- **People ahead of you** and the estimated wait (only while the visitor is waiting);
- a message: "Please wait, we will call you";
- when called: "It's your turn! Please go to" and the desk name, with a colour change;
- while served: "You are being served"; at the end: "Thank you for your visit";
- if the ticket is on hold, cancelled or missed: a message asking the visitor to speak to reception.

The page updates by itself every few seconds and opens in the language chosen at reception. If your administrator has switched the page off, the visitor sees "This ticket was not found or the page is turned off." and the printed ticket has no QR code.

Dor does not send messages (WhatsApp, SMS or email) to visitors about their turn. The visitor follows the turn on this page and on the waiting-room screen, so tell the visitor to keep the page open and to watch the screen.

### Feedback

After a visit is completed, the status page can show **How was your visit?** with faces or stars from 1 to 5, an optional comment, and sometimes a recommendation question. Visitors answer once. You do not see or enter the answers at reception.

### Groups and halls

Some visits are received with a group in a hall. You issue these tickets in the same way. The visitor then sees "Please wait. You will be called together with a group to the hall." and, when called, the hall number instead of a desk. There are no special reception buttons for halls.

## The self check-in kiosk (from your side)

Your branch may have a tablet where visitors take their own ticket. You do not operate it, but you may be asked about it.

1. The visitor picks a language, then touches the service they need.
2. If the service asks for details (name, mobile number, and so on), the visitor types them on the keypad. Details the kiosk may not ask for (for example the last 4 digits of ID) make the service a staff-only one.
3. The visitor presses **Get my number**. The screen shows **Your number**, how many are ahead, and a QR code to follow the line. The ticket can also print.
4. After a few seconds the kiosk returns to the start.

A service marked "needs staff" shows **Please ask the agent**: send the visitor to your desk. If the line is full, or the connection fails, the kiosk shows a message asking the visitor to see the staff. If the kiosk shows "Self check-in is not available here", issue the ticket yourself.

The tickets issued at the kiosk appear in your live queue like any other. Pairing and settings for kiosks are done by the administrator.

## Good practice and tips

- Keep the reason buttons in front of you. Learn the shortcut keys of the busiest reasons. Press **Esc** to clear a selection.
- Choose the priority before the reason. It resets to normal after each ticket, so the next visitor is not marked by mistake.
- Ask for a mobile number every time. It helps Dor recognize a returning visitor and helps the agent.
- Say the ticket number and where to wait. Point to the display screen.
- Watch the **Waiting** and **Agents available** counters. If many wait and no agent is available, tell your supervisor.
- Search the live queue before issuing a second ticket to a visitor who says they already have one.
- Do not type secrets or unnecessary personal data in **Notes**.

## Common questions and troubleshooting

| Problem                                                              | What to do                                                                                                                   |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| The page says **Access denied**                                      | Your role does not include this page. Ask your administrator.                                                                |
| No reception area appears after sign-in                              | No role is assigned to you yet. Ask an administrator.                                                                        |
| **Offline: showing the last known state**                            | The connection dropped. Check the network. The screen updates by itself when it returns.                                     |
| **Issue ticket** is grey                                             | Tick the **Consent** box, or fill in the required fields.                                                                    |
| "The ticket numbers for today are used up for this service."         | The number range of this reason for the day is finished. Tell your administrator.                                            |
| "The line is full right now."                                        | The branch reached its waiting limit. Ask your supervisor.                                                                   |
| The print window does not open                                       | Check that **Print automatically** is ticked, or press **Print**. Check that the printer is the default one for the browser. |
| The computer has no printer                                          | Untick **Print automatically** and use the on-screen number or the QR code.                                                  |
| The QR code is not on the ticket                                     | The administrator switched it off, or the visitor page is off.                                                               |
| I issued a ticket to the wrong reason                                | Cancel it (use **Undo** if just done) and issue a new one.                                                                   |
| The visitor lost the ticket                                          | Search for them in the live queue and choose **Reprint**.                                                                    |
| "No appointment with this code."                                     | Check the code with the visitor. Letters are turned to capitals for you.                                                     |
| A reason I need is missing                                           | It may not be offered at your branch. Ask your administrator.                                                                |
| I cannot see **Check in appointment**, **Edit** or **Cancel ticket** | Your role does not have that permission. Ask your administrator.                                                             |

## Quick reference

| Button or action                              | What it does                                                     |
| --------------------------------------------- | ---------------------------------------------------------------- |
| Reason button                                 | Issues a ticket at once, or opens the form if details are needed |
| **Priority** buttons                          | Mark the next ticket as priority, until it is issued             |
| **Visitor language**                          | Language of the printed ticket and the status page               |
| **Issue ticket**                              | Creates the ticket from the form                                 |
| **New ticket**                                | Closes the confirmation window                                   |
| **Print**                                     | Prints the last ticket                                           |
| **Print automatically**                       | Prints after each ticket, on this computer                       |
| **Check in appointment**                      | Finds an appointment by its code                                 |
| **Check in and issue ticket**                 | Issues the ticket for the found appointment                      |
| **Reprint**                                   | Prints an existing ticket again                                  |
| **Edit**                                      | Changes priority or notes                                        |
| **Assign**                                    | Gives a waiting ticket to an agent                               |
| **Visitor stepped out** / **Visitor is back** | Holds or resumes a waiting ticket                                |
| **Cancel ticket**                             | Cancels a ticket; **Undo** brings it back for a few seconds      |
| **Search by number, name or phone…**          | Finds a ticket in the live queue                                 |
| **Sign out**                                  | Ends your session                                                |
