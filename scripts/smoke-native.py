#!/usr/bin/env python3
"""Launch final native Mac ARM/Windows executable without security/GPU flags."""
import json,os,pathlib,platform,plistlib,signal,struct,subprocess,sys
if sys.platform not in ['darwin','win32']:raise SystemExit('This verifies native macOS/Windows; Linux does not count')
source=pathlib.Path(sys.argv[1]).resolve();out=pathlib.Path(sys.argv[2]).resolve();out.mkdir(parents=True,exist_ok=True)
if sys.platform=='darwin':
 if platform.machine()!='arm64':raise SystemExit('Only Apple Silicon Mac is supported')
 info=plistlib.loads((source/'Contents/Info.plist').read_bytes());exe=source/'Contents/MacOS'/info['CFBundleExecutable'];expected_arch='arm64'
else:
 exe=source;expected_arch='x64'
 if exe.suffix.lower()!='.exe':raise SystemExit('Expected built Windows EXE')
if not exe.is_file():raise SystemExit('Native executable missing')
resources=source/'Contents/Resources' if sys.platform=='darwin' else exe.parent/'resources'
license_root=resources if sys.platform=='darwin' else exe.parent
for name in ['LICENSE.electron.txt','LICENSES.chromium.html']:
 if not (license_root/name).is_file():raise SystemExit('Missing runtime license: '+name)
for name in ['binding.gyp','COPYING','COPYING.LESSER']:
 if not (resources/'third-party-source/uiohook-napi'/name).is_file():raise SystemExit('Missing native source/license: '+name)
# Only prior generated QA outputs in this explicit directory are removed.
for pattern in ['*-report.json','*.png','launch.log']:
 for file in out.glob(pattern):file.unlink()
env={**os.environ,'ELECTRON_ENABLE_LOGGING':'1','WHALE_CI_SMOKE_DIR':str(out),'WHALE_CI_MODEL_STAGE':'full'}
for key in ['ELECTRON_RUN_AS_NODE','WHALE_SMOKE_TEST']:env.pop(key,None)
options={'start_new_session':True} if sys.platform=='darwin' else {'creationflags':subprocess.CREATE_NEW_PROCESS_GROUP}
with (out/'launch.log').open('w',encoding='utf-8') as log:
 p=subprocess.Popen([str(exe)],cwd=exe.parent,stdout=log,stderr=log,env=env,**options)
 try:
  code=p.wait(timeout=90)
  if code!=0:raise RuntimeError(f'Native app exited with {code}; inspect launch.log')
  report=json.loads((out/'renderer-report.json').read_text(encoding='utf-8'))
  if report.get('status')!='passed' or report.get('platform')!=sys.platform or report.get('arch')!=expected_arch:raise RuntimeError('Native platform/architecture/render proof failed')
  if len(report.get('windows',[]))!=2:raise RuntimeError('Both pet and panel must pass')
  expected=['pet-window.png','settings-window.png','action-typing.png','action-sleep-closed-eyes.png','mood-happy.png','mood-shy.png','mood-aggrieved.png','mood-sleepy.png','mood-unimpressed.png','meal-scoop.png','meal-lift.png','meal-mouth.png','meal-return.png','meal-caught-return.png','meal-caught-hidden.png','physical-chord.png','physical-release.png','physical-mouse-min.png','physical-mouse-max-click.png','physical-wheel.png','physical-clear.png']
  for name in expected:
   b=(out/name).read_bytes()
   if len(b)<1000 or b[:8]!=b'\x89PNG\r\n\x1a\n':raise RuntimeError(f'Missing/invalid native screenshot: {name}')
   w,h=struct.unpack('>II',b[16:24])
   if min(w,h)<100:raise RuntimeError(f'Undersized screenshot: {name}')
  for window in report['windows']:
   if not window['inochi']['modelUrl'].endswith('/WhaleGirl.inp'):raise RuntimeError('Draft or external model used instead of final bundled INP')
  report.update(native_os=platform.platform(),native_architecture=platform.machine(),launch_kind='native executable, normal sandbox, no security/GPU flags')
  (out/'launch-report.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf-8');print(json.dumps(report,ensure_ascii=True))
 finally:
  if p.poll() is None:
   if sys.platform=='win32':subprocess.run(['taskkill','/PID',str(p.pid),'/T','/F'],check=False)
   else:
    os.killpg(p.pid,signal.SIGTERM)
    try:p.wait(timeout=10)
    except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL)
   p.wait()
