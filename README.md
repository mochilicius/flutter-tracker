# Activity Tracker

A simple Windows app that tracks how much time you spend in different applications and helps you understand where your day goes.

_Made by someone who realized they've spent too much time doing absolutely nothing useful._

## What It Does

- **Track your time** - See how long you use each app every day
- **Organize by categories** - Group apps into "Work", "Gaming", "Social", etc.
- **Live tracking** - See what you're using right now
- **Color-coded categories** - Quick visual overview of your day
- **100% private** - All data stays on your computer, no cloud, no telemetry, none of that microslop bs!


## Quick Start

### Installer:
1. Download the latest installer from the Releases page
2. Run the installer
3. Run `Flutter.exe`
4. Start tracking your time!
   
### Portable Zip:
1. Download the latest zip file from the Releases page
2. Unzip it, run `Flutter.exe`
3. Start tracking your time!

### For Developers:

**Prerequisites:**
- Node.js (LTS)
- Python 3.12+
- Git

**Setup:**

```bash
# In the project root:
npm install
pipenv install
npm run dev

# To build, either with or without an installer:
npm run dist
npm run dist:fast
```


## How It Works

The app runs quietly in your system tray and:
- Monitors which application you're actively using
- Groups apps into categories you define
- Shows you daily summaries and insights
- Keeps all data private on your machine


## Privacy First

✅ **What we track:**
- App names and focus time
- Window titles and icons (for app identification)

❌ **What we DON'T track:**
- Keystrokes or typing
- Clipboard content
- Screenshots
- Browser history
- Anything sent to the cloud

All data is stored locally in a SQLite database on your computer.


## Project Info

**Built with:**
- Electron (desktop app)
- Angular (user interface)
- Python (tracking backend)
- SQLite (local database)

**For developers:** See `code-guide.md` for detailed technical documentation.

## Need Help?

- 📖 Check the `code-guide.md` for development setup
- 🐛 Report issues on GitHub
- 💬 Ask questions in discussions
