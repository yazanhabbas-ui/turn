# Screen setup guide

## 1. Who this guide is for

This guide is for the person who installs and looks after the screens of Dor (دور): the waiting-room display screens that show which number is called, the self check-in kiosks where visitors take their own ticket, the live wallboard for supervisors, and the voice that announces each call. This is usually an administrator or a technician.

With this guide you can:

- Add a waiting-room screen, pair it with a TV or PC and choose how it looks.
- Add a self check-in kiosk and pair a tablet with it.
- Show news lines and slides on the screens.
- Choose the announcement voice, test it and fine-tune how a call is spoken.
- Set up the wallboard.
- Find and fix common problems (no sound, a screen asking for a pairing code again).

## 2. Before you start

- Sign in with your own account. You need the permission to manage screens. Without it, the Screens page shows "no access".
- The **Announcements** tab appears only if you may manage announcements. The **Voice** tab appears only if you may manage settings or templates. If a tab is missing, ask your administrator.
- You can use Dor in Arabic or English, and in a light or dark theme. Use the language and theme controls of the application. This does not change what the waiting-room screens show: each screen has its own languages and look.
- The screens and kiosks themselves need no sign-in. They are paired with a code (section 4).
- Make sure the TV or PC has a modern browser (Chrome or Edge is recommended), a network connection to the Dor server, and speakers if you want the voice.

## 3. Know your screen

Open **Admin → Screens** (**الإدارة ← الشاشات**). The page is called **Screens & voice** and has up to three tabs.

![The Screens page with its tabs and the list of screens](shot:screens-list)

### The Screens tab

- **Add kiosk** and **Add screen** buttons at the top.
- One row per screen with its name, a **Kiosk** badge if it is a kiosk, **Online** or **Offline**, and **Paired**, **Not paired** or **Revoked**. Below the name you see the branch, the layout (or "Self check-in kiosk") and **Last seen**.
- Row buttons: **Edit**, **New pairing code**, **Open kiosk page** (kiosks only), **Revoke** (paired screens only) and **Delete**.
- The list refreshes by itself every 15 seconds. "Online" means the screen has contacted the server very recently.

### The Announcements tab

Lines for the news ticker and slides that appear on the screens (section 4.9).

### The Voice tab

Three parts, one under another:

1. **Voice settings**: what is announced, how many times, timing, sound, and a test area.
2. **Spoken phrases**: the sentence used by the browser voice.
3. **Audio packs**: pre-recorded voices.

### What a screen looks like

A waiting-room screen is a full-screen page. It has a header with the clock and date, the call area (the latest call as large numbers, with the desk), a list of recent calls or desks, the waiting counts, rotating slides and a ticker line at the bottom. A small badge shows the connection state (**Connected**, **Reconnecting…**, **No network connection**) and whether sound is on.

> **Note:** If the administrator turned on **Call visitors by the last digits of their phone number**, the screen shows **Phone ending in 472** (the last digits typed by reception) instead of the ticket number, and the voice reads those digits one by one. The recorded packs have no clips for that sentence, so the sentence voice or the browser voice speaks it.

## 4. Everyday tasks

### 4.1 Add a waiting-room screen and pair it

1. Open **Admin → Screens** and click **Add screen**.
2. Type a **Name** (for example "Main hall TV") and choose the **Branch**.
3. Choose the **Layout**:
   - **Classic**: the latest call large, recent calls in a list beside it.
   - **Single**: only the current call, as large as possible.
   - **Multi-desk**: a grid with the current ticket of every desk.
4. Choose the **Look of the screen**: **Use the default**, **Dark**, **Light** or **Brand colour**. "Use the default" follows the default look set in **Settings → Branding** (the **Settings** app, super admin).
5. Click **Save**. A window opens with a large **Pairing code** and the address of the screen.
6. On the TV or PC, open the browser and go to the address shown (it ends with `/display`). Type the code and press **Pair**. You can also open the address with the code added, for example `/display?code=ABC123`, which pairs without typing. This is handy when you set up a TV remotely.
7. The screen loads and starts showing the queue. On the Screens tab its badges change to **Online** and **Paired**.

> **Note:** The code is valid for 15 minutes and can be used once. If it expires, click **New pairing code** on the screen's row to get another one.

> **Note:** If someone enters a wrong code many times, the screen shows "Too many attempts, wait a minute and try again". Wait a minute.

### 4.2 Set what a screen shows

After the first save, click **Edit** on the screen. More options now appear.

**Content**

- **Arabic** and **English**: the languages shown. If you choose both, the screen switches between them. At least one language must stay selected.
- **Rotate every (seconds)**: how often the language and slides change (2 to 120; the default is 15).
- **Desk zones**: type zone names separated by commas to show only the desks and halls of those zones. Leave it empty to show all desks. Zones are the labels set on desks and halls.
- Tick or untick: **News ticker**, **Slides**, **Waiting list**, **Clock** and **Hall occupancy (3 / 8)**.

**Voice on this screen**

Leave these on **Inherit** to follow the general voice settings (section 4.6). Set a value only when this screen must be different, for example quieter:

- **Voice**: **Inherit**, **On** or **Off**.
- **Volume**, **Speech rate** (0.5 to 1.5), **Language of the call** and **Repeat (times)** (1 to 5).

Click **Save**. The screen updates by itself.

### 4.3 Prepare the TV or PC browser

Do this once for each screen device.

1. Open the display address and pair the screen.
2. Go full screen: press **F**, double-click the page, or click the corner button (**Fullscreen**). Press **F** again to leave full screen.
3. Sound: browsers block sound until someone touches the page. If the voice is on, the screen shows **Touch the screen to enable sound**. Touch the screen or press any key once. The badge then shows **Sound on**.
4. To avoid the touch after every restart, start the browser in kiosk mode with sound allowed. For Chrome, the start command has these options: `--kiosk --autoplay-policy=no-user-gesture-required`. Ask your IT team to set this as the startup of the device.
5. The screen asks the device to stay awake, so it does not go dark. Also turn off sleep and screen saver in the operating system.
6. Check the volume of the TV or speakers, and test with section 4.6.

> **Tip:** The screen remembers its pairing in the browser. Do not clear the browser's site data on that device, and do not use a private window, or the screen will ask for a code again.

> **Tip:** The mouse pointer hides itself after a few seconds without movement.

If the network drops, the screen keeps showing the last known state, shows **Reconnecting…**, and returns to normal by itself.

### 4.4 Replace a TV, re-pair or revoke a screen

- **New pairing code**: use it for a replacement device or a screen that lost its pairing. Enter the new code on the device. The old device stops working at once.
- **Revoke**: click **Revoke** and confirm **Revoke this screen?**. The screen stops working and returns to the pairing page until it is paired again with a new code. Use this for a lost or stolen device.
- **Delete**: removes the screen from the list for good (the device is also disconnected).

### 4.5 Add a self check-in kiosk

A kiosk is a tablet where visitors take their own ticket. It is paired like a screen.

1. First, a super admin opens the **Settings** app (top bar) and goes to **Self check-in** and switches on **Self check-in is on**. Until it is on, a paired kiosk only shows "Self check-in is not available here. Please ask the staff to give you a ticket."
2. In the same tab you can also set: **Print the ticket**, **Show the estimated wait**, **Show a QR code to follow the ticket**, **Seconds before returning to the start**, **Most visitors waiting in the branch** (0 = no limit), **Tickets per minute per kiosk**, **Services offered** and **Welcome text on the kiosk**. A service that needs a staff member is shown on the kiosk as "Please ask the agent".
3. Go to **Admin → Screens** and click **Add kiosk**.
4. Type a **Name** and choose the **Branch**. Choose the **Languages**: **Arabic, then English**, **English, then Arabic**, **Arabic only** or **English only**. The first language is shown at the start and the visitor can switch. Choose the look (**Follow the screen theme**, **Dark**, **Light** or **Brand**).
5. Click **Save**. A pairing code appears.
6. On the tablet, open the address shown (it ends with `/kiosk`), type the code and press **Pair**.
7. Use **Open kiosk page** on the kiosk's row to see the kiosk page in a new tab.

What the visitor does on the kiosk: chooses a service, optionally types details (such as a name or mobile number, using the on-screen keypad), taps **Get my number**, and sees **Your number**, how many are ahead, the wait if enabled, and a QR code. After a few seconds the kiosk returns to the start. A visitor who already has a waiting ticket is shown that ticket again instead of a new one. If the line is full, the kiosk asks the visitor to see the staff.

For silent printing, start the kiosk browser with `--kiosk-printing`. Without it, the browser's print window opens.

Revoking, re-pairing and deleting a kiosk work like a screen.

> **Note:** The kiosk wears your organization's identity: the welcome band uses your **primary colour** and brand glow, your logo sits on a white plate so it reads with any colour, and the ticket shown to the visitor carries the same band. The text colour switches between white and near-black to stay readable on pale colours. The kiosk's **Theme** (dark, light, brand) decides the background below the band, as on the waiting-room screens.

### 4.6 Choose and test the announcement voice

![The Voice tab of the Screens page](shot:screens-voice)

Open the **Voice** tab.

**Step 1: choose who speaks Arabic.** In **Arabic announcement voice**:

- **Browser voice (the screen device)**: uses the voice installed on the TV or PC. It does not work if the device has no Arabic voice. Most PCs have none.
- Recorded voices: each card shows the voice name and its number of clips. Click **Preview** to hear a sample (number B 14 to desk 3), then **Use this voice**. The card then shows **In use**. The change reaches every paired screen at once.
- If the list is empty, click **Add the bundled voices**. The bundled voices are recorded in advance and work without internet.

**Step 2: choose the voice source.** In the **Sound** card, **Voice source** has three choices:

| Choice                              | What it does                                                                                                                               | Needs                                                                                                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Browser voice**                   | The device speaks with its own voice.                                                                                                      | An installed voice for the language on each screen device.                                                                                                                                                                 |
| **Pre-recorded audio pack**         | Plays recorded clips for "number", the letter, the number and "please go to the desk". Works on any PC.                                    | Nothing online.                                                                                                                                                                                                            |
| **Natural sentence voice (online)** | Reads the whole Arabic call as one natural sentence with the neural voice that belongs to the voice you chose. It sounds the most natural. | The Dor server needs internet the first time each sentence is spoken (it takes a few seconds), then keeps it and plays it instantly. If the server cannot reach the internet, the recorded voice takes over automatically. |

> **Note:** The recorded and online Arabic voices are mainly meant for evaluation. Ask your supplier whether your licence allows using them in production.

**Step 3: what is announced.** In **What is announced**:

- **Speak ticket calls**: turns the voice on or off for all screens.
- **Language of the call**: **Arabic only**, **English only**, **The visitor's language** (the language chosen at reception), **Arabic, then English** or **English, then Arabic**.
- **Ticket reading**: **Letter, then number**, **Number only** or **Digit by digit**. The list shows an example for ticket B-014. Real Arabic numbers are used, so 14 is read as one number.
- **Announce the desk**: adds the desk to the call.

**Step 4: repeats.** In **How many times**: **Repeat (times)** (1 to 5, default 2) and **Pause between repeats** (default 4 seconds).

**Step 5: timing** (affects recorded voices). In **Timing** you can change the pause between "number" and the ticket, between the letter and the number, before the desk part, between the chime and the voice, and the overlap inside a number. If a call sounds unnatural, click **Reset to natural defaults**.

**Step 6: sound.** In **Sound**: **Volume**, **Speed of the recorded voice** (keep it close to 1.00), **Speed of the browser voice** (default 0.90), **Play a chime before the call**, **Chime volume**, and optional **Preferred voice names** for the browser voice (the start of an installed voice name for each language).

**Step 7: test.** In **Test the announcement**, type a **Ticket number** and a **Desk**, then click **Play in Arabic**, **Play in English** or **Play as configured**. The test uses the values on the page even before you save them, and shows **Exactly what is spoken**. Press once to allow sound in this browser. Click **Stop** to stop.

**Step 8: save.** Click **Save** at the bottom. While there are changes not saved, the page shows **Unsaved changes**. Choosing a voice with **Use this voice** is saved at once.

> **Tip:** Test on the real screen too. Open the screen's address on the TV, call a test ticket from an agent workspace, and listen from the waiting area.

### 4.7 Edit the spoken phrases (browser voice)

The **Spoken phrases** part is the sentence the browser voice says, one for Arabic and one for English.

1. Edit the text. Click a placeholder (`{ticket}`, `{desk}`, `{agent}`, `{reason}`) to insert it where the cursor is.
2. Read the **Preview** line. Click **Test voice** to hear it with a voice installed on your computer.
3. Click **Save**.

Recorded Arabic voices and the online voice use their own fixed wording ("number", the ticket, "please go to the desk", the desk). If you switch off **Announce the desk** with the browser voice, write the desk part as its own clause after a comma, so it can be left out.

### 4.8 Audio packs

**Audio packs** lists the recorded voice sets. Most people only need **Add the bundled voices** from section 4.6. To add your own recordings:

1. Click **Add audio pack**.
2. Type a **Name** and choose the **Language**.
3. In **Clips (JSON)**, list each clip key and its audio file, for example `"ar.phrase.number": "/audio/ar/number.mp3"`. Values start with `/` or `data:audio/`. The page tells you if the JSON is not valid.
4. Keep **Active** ticked and click **Save**.

Clip keys: `ar.phrase.number`, `ar.phrase.desk`, `ar.num.0` to `ar.num.999`, or only `ar.digit.0` to `ar.digit.9`, `ar.word.thousand` and `ar.letter.A` to `ar.letter.Z` (use the `en.` prefix for English). Missing numbers are built from smaller ones. Use the pencil to edit a pack and the bin to delete it.

### 4.9 News ticker and slides

If you may manage announcements, open the **Announcements** tab.

1. Click **Add announcement**.
2. Choose the **Type**: **Ticker line** (text scrolling at the bottom) or **Slide** (a full panel with text and an **Image**).
3. Type the **Text** in Arabic and English. For a slide, you can upload an image up to 1.5 MB, and set **Slide duration (seconds)**.
4. Optionally set **Starts at** and **Ends at**. Without dates, it shows **Always shown**.
5. Save. A screen shows ticker lines and slides only if **News ticker** and **Slides** are ticked on that screen (section 4.2).

### 4.10 Group calls to a hall

If your organization uses halls, where one agent receives several visitors together, the screen shows the call as one card: "Hall 2" with every ticket number called. The voice reads the hall and the numbers. How the numbers are read is set in **Settings → Halls → How a group is announced** (the **Settings** app, super admin): **Read every number**, **Read as a range** or **Name the hall only**. Call languages, repeats and pauses follow the voice settings above. **Hall occupancy (3 / 8)** on a screen shows how many visitors are in the hall.

### 4.11 The live wallboard

The wallboard is a live operations page for supervisors. Open **Live wallboard** (**لوحة المتابعة المباشرة**) from the area menu. It needs the wallboard permission.

![The live wallboard](shot:screens-wallboard)

- Choose the **Branch** at the top. The page shows tiles (waiting, longest wait, agents available, busy, on break, served today, no-shows, and others), the desks with their current ticket, the halls, the waiting by reason, long waits and **Alerts**.
- Press **F** or use the **Fullscreen** button to fill a TV. Use the sun or moon button to switch to light or dark.
- The page updates by itself and shows **Updated … s ago**. If it cannot load, it shows "Could not load live data. Retrying...".
- Supervisors who may manage alerts see an **Acknowledge** button on each alert.
- The look is set in **Settings → Wallboard** (the **Settings** app, super admin): **Look** (**Dark**, **Light** or dark tinted with the brand colour), **Text size (%)**, **Wallboard title (optional)**, and whether to show the logo, company name, branch name, clock and date, and today's visitor satisfaction.
- The wallboard shows ticket numbers and counts only, never visitor details.

## 5. Good practice and tips

- Give each screen a clear name that tells where it is ("Main hall TV", "Floor 2 corridor") so you can find it in the list.
- Use **Multi-desk** on a wide TV for many desks, **Single** when visitors stand far away, and **Classic** as a safe default.
- Keep **Arabic, then English** for mixed audiences, and set **Language of the call** to **Arabic only** if most visitors speak Arabic.
- Use desk zones when one branch has several waiting areas, each with its own screen.
- Always test sound after changing the voice, the repeat or the volume.
- Check **Last seen** and the **Online** badge from time to time. A screen that shows **Offline** needs attention.
- Keep screens and kiosks on a stable network connection. Use a wired connection when you can.
- Revoke any device that is lost, sold or moved to another site.

## 6. Common questions and troubleshooting

| Problem                                                                 | What to do                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| There is no sound on the screen.                                        | Check that **Speak ticket calls** is on and that the screen's own **Voice** is not set to **Off**. Touch the screen once if it shows **Touch the screen to enable sound**. Check the TV volume and the volume setting. Start the browser with the autoplay option (section 4.3). |
| The screen says "Touch the screen to enable sound" after every restart. | The browser blocks sound until a touch. Start Chrome with `--autoplay-policy=no-user-gesture-required`, or touch the screen after a restart.                                                                                                                                     |
| The call is silent in Arabic but works in English.                      | The device has no Arabic voice. Under **Arabic announcement voice**, choose a recorded voice and click **Use this voice**.                                                                                                                                                       |
| The page says "This device has no voice for that language".             | Choose a recorded voice, or the online voice, or install a voice on the device.                                                                                                                                                                                                  |
| The voice is the wrong one or has the wrong accent.                     | Choose another voice in **Arabic announcement voice** and press **Preview**. With the browser voice, set **Preferred voice names**.                                                                                                                                              |
| The voice sounds like separate words.                                   | Try **Natural sentence voice (online)**. Or use **Reset to natural defaults** under **Timing**.                                                                                                                                                                                  |
| The online voice is silent or slow the first time.                      | The server needs internet the first time each sentence is spoken. Check the server's internet access. Until then the recorded voice is used.                                                                                                                                     |
| The voice is too fast or too slow.                                      | Change **Speed of the recorded voice** (recorded) or **Speed of the browser voice** (browser). On one screen, set its own **Speech rate**.                                                                                                                                       |
| The call is repeated too many or too few times.                         | Change **Repeat (times)** in the general settings, or on the screen's own settings.                                                                                                                                                                                              |
| The number is read digit by digit.                                      | Set **Ticket reading** to **Letter, then number** or **Number only**.                                                                                                                                                                                                            |
| The screen shows the pairing page again.                                | The pairing was removed. Common reasons: the screen was revoked, deleted or given a new code, or the browser's site data was cleared. Click **New pairing code** and pair again. Do not use a private window.                                                                    |
| "The code is wrong or has expired".                                     | Codes last 15 minutes and work once. Click **New pairing code** and enter the new code.                                                                                                                                                                                          |
| "Too many attempts, wait a minute and try again".                       | Wait a minute and enter the code again carefully.                                                                                                                                                                                                                                |
| The badge shows **Offline** or **Reconnecting…**.                       | Check the network and the address. The screen keeps showing the last state and recovers by itself.                                                                                                                                                                               |
| The screen shows a different language or too many desks.                | Edit the screen: set **Arabic** and **English**, and **Desk zones**.                                                                                                                                                                                                             |
| No ticker or slides on the screen.                                      | Tick **News ticker** and **Slides** on that screen, and make sure the announcement is active and inside its dates.                                                                                                                                                               |
| The kiosk says "Self check-in is not available here".                   | A super admin switches on **Self check-in is on** in the **Settings** app, under **Self check-in**.                                                                                                                                                                                                               |
| The kiosk says "We cannot reach the system".                            | Check the tablet's connection. The kiosk will not issue tickets without a connection.                                                                                                                                                                                            |
| The kiosk says "The line is full right now".                            | The **Most visitors waiting in the branch** limit was reached. Raise it (0 = no limit) or serve the queue.                                                                                                                                                                       |
| A service on the kiosk says "Please ask the agent".                     | That service needs a staff member (for example it requires details a visitor may not type). Change this in the visit reason.                                                                                                                                                     |
| The screen goes dark.                                                   | Turn off sleep and screen saver in the operating system, and keep the screen in full screen.                                                                                                                                                                                     |
| I do not see the Voice or Announcements tab.                            | Your account does not have the needed permission. Ask your administrator.                                                                                                                                                                                                        |

## 7. Quick reference

| Action                        | Where                            | What it does                                                                |
| ----------------------------- | -------------------------------- | --------------------------------------------------------------------------- |
| **Add screen**                | Admin → Screens → Screens        | Creates a waiting-room screen and shows a pairing code.                     |
| **Add kiosk**                 | Admin → Screens → Screens        | Creates a self check-in kiosk and shows a pairing code.                     |
| **New pairing code**          | Row of a screen                  | A fresh 15-minute, single-use code.                                         |
| **Revoke**                    | Row of a screen                  | Disconnects the device until it is paired again.                            |
| **Delete**                    | Row of a screen                  | Removes the screen.                                                         |
| **Open kiosk page**           | Row of a kiosk                   | Opens the kiosk page in a new tab.                                          |
| **F** / double-click          | On a screen                      | Full screen on or off.                                                      |
| Layout                        | Edit screen                      | **Classic**, **Single** or **Multi-desk**.                                  |
| Look                          | Edit screen                      | **Use the default**, **Dark**, **Light**, **Brand colour**.                 |
| **Desk zones**                | Edit screen                      | Show only desks and halls of the listed zones.                              |
| **Voice** (per screen)        | Edit screen                      | **Inherit**, **On** or **Off**, with own volume, rate, language and repeat. |
| **Use this voice**            | Voice tab                        | Chooses the Arabic voice for all screens.                                   |
| **Voice source**              | Voice tab                        | Browser voice, recorded pack or online sentence voice.                      |
| **Play as configured**        | Voice tab                        | Tests the call with the values on the page.                                 |
| **Reset to natural defaults** | Voice tab                        | Restores the timing defaults.                                               |
| **Add audio pack**            | Voice tab                        | Adds your own recorded clips.                                               |
| **Add announcement**          | Announcements tab                | Adds a ticker line or a slide.                                              |
| Self check-in settings        | Settings app → Self check-in     | Turns the kiosk on and sets its limits and wording.                         |
| Wallboard look                | Settings app → Wallboard         | Look, text size, title and what is shown.                                   |
