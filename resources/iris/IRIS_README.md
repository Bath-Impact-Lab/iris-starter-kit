# IRIS Runtime for Starter Kit

This directory is where the IRIS CLI executable and supporting files should be placed to bundle IRIS with the app.

## Setup

### Option 1: System Install (Development)
Set environment variables before running the app:

```powershell
$env:IRIS_CLI_PATH = "C:\Program Files\Bath Impact Lab\IRIS\bin\iris_cli.exe"
npm run dev
```

### Option 2: Bundled Install (Distribution)
Copy the IRIS runtime files to this directory:

```
resources/iris/
├── bin/
│   ├── iris_cli.exe          (copy from your IRIS build)
│   └── *.dll                  (runtime dependencies)
├── models/
│   ├── rtmpose.onnx
│   ├── yolox_s.onnx
│   └── ...
└── IRIS_README.md             (this file)
```

Then the app will automatically detect and use the bundled IRIS at startup.

## Directory Structure

- `bin/` - IRIS CLI executable and runtime DLLs
- `models/` - ONNX model files (optional, can also live beside executable)
- `resources/iris/` - becomes `app.getAppPath() + '/resources/iris'` at runtime

The app checks for `resources/iris/bin/iris_cli.exe` first, then falls back to:
1. `IRIS_CLI_PATH` environment variable
2. `IRIS_HOME` environment variable
3. Standard Windows install locations

## For Development

If you don't have a real IRIS executable, the app will show a clear error message with setup instructions.

To skip IRIS runtime checks during UI/feature development, you can mock the return value in your component tests or use a test double in the preload layer.
