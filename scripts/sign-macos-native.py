#!/usr/bin/env python3
"""Ad-hoc sign on an Apple Silicon cloud runner. Not Developer ID/notarization."""
import pathlib,platform,subprocess,sys
if sys.platform!='darwin' or platform.machine()!='arm64':raise SystemExit('Native Apple Silicon macOS runner required')
app=pathlib.Path(sys.argv[1]).resolve()
if not app.is_dir() or app.suffix!='.app':raise SystemExit('Expected final .app bundle')
def run(*args):subprocess.run([str(x) for x in args],check=True)
def macho(p):
 with p.open('rb') as f:return f.read(4) in [b'\xcf\xfa\xed\xfe',b'\xce\xfa\xed\xfe',b'\xca\xfe\xba\xbe',b'\xca\xfe\xba\xbf']
for p in sorted(app.rglob('*'),key=lambda p:len(p.parts),reverse=True):
 if p.is_file() and not p.is_symlink() and macho(p):run('codesign','--force','--sign','-','--timestamp=none',p)
for p in sorted(app.rglob('*'),key=lambda p:len(p.parts),reverse=True):
 if p.is_dir() and not p.is_symlink() and p.suffix in ['.framework','.app','.xpc']:run('codesign','--force','--sign','-','--timestamp=none',p)
run('codesign','--force','--sign','-','--timestamp=none',app)
run('codesign','--verify','--deep','--strict','--verbose=4',app)
