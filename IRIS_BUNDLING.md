# IRIS Bundling Guide for Starter Kit

The app now supports bundling IRIS with the distribution in three ways, with this priority:

## Priority Order

1. **Bundled Resources** (for distribution)  
   - App looks for: `<app-path>/resources/iris/bin/iris_cli.exe`
   - This is the standard distribution pattern
   - Include IRIS in the `resources/iris/` folder before packaging

2. **Environment Override** (for development)  
   - `IRIS_CLI_PATH` - full path to `iris_cli.exe`
   - `IRIS_CLI` - alias for above
   - `IRIS_HOME` - directory containing `bin/iris_cli.exe` and `models/`

3. **System Install** (fallback)  
   - Standard Windows install paths:
     - `C:\Program Files\Bath Impact Lab\IRIS\bin\iris_cli.exe`
     - `C:\Program Files (x86)\Bath Impact Lab\IRIS\bin\iris_cli.exe`
     - `%USERPROFILE%\Documents\Iris\build\bin\iris_cli.exe`

## For Distribution

### Step 1: Prepare IRIS Files

Copy IRIS runtime to the project:

```powershell
# Copy the CLI executable and DLLs
Copy-Item "C:\path\to\IRIS\build\bin\iris_cli.exe" `
  ".\resources\iris\bin\" -Force

# Copy model files (optional, can be packaged separately)
Copy-Item "C:\path\to\IRIS\build\models\*" `
  ".\resources\iris\models\" -Force -Recurse
```

### Step 2: Build the App

```bash
npm run build
npm run preview   # test the bundled app
```

The `build` config in `package.json` automatically copies `resources/iris/` into the bundled app.

## For Development

### Option A: Use Environment Variable

```powershell
$env:IRIS_CLI_PATH = "C:\path\to\IRIS\build\bin\iris_cli.exe"
npm run dev
```

### Option B: Use System Install

```powershell
# or just run if already in PATH
npm run dev
```

### Option C: Copy to resources/ (Quick Test)

```powershell
Copy-Item "C:\path\to\IRIS\build\bin\iris_cli.exe" `
  ".\resources\iris\bin\" -Force
npm run dev
```

## Error Messages

When IRIS CLI is missing, the app will show:

```
IRIS CLI not found at <path>. 
iris_cli.exe should be bundled at: <app-path>/resources/iris/bin/iris_cli.exe | 
or set IRIS_CLI_PATH environment variable | 
or install IRIS to: C:\Program Files\Bath Impact Lab\IRIS\bin
```

This guides you to the next step.

## File Structure

After setup, you should have:

```
iris-starter-kit/
├── resources/iris/
│   ├── bin/
│   │   ├── iris_cli.exe
│   │   ├── onnxruntime_providers_cuda.dll
│   │   └── ... other DLLs
│   ├── models/
│   │   ├── rtmpose.onnx
│   │   └── ...
│   └── IRIS_README.md
├── package.json
└── ... rest of app
```

The build config in `package.json` ensures `resources/iris/` is packed into the final app distribution.
