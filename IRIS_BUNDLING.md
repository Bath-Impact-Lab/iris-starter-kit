# IRIS Bundling Guide for Starter Kit

The app resolves `iris_cli.exe` in this priority order (see
`electron/iris/resolveIrisExecutable.ts`):

## Priority Order

1. **Explicit override** (highest priority)
   - `IRIS_CLI_PATH` - full path to `iris_cli.exe`
   - `IRIS_CLI` - alias for above

2. **`IRIS_HOME`** - directory containing `bin/iris_cli.exe` and `models/`
   - `IRIS_HOME` env var, or
   - `IRIS_HOME` registry value: `HKCU\Environment` is checked *before*
     `HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment`,
     so a per-user value always wins over a machine-wide one. This is set
     automatically for you by the official installer (see below). If
     you've ever set a personal `IRIS_HOME` (e.g. for local IRIS-core
     development), it will silently shadow the installer's entry, so check
     `[Environment]::GetEnvironmentVariable('IRIS_HOME','User')` if the
     app seems to be running an unexpected IRIS build after installing or
     updating.

3. **Bundled resources** (for distribution)
   - App looks for: `<app-path>/resources/iris/bin/iris_cli.exe`
   - Only reached if `IRIS_HOME` isn't set/found. Include IRIS in the
     `resources/iris/` folder before packaging if you want a fully
     self-contained distribution.

Model files (TensorRT `.trt` engines) are resolved the same way, via
`getIrisModelDir()`: `IRIS_MODELS_DIR` / `IRIS_MODEL_DIR` env var
override, else `<IRIS_HOME>/models`.

## Installing IRIS (recommended: official installer)

The easiest way to get a working `iris_cli.exe` is the official installer
from **<https://iris.cs.bath.ac.uk/>**:

1. Download and run the installer from the site.
2. When prompted for components, install **IRIS Core** (this is the
   `iris_cli.exe` + models this app needs). You do not need **IRIS Spec
   Builder**: this starter kit builds its own pipeline spec directly in
   code, so no spec-authoring tool is required to run it. See "Writing
   your own pipeline spec" below if you want to customize or replace the
   spec yourself.
3. The installer downloads the ONNX models and builds five TensorRT
   engines locally. They're GPU-specific, which is why they're built on
   your machine instead of just being copied over. This step can take
   several minutes, so wait for the installer window to report completion.
4. The installer sets `IRIS_HOME` in `HKLM` (machine-wide) automatically.
   Just run:
   ```powershell
   npm run dev
   ```
   No environment variable setup needed, **unless** you have a personal
   `IRIS_HOME` user env var already set, see the priority-order note
   above.

## Writing your own pipeline spec

The app never calls out to a spec-authoring tool. It assembles the JSON
config that `iris_cli run` expects directly in code, in two pieces:

- `electron/iris/pipeline-template.json` holds the static parts of the
  spec: stage wiring, model routing, and the tracking/smoothing constants.
  This is the file to edit if you want to change how the pipeline itself
  behaves, e.g. add or remove stages, swap models, or tune thresholds.
- `buildConfigFromOptions()` in `electron/iris/config.ts` loads that
  template and fills in the values that vary per run or per machine:
  camera ids, resolution, fps, rotation, resolved model/output paths, and
  the run id.

To use your own spec instead of the bundled one, either edit
`pipeline-template.json` in place (keeping the shape `iris_cli` expects),
or point `loadPipelineTemplate()` in `config.ts` at your own JSON file and
let `buildConfigFromOptions()` keep merging in the per-run values on top.

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

If you already ran the official installer, you don't need any of this;
just `npm run dev` (see "Installing IRIS" above). These are for pointing
the app at a locally-built IRIS instead.

### Option A: Use Environment Variable

```powershell
$env:IRIS_CLI_PATH = "C:\path\to\IRIS\build\bin\iris_cli.exe"
npm run dev
```

### Option B: Use `IRIS_HOME`

```powershell
$env:IRIS_HOME = "C:\path\to\IRIS\build"   # expects bin\iris_cli.exe and models\ under here
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
