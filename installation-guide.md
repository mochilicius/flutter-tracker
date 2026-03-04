# Installation Guide (Windows) - Pure Python App (`pywebview`)

This version runs as a single desktop app process (Python + HTML UI), with no Electron and no local API server.

## 1) Install required apps

Run in PowerShell:

```powershell
winget install -e --id Git.Git
winget install -e --id Python.Python.3.12
winget install -e --id Microsoft.VisualStudioCode
```

Restart PowerShell, then verify:

```powershell
git --version
python --version
pip --version
```

## 2) Install Python dependencies with Pipenv

From `UI` folder (existing project structure):

```powershell
cd .\UI
python -m pip install --user pipenv
pipenv --python 3.12
pipenv install pywebview psutil pywin32 sqlalchemy
pipenv install --dev pyinstaller
```

## 3) Run the desktop app

From `UI` folder:

```powershell
pipenv run python ..\service\main.py
```

This starts:
- Native desktop window (`pywebview`)
- Local HTML UI loaded from project files
- In-process Python tracker service (no separate server)

## 4) Build executable (optional)

From `UI` folder:

```powershell
pipenv run pyinstaller --noconfirm --windowed --name ActivityTracker ..\service\main.py
```

Output executable:
- `.\dist\ActivityTracker\ActivityTracker.exe`

## 5) Notes

- If `pipenv` is not recognized, restart PowerShell.
- App data is stored locally only.
- If your UI file path changes, update the UI path in `service/main.py`.