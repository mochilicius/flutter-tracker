## Activity Tracking App - Quick Start (Windows)

### 1) Install required apps
Use PowerShell:

```powershell
winget install -e --id Git.Git
winget install -e --id Python.Python.3.12
winget install -e --id OpenJS.NodeJS.LTS
```

Verify:

```powershell
git --version
python --version
node --version
npm --version
```

### 2) First-time project setup
From project root:

```powershell
python -m pip install --user pipenv
pipenv install
npm run install:ui
```

### 3) Run in development mode
From project root:

```powershell
npm run dev
```

This starts:
- Angular UI (`UI`)
- Python API service (`service/main.py`)
- Electron desktop window

### 4) Build the UI bundle
From project root:

```powershell
npm run build
```

### 5) Build Windows `.exe` (PyInstaller)
From `UI` folder:

```powershell
cd .\UI
pipenv run pyinstaller --noconfirm --windowed --name ActivityTracker ..\service\main.py
```

Output:
- `UI\dist\ActivityTracker\ActivityTracker.exe`

### Notes
- If `pipenv` is not recognized, restart PowerShell.
- Run commands from the folder shown above.