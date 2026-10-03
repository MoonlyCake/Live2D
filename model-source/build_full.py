"""Complete feature authoring draft using frozen core + extras art.
All runtime controls are actual explicit 1D Inochi2D bindings. Native and
continuous-motion visual QA are required before any release claim.
"""
import copy,hashlib,json,math,pathlib,struct
from PIL import Image
from build_core import ROOT,OUT,mesh_for,rot_offset
from opaque_rice import apply_opaque_rice_fix
EXTRA=ROOT/'art'/'production-v3-extras-ready'

def read_model(path):
 b=path.read_bytes();size=struct.unpack('>I',b[8:12])[0];m=json.loads(b[12:12+size]);p=12+size;assert b[p:p+8]==b'TEX_SECT';p+=8;n=struct.unpack('>I',b[p:p+4])[0];p+=4;textures=[]
 for _ in range(n):
  sz=struct.unpack('>I',b[p:p+4])[0];p+=4;kind=b[p];p+=1;assert kind==0;textures.append(b[p:p+sz]);p+=sz
 return m,textures

def build():
 m,textures=read_model(OUT/'WhaleGirl-core-DRAFT.inx');meta=json.loads((EXTRA/'manifest.json').read_text());assert meta['frozen']
 m['meta'].update(name='Whale Girl — Full Feature Draft',rigger='Inochi2D open-format authoring; native continuous QA pending')
 nodes={n['name']:n for n in m['nodes']['children']};coords={name:list(zip(n['mesh']['verts'][::2],n['mesh']['verts'][1::2])) for name,n in nodes.items()}
 coords={name:[(x+627,y+627) for x,y in points] for name,points in coords.items()}
 prototype=copy.deepcopy(next(iter(nodes.values())))
 for i,e in enumerate(meta['layers']):
  raw=(EXTRA/e['file']).read_bytes();assert hashlib.sha256(raw).hexdigest()==e['sha256'];im=Image.open(EXTRA/e['file']).convert('RGBA');mesh,points=mesh_for(im,e['name'])
  n=copy.deepcopy(prototype);n.update(uuid=7000+i,name=e['name'],mesh=mesh,textures=[len(textures),4294967295,4294967295],opacity=1.,enabled=True);n['transform']={'trans':[0.,0.,0.],'rot':[0.,0.,0.],'scale':[1.,1.]}
  textures.append(raw);m['nodes']['children'].append(n);nodes[e['name']]=n;coords[e['name']]=points
 # One art texture may have two distinct opacity owners. Do not multiply Sleepy
 # and Unimpressed gates on the same node, which would make both disappear.
 n=copy.deepcopy(nodes['MouthUnimpressed']);n.update(uuid=7100,name='MouthSleepy');m['nodes']['children'].append(n);nodes[n['name']]=n;coords[n['name']]=coords['MouthUnimpressed']
 order=['BackHairComplete','TailVisible','BodyUnderpaint','UpperArmL','UpperArmR','RiceElbowBridgeL','RiceElbowBridgeR','BodyFrontOriginal','ForearmHandL','ForearmHandR','RiceHoldingArmBowl','FaceBase','EyeWhiteL','EyeWhiteR','IrisL','IrisR','EyeSocketL','EyeSocketR','EyeLashL','EyeLashR','EyeClosedL','EyeClosedR','MouthClosed','MouthOpen','MouthShy','MouthAggrieved','MouthUnimpressed','MouthSleepy','BlushL','BlushR','TearL','TearR','HairFrontAndHeaddress','Ahoge','RiceSpoonArmEmpty','RiceBite']
 assert set(order)==set(nodes)
 for i,name in enumerate(order):nodes[name]['zsort']=-float(i)
 m['nodes']['children']=[nodes[name] for name in order]
 def parameter(name,keys,default=0.):
  lo,hi=keys[0],keys[-1];p={'uuid':7200+len(m['param']),'name':name,'is_vec2':False,'min':[lo,0.],'max':[hi,1.],'defaults':[default,0.],'axis_points':[[(v-lo)/(hi-lo) for v in keys],[0.]],'merge_mode':'Additive','bindings':[]};m['param'].append(p);return p
 def scalar(p,names,values):
  for name in names:p['bindings'].append({'node':nodes[name]['uuid'],'param_name':'opacity','values':[[float(x)] for x in values],'isSet':[[True] for _ in values],'interpolate_mode':'Linear'})
 def deform(p,names,keys,fn):
  for name in names:p['bindings'].append({'node':nodes[name]['uuid'],'param_name':'deform','values':[[[list(fn(name,x,y,v)) for x,y in coords[name]]] for v in keys],'isSet':[[True] for _ in keys],'interpolate_mode':'Linear'})
 def keys_of(p):return [p['min'][0]+x*(p['max'][0]-p['min'][0]) for x in p['axis_points'][0]]
 params={p['name']:p for p in m['param']}
 extra_names=[e['name'] for e in meta['layers']]+['MouthSleepy'];face_extras=['MouthShy','MouthAggrieved','MouthUnimpressed','MouthSleepy','BlushL','BlushR','TearL','TearR']
 # Apply the same small global fields to accessories, so bowl and sleeves stay
 # registered to torso during breathing/bounce/music sway.
 for role in ['ParamBreath','ParamBodyAngleX','ParamBodyAngleY','ParamBounce']:
  p=params[role];ks=keys_of(p)
  def fn(name,x,y,v,role=role):
   a=math.sin(math.pi*max(0.,min(1.,y/1254)))
   if role=='ParamBreath':return ((x-627)*.003*a*v,-2*a*v)
   if role=='ParamBodyAngleX':return (4*a*v,0.)
   if role=='ParamBodyAngleY':return (0.,-3*a*v)
   return ((x-627)*.002*a*v,-7*a*v)
  deform(p,extra_names,ks,fn)
 for role in ['ParamAngleX','ParamAngleY','ParamAngleZ']:
  p=params[role];ks=keys_of(p)
  def fn(name,x,y,v,role=role):
   if role=='ParamAngleX':return (6*v,0.)
   if role=='ParamAngleY':return (0.,-4*v)
   return rot_offset(x,y,[626,641],math.radians(.35)*v)
  deform(p,face_extras,ks,fn)
 # Alternate mood mouths disappear during actual mouth opening/chewing.
 open_param=params['ParamMouthOpenY'];scalar(open_param,['MouthShy','MouthAggrieved','MouthUnimpressed','MouthSleepy'],[1.,1.,0.,0.])
 form=params['ParamMouthForm'];deform(form,['MouthShy','MouthAggrieved','MouthUnimpressed','MouthSleepy'],keys_of(form),lambda name,x,y,v:(0.,-2*v*min(1.,((x-626)/24)**2)))
 mood_nodes={'Shy':['MouthShy','BlushL','BlushR'],'Aggrieved':['MouthAggrieved','TearL','TearR'],'Sleepy':['MouthSleepy'],'Unimpressed':['MouthUnimpressed']}
 for mood in ['Happy','Shy','Aggrieved','Sleepy','Unimpressed']:
  p=parameter('Param'+mood,[0.,1.])
  if mood=='Happy':deform(p,['MouthClosed','MouthOpen'],[0.,1.],lambda name,x,y,v:(0.,-1.5*v*min(1.,((x-626)/24)**2)))
  else:
   scalar(p,mood_nodes[mood],[0.,1.]);scalar(p,['MouthClosed'],[1.,0.])
 rice=['RiceElbowBridgeL','RiceElbowBridgeR','RiceHoldingArmBowl','RiceSpoonArmEmpty','RiceBite']
 p=parameter('ParamRiceBowlOpacity',[0.,1.]);scalar(p,rice,[0.,1.])
 p=parameter('ParamRicePoseSwitch',[0.,1.]);scalar(p,['ForearmHandL','ForearmHandR'],[1.,0.]);scalar(p,rice,[0.,1.])
 ks=[i/8 for i in range(9)];p=parameter('ParamRiceArm',ks)
 deform(p,['RiceSpoonArmEmpty','RiceBite'],ks,lambda name,x,y,v:rot_offset(x,y,meta['rice']['right_pivot'],-math.radians(34)*(1-v)))
 p=parameter('ParamRiceBiteOpacity',[0.,1.]);scalar(p,['RiceBite'],[0.,1.])
 p=parameter('ParamCheekPuff',[0.,.5,1.])
 def puff(name,x,y,v):
  left=math.exp(-((x-476)/55)**2-((y-591)/35)**2);right=math.exp(-((x-757)/55)**2-((y-569)/35)**2)
  return (3*v*(right-left),.7*v*(left+right))
 deform(p,['FaceBase','BlushL','BlushR','TearL','TearR'],[0.,.5,1.],puff)
 m=apply_opaque_rice_fix(m)
 payload=json.dumps(m,separators=(',',':')).encode();b=b'TRNSRTS\0'+struct.pack('>I',len(payload))+payload+b'TEX_SECT'+struct.pack('>I',len(textures))
 for raw in textures:b+=struct.pack('>I',len(raw))+b'\0'+raw
 dest=OUT/'WhaleGirl-full-DRAFT.inx';dest.write_bytes(b)
 report={'status':'full feature authoring draft; native/continuous QA pending','parts':len(nodes),'unique_textures':len(textures),'parameters':[p['name'] for p in m['param']],'discrete_only':['ParamRicePoseSwitch','ParamRiceBiteOpacity'],'single_eye_open_owner':True,'mood_eye_openness':{'happy':1.,'shy':.82,'aggrieved':.65,'sleepy':.25,'unimpressed':.5},'rice_controls':{'ParamRiceArm':'0 bowl (native -34 degrees), 1 mouth (0 degrees)','ParamRicePoseSwitch':'exact0 idle hands; exact1 alternate rice arms; never interpolate','ParamRiceBiteOpacity':'food disappears at mouth, remains absent until next scoop','ParamRiceBowlOpacity':'historical name: opaque small retraction field, no alpha fading of attached hands; app returns spoon then switches pose exclusively'},'missing_validation':['eye occlusion fix','all mood+blink combinations','whole rice cycle and hide interruption','official native final export','actual target OS packages']}
 (OUT/'full-authoring.json').write_text(json.dumps(report,indent=2)+'\n');print(dest,len(b),len(nodes),len(m['param']))
if __name__=='__main__':build()
