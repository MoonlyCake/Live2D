"""Author a limited, editable Inochi2D 0.8 rig from frozen registered art.
No Cubism output. Original PNG bytes are preserved. Native validation required.
"""
import copy, hashlib, json, math, pathlib, struct
from PIL import Image
ROOT=pathlib.Path(__file__).resolve().parents[1]
ART=ROOT/'art'/'production-v3-core-ready'
OUT=ROOT/'model-source'
W=H=1254

def sstep(a,b,v):
 t=max(0.,min(1.,(v-a)/(b-a)));return t*t*(3-2*t)
def rot_offset(x,y,pivot,angle):
 x0,y0=x-pivot[0],y-pivot[1];c,s=math.cos(angle),math.sin(angle)
 return (c*x0-s*y0-x0,s*x0+c*y0-y0)
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

def build():
 manifest=json.loads((ART/'manifest.json').read_text());assert manifest['frozen']
 fix=ROOT/'art'/'production-v3-eyesocket-fix-ready'
 overrides={e['name']:e for e in json.loads((fix/'manifest.json').read_text())['layers']}
 source=(ROOT.parent/'inochi-proof'/'smoke.inx').read_bytes();n=struct.unpack('>I',source[8:12])[0];model=json.loads(source[12:12+n])
 prototype=copy.deepcopy(model['nodes']['children'][0]);model['meta'].update(name='Whale Girl Core — Draft',version='v0.8.6',rigger='Editable mesh authoring; native and runtime QA pending')
 model['nodes'].update(uuid=4000,name='WhaleRoot',children=[]);model['param']=[];model['automation']=None;model['animations']=None;model['groups']=[]
 nodes={};coords={};textures=[];sources=[];alpha_bounds={}
 for i,entry in enumerate(manifest['layers']):
  entry=dict(entry)
  if entry['name'] in overrides:
   entry.update(overrides[entry['name']]);path=fix/entry['file']
  else:path=ART/entry['file']
  raw=path.read_bytes();assert hashlib.sha256(raw).hexdigest()==entry['sha256']
  im=Image.open(path).convert('RGBA');assert im.size==(W,H)
  node=copy.deepcopy(prototype);mesh,points=mesh_for(im,entry['name']);name=entry['name'];alpha_bounds[name]=im.getbbox()
  # Closed/open variants use keyed opacity. Base opacity must remain 1 so hidden
  # alternatives can be enabled by native multiplicative opacity bindings.
  node.update(uuid=5000+i,name=name,zsort=-float(entry['z_back_to_front']),enabled=True,opacity=1.,mesh=mesh,textures=[i,4294967295,4294967295])
  node['transform']={'trans':[0.,0.,0.],'rot':[0.,0.,0.],'scale':[1.,1.]}
  model['nodes']['children'].append(node);nodes[name]=node;coords[name]=points;textures.append(raw);sources.append({'name':name,'file':str(path.relative_to(ROOT)),'sha256':entry['sha256']})
 def param(name,keys,default=0.):
  lo,hi=keys[0],keys[-1]
  p={'uuid':6000+len(model['param']),'name':name,'is_vec2':False,'min':[lo,0.],'max':[hi,1.],'defaults':[default,0.],'axis_points':[[(v-lo)/(hi-lo) for v in keys],[0.]],'merge_mode':'Additive','bindings':[]}
  model['param'].append(p);return p
 def bind_deform(p,names,keys,fn):
  for name in names:
   vals=[[[list(fn(name,x,y,v)) for x,y in coords[name]]] for v in keys]
   p['bindings'].append({'node':nodes[name]['uuid'],'param_name':'deform','values':vals,'isSet':[[True] for _ in keys],'interpolate_mode':'Linear'})
 def bind_scalar(p,names,prop,values):
  for name in names:p['bindings'].append({'node':nodes[name]['uuid'],'param_name':prop,'values':[[float(v)] for v in values],'isSet':[[True] for _ in values],'interpolate_mode':'Linear'})
 allnames=list(nodes);head=manifest['head_group']
 global_roles=['ParamBreath','ParamBodyAngleX','ParamBodyAngleY','ParamBounce']
 for role in global_roles:
  keys=[0.,.5,1.] if role in ['ParamBreath','ParamBounce'] else [-1.,0.,1.];p=param(role,keys)
  def fn(name,x,y,v,role=role):
   a=math.sin(math.pi*max(0.,min(1.,y/H)))
   if role=='ParamBreath':return ((x-W/2)*.003*a*v,-2*a*v)
   if role=='ParamBodyAngleX':return (4*a*v,0.)
   if role=='ParamBodyAngleY':return (0.,-3*a*v)
   return ((x-W/2)*.002*a*v,-7*a*v)
  bind_deform(p,allnames,keys,fn)
 for role in ['ParamAngleX','ParamAngleY','ParamAngleZ']:
  keys=[-1.,0.,1.];p=param(role,keys)
  def fn(name,x,y,v,role=role):
   if role=='ParamAngleX':return (6*v,0.)
   if role=='ParamAngleY':return (0.,-4*v)
   return rot_offset(x,y,manifest['pivots']['head'],math.radians(.35)*v)
  bind_deform(p,head,keys,fn)
 keys=[-1.,0.,1.];p=param('ParamHairSway',keys)
 bind_deform(p,['Ahoge'],keys,lambda name,x,y,v:(4*(1-sstep(30,70,y))*v,0.))
 for side,eye in manifest['eye_groups'].items():
  keys=[0.,.06,.12,.65,1.];p=param('ParamEye'+side+'Open',keys,1.)
  bind_scalar(p,eye['open'],'opacity',[0.,0.,1.,1.,1.]);bind_scalar(p,eye['closed'],'opacity',[1.,1.,0.,0.,0.])
  py=eye['pivot'][1]
  bind_deform(p,['EyeLash'+side],keys,lambda name,x,y,v,py=py:(0.,(py-y)*(1-max(.08,v))))
  outer=alpha_bounds['EyeSocket'+side];inside=alpha_bounds['EyeWhite'+side]
  def eyelid_skin(name,x,y,v,py=py,outer=outer,inside=inside):
   a,b=outer[1]-2,outer[3]+2;top,bot=inside[1],inside[3];amount=max(.08,v)
   nt=py+(top-py)*amount;nb=py+(bot-py)*amount
   if y<top: yy=a+(y-a)*(nt-a)/(top-a)
   elif y>bot: yy=nb+(y-bot)*(b-nb)/(b-bot)
   else: yy=py+(y-py)*amount
   return (0.,yy-y)
  bind_deform(p,['EyeSocket'+side],keys,eyelid_skin)
 for role in ['ParamEyeBallX','ParamEyeBallY']:
  keys=[-1.,0.,1.];p=param(role,keys)
  bind_deform(p,['IrisL','IrisR'],keys,lambda name,x,y,v,role=role:(3*v,0.) if role=='ParamEyeBallX' else (0.,-3*v))
 keys=[0.,.12,.35,1.];p=param('ParamMouthOpenY',keys)
 bind_scalar(p,['MouthClosed'],'opacity',[1.,1.,0.,0.]);bind_scalar(p,['MouthOpen'],'opacity',[0.,0.,1.,1.])
 py=manifest['mouth']['pivot'][1]
 bind_deform(p,['MouthOpen'],keys,lambda name,x,y,v:(0.,(py-y)*(1-max(.08,v))))
 keys=[-1.,0.,1.];p=param('ParamMouthForm',keys);px=manifest['mouth']['pivot'][0]
 bind_deform(p,['MouthClosed','MouthOpen'],keys,lambda name,x,y,v:(0.,-3*v*min(1.,((x-px)/24)**2)))
 keys=[0.,.5,1.];p=param('ParamTyping',keys)
 bind_deform(p,['ForearmHandL','ForearmHandR'],keys,lambda name,x,y,v:rot_offset(x,y,manifest['pivots'][name],math.radians(-4 if name.endswith('L') else 4)*v))
 payload=json.dumps(model,separators=(',',':')).encode();out=b'TRNSRTS\0'+struct.pack('>I',len(payload))+payload+b'TEX_SECT'+struct.pack('>I',len(textures))
 for raw in textures:out+=struct.pack('>I',len(raw))+b'\0'+raw
 path=OUT/'WhaleGirl-core-DRAFT.inx';path.write_bytes(out)
 qa={'status':'authored draft; no continuous-transition visual approval yet','format':'Inochi2D 0.8 limited normal-alpha mesh subset, not Cubism','source_art':str(ART.relative_to(ROOT)),'parts':len(nodes),'vertices':sum(len(n['mesh']['verts'])//2 for n in nodes.values()),'triangles':sum(len(n['mesh']['indices'])//3 for n in nodes.values()),'parameters':[p['name'] for p in model['param']],'all_keyframes_explicit':True,'no_masks_composites_physics':True,'not_complete':['rice/eating','five distinct moods','cheek puff','continuous blink/mouth/native visual validation','target OS delivery'],'sources':sources}
 (OUT/'core-authoring.json').write_text(json.dumps(qa,ensure_ascii=False,indent=2)+'\n');print(path,len(out),qa['parts'],qa['vertices'],qa['triangles'])
if __name__=='__main__':build()
