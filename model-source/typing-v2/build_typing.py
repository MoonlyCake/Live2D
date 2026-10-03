"""Append actual per-key hand controls; never modify the released native model.
Requires registered typing artwork and the renderer's physical-key layout.
"""
import copy, io, json, math, pathlib, struct, sys
from PIL import Image
HERE=pathlib.Path(__file__).resolve().parent
ROOT=HERE.parents[1]
W=H=1254

def mesh_for(im,name):
 box=im.getbbox();assert box
 l,t,r,b=box;l=max(0,l-2);t=max(0,t-2);r=min(W,r+2);b=min(H,b+2)
 # Local UV mesh, not raster cropping. Facial controls need finer local samples.
 nx=10 if name.startswith(('Eye','Iris','Mouth')) else 14
 ny=8 if name.startswith(('Eye','Iris','Mouth')) else 14
 coords=[];uvs=[];verts=[];indices=[]
 for j in range(ny+1):
  for i in range(nx+1):
   x=l+(r-l)*i/nx;y=t+(b-t)*j/ny;coords.append((x,y));verts.extend([x-W/2,y-H/2]);uvs.extend([x/W,y/H])
 alpha=im.getchannel('A')
 for j in range(ny):
  for i in range(nx):
   x0=max(0,int(l+(r-l)*i/nx)-2);x1=min(W,math.ceil(l+(r-l)*(i+1)/nx)+2)
   y0=max(0,int(t+(b-t)*j/ny)-2);y1=min(H,math.ceil(t+(b-t)*(j+1)/ny)+2)
   if alpha.crop((x0,y0,x1,y1)).getbbox() is None:continue
   a=j*(nx+1)+i;c=a+nx+1;indices.extend([a,c,a+1,a+1,c,c+1])
 return {'verts':verts,'uvs':uvs,'indices':indices,'origin':[0.,0.]},coords

def read_container(path):
 b=path.read_bytes();assert b[:8]==b'TRNSRTS\0'
 n=struct.unpack('>I',b[8:12])[0];model=json.loads(b[12:12+n]);i=12+n
 assert b[i:i+8]==b'TEX_SECT';i+=8;count=struct.unpack('>I',b[i:i+4])[0];i+=4;textures=[]
 for _ in range(count):
  size=struct.unpack('>I',b[i:i+4])[0];kind=b[i+4];i+=5;textures.append((kind,b[i:i+size]));i+=size
 return model,textures

def write_container(path,model,textures):
 raw=json.dumps(model,separators=(',',':')).encode();out=b'TRNSRTS\0'+struct.pack('>I',len(raw))+raw+b'TEX_SECT'+struct.pack('>I',len(textures))
 for kind,png in textures:out+=struct.pack('>I',len(png))+bytes([kind])+png
 path.write_bytes(out)

def build(art_path):
 art=json.loads((art_path/'manifest.json').read_text());assert art['canvas']==[1254,1254]
 m,textures=read_container(HERE/'base-v0.2.0.inx')
 assert len(m['param'])==25 and not any(p['name']=='ParamTypingMode' for p in m['param']), 'Authoring base must be original 25-parameter model'
 nodes={n['name']:n for n in m['nodes']['children']};prototype=copy.deepcopy(nodes['ForearmHandL']);coords={}
 for i,e in enumerate(art['layers']):
  raw=(art_path/e['file']).read_bytes();im=Image.open(io.BytesIO(raw)).convert('RGBA');assert im.size==(1254,1254)
  mesh,points=mesh_for(im,e['name']);node=copy.deepcopy(prototype)
  node.update(uuid=8000+i,name=e['name'],mesh=mesh,textures=[len(textures),4294967295,4294967295],opacity=1.,zsort=(-40.-i*.01 if 'Bridge' in e['name'] else -60.-i*.01))
  node['transform']={'trans':[0.,0.,0.],'rot':[0.,0.,0.],'scale':[1.,1.]}
  nodes[e['name']]=node;coords[e['name']]=points;m['nodes']['children'].append(node);textures.append((0,raw))
 def param(name,keys,default):
  lo,hi=keys[0],keys[-1];p={'uuid':8200+len(m['param']),'name':name,'is_vec2':False,'min':[lo,0.],'max':[hi,1.],'defaults':[default,0.],'axis_points':[[(v-lo)/(hi-lo) for v in keys],[0.]],'merge_mode':'Additive','bindings':[]};m['param'].append(p);return p
 def alpha(p,names,values):
  for name in names:p['bindings'].append({'node':nodes[name]['uuid'],'param_name':'opacity','values':[[v] for v in values],'isSet':[[True] for _ in values],'interpolate_mode':'Linear'})
 newnames=list(coords);mode=param('ParamTypingMode',[0.,1.],0.)
 alpha(mode,newnames,[0.,1.]);alpha(mode,['ForearmHandL','ForearmHandR','RiceElbowBridgeL','RiceElbowBridgeR','RiceHoldingArmBowl','RiceSpoonArmEmpty','RiceBite'],[1.,0.])
 # Defensive food pose gate: impossible to display typing and eating arms together.
 rice=next(p for p in m['param'] if p['name']=='ParamRicePoseSwitch');alpha(rice,newnames,[1.,0.])
 report={}
 def bridge_polar(h,role):
  name=h['bridge_layer'];fixed=h['upper_fixed_anchor'];moving=h['bridge_moving_anchor'];dx,dy=moving[0]-fixed[0],moving[1]-fixed[1];length=math.hypot(dx,dy);angle=math.atan2(dy,dx);assert length>20
  node=nodes[name];c,s=math.cos(angle),math.sin(angle);local=[]
  for x,y in coords[name]:
   x,y=x-fixed[0],y-fixed[1];local.extend([c*x+s*y,-s*x+c*y])
  node['mesh']['verts']=local;node['mesh']['origin']=[0.,0.];node['transform']={'trans':[fixed[0]-627.,fixed[1]-627.,0.],'rot':[0.,0.,angle],'scale':[1.,1.]}
  for suffix,keys,default,prop in [('Angle',[-math.pi,0.,math.pi],0.,'transform.r.z'),('Length',[.05,1.,5.],1.,'transform.s.x')]:
   p=param('Param'+role+suffix,keys,default);p['bindings'].append({'node':node['uuid'],'param_name':prop,'values':[[v] for v in keys],'isSet':[[True] for _ in keys],'interpolate_mode':'Linear'})
  return {'fixed':fixed,'moving':moving,'base_angle':angle,'base_length':length,'angle_parameter':'Param'+role+'Angle','length_parameter':'Param'+role+'Length'}
 for side,h in art['hands'].items():
  hand,bridge=h['hand_layer'],h['bridge_layer'];finger=h['finger_anchor'];wrist=h['wrist_anchor'];fixed=h['upper_fixed_anchor']
  keylayout=json.loads((ROOT/'assets'/'keyboard.layout.json').read_text());homeid=keylayout['home']['left' if side=='L' else 'right'];home=next(k for k in keylayout['keys'] if k['id']==homeid)
  assert finger==[home['x'],home['y']], 'Typing artwork fingertip differs from shared key home'
  polar=bridge_polar(h,'TypingSleeve'+side)
  for axis,lo,hi in [('X',360.,910.),('Y',820.,1030.)]:
   a=0 if axis=='X' else 1;default=float(finger[a]);keys=sorted(set([lo,default,hi]));p=param('ParamTypingHand'+side+axis,keys,default)
   p['bindings'].append({'node':nodes[hand]['uuid'],'param_name':'deform','values':[[[[v-default,0.] if a==0 else [0.,v-default] for _ in coords[hand]]] for v in keys],'isSet':[[True] for _ in keys],'interpolate_mode':'Linear'})
  p=param('ParamTypingPress'+side,[0.,1.],0.);p['bindings'].append({'node':nodes[hand]['uuid'],'param_name':'deform','values':[[[[0.,0.] for _ in coords[hand]]],[[[0.,4.] for _ in coords[hand]]]],'isSet':[[True],[True]],'interpolate_mode':'Linear'})
  report[side]={'finger_anchor':finger,'wrist_anchor':wrist,'fixed_anchor':fixed,'hand_layer':hand,'bridge_layer':bridge,'press_pixels':4,'sleeve':polar}
 if 'mouse' in art:
  h=art['mouse'];hand,bridge=h['hand_layer'],h['bridge_layer'];ref=h['reference_anchor'];wrist=h['wrist_anchor'];fixed=h['upper_fixed_anchor']
  layout=json.loads((ROOT/'assets'/'keyboard.layout.json').read_text())['mouse'];polar=bridge_polar(h,'MouseSleeveR')
  mousemode=param('ParamMouseMode',[0.,1.],0.);alpha(mousemode,[hand,bridge],[0.,1.]);alpha(mousemode,[art['hands']['R']['hand_layer'],art['hands']['R']['bridge_layer']],[1.,0.])
  ranges={axis:(float(layout['travel']['min'+axis]),float(layout['travel']['max'+axis])) for axis in ['X','Y']}
  assert ref==[layout['home']['x'],layout['home']['y']], 'Mouse artwork home differs from shared layout'
  for axis,(lo,hi) in ranges.items():
   a=0 if axis=='X' else 1;default=float(ref[a]);keys=sorted(set([lo,default,hi]));p=param('ParamMouse'+axis,keys,default)
   p['bindings'].append({'node':nodes[hand]['uuid'],'param_name':'deform','values':[[[[v-default,0.] if a==0 else [0.,v-default] for _ in coords[hand]]] for v in keys],'isSet':[[True] for _ in keys],'interpolate_mode':'Linear'})
  for role,anchor in [('Left',h['left_finger_anchor']),('Right',h['right_finger_anchor']),('Wheel',h['left_finger_anchor'])]:
   keys=[-1.,0.,1.] if role=='Wheel' else [0.,1.];p=param('ParamMouse'+role,keys,0.)
   def press(x,y,v):
    w=math.exp(-((x-anchor[0])/14.)**2-((y-anchor[1])/22.)**2)
    return [0.,(2. if role=='Wheel' else 4.)*v*w]
   p['bindings'].append({'node':nodes[hand]['uuid'],'param_name':'deform','values':[[[press(x,y,v) for x,y in coords[hand]]] for v in keys],'isSet':[[True] for _ in keys],'interpolate_mode':'Linear'})
  report['mouse']={'reference_anchor':ref,'wrist_anchor':wrist,'fixed_anchor':fixed,'ranges':ranges,'hand_layer':hand,'bridge_layer':bridge,'sleeve':polar}
 m['meta'].update(name='Whale Girl — Per-key Keyboard and Mouse Draft',rigger='Native export and input visual validation pending')
 out=HERE/'WhaleGirl-typing-DRAFT.inx';write_container(out,m,textures)
 (HERE/'authoring.json').write_text(json.dumps({'status':'authoring draft','art':str(art_path.relative_to(ROOT)),'parts':len(nodes),'params':len(m['param']),'hands':report,'pending':['all-key geometry validation','native Creator export','real keyboard-event visual validation']},indent=2)+'\n')
 (HERE/'rig-contract.json').write_text(json.dumps({'canvas':[1254,1254],'hands':report,'keyboard_layer_z':-50.,'sleeve_math':'movingTarget = authoredMoving + (target - authoredReference) + pressOffset; deltaAngle = wrap(atan2(movingTarget-fixed)-baseAngle); length = distance/baseLength; apply every animation frame'},indent=2)+'\n')
 print(out)
if __name__=='__main__':
 if len(sys.argv)!=2:raise SystemExit('Usage: build_typing.py ART_DIRECTORY')
 build(pathlib.Path(sys.argv[1]).resolve())
