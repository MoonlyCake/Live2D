"""Build an editable, registered perspective work scene. Native export is separate."""
import copy,io,json,math,pathlib,struct,sys
from PIL import Image
HERE=pathlib.Path(__file__).resolve().parent;ROOT=HERE.parents[1]

def read_model(path):
 b=path.read_bytes();n=struct.unpack('>I',b[8:12])[0];return json.loads(b[12:12+n])
def write_model(path,m,textures):
 raw=json.dumps(m,separators=(',',':')).encode();b=b'TRNSRTS\0'+struct.pack('>I',len(raw))+raw+b'TEX_SECT'+struct.pack('>I',len(textures))
 for t in textures:b+=struct.pack('>I',len(t))+b'\0'+t
 path.write_bytes(b)
def build(art,*patches):
 meta=json.loads((art/'manifest.json').read_text());W,H=meta['canvas'];origin=[W/2,H/2]
 sources={};additions={}
 for patch in patches:
  patchmeta=json.loads((patch/'manifest.json').read_text())
  for e in patchmeta.get('replace_layers',[]):sources[e['name']]=patch/e['file']
  for e in patchmeta.get('add_layers',[]):sources[e['name']]=patch/e['file'];additions[e['name']]=e
 meta['layers'].extend(additions.values())
 base=json.loads((HERE/'authoring-template.json').read_text());proto=copy.deepcopy(base['nodes']['children'][0]);m=copy.deepcopy(base)
 m['meta'].update(name='Whale Girl Perspective Work — Draft',rigger='Registered mesh authoring; native export/continuous QA pending');m['nodes'].update(uuid=20000,name='PerspectiveWorkRoot',children=[]);m['param']=[];m['automation']=None;m['animations']=None;m['groups']=[]
 rename={'MouseSleeveL':'MouseSleeveBridgeL','TypingSleeveR':'RaisedSleeveR','TypingHandR':'RaisedHandR','MouseBase':'MouseBody'}
 press=meta.get('typing_press_hand')
 if press:rename.update({press['hand_layer']:'TypingHandR',press['bridge_layer']:'TypingSleeveBridgeR'})
 nodes={};coords={};bounds={};textures=[]
 for i,e in enumerate(meta['layers']):
  name=rename.get(e['name'],e['name']);im=Image.open(sources.get(e['name'],art/e['file'])).convert('RGBA');assert im.size==(W,H);box=im.getbbox();assert box
  l,t,r,b=box;l=max(0,l-3);t=max(0,t-3);r=min(W,r+3);b=min(H,b+3);bounds[name]=(l,t,r,b)
  crop=im.crop((l,t,r,b));raw=io.BytesIO();crop.save(raw,format='PNG');textures.append(raw.getvalue())
  nx,ny=(48,40) if name.startswith('EyeSocket') else (24,18) if name.startswith('EyeLash') else (14,12) if name.startswith(('Eye','Iris','Mouth','TypingHand','MouseHand')) else (24,20);points=[];verts=[];uv=[];ix=[]
  xs=[l+(r-l)*k/nx for k in range(nx+1)];ys=[t+(b-t)*j/ny for j in range(ny+1)]
  anchors=([press['finger_anchor'],press['bridge_moving_anchor']] if name=='TypingHandR' and press else [meta['mouse_hand']['reference_anchor']] if name=='MouseBody' else [])
  if anchors:
   xs=sorted(set(xs+[a[0] for a in anchors if l<=a[0]<=r]));ys=sorted(set(ys+[a[1] for a in anchors if t<=a[1]<=b]));nx,ny=len(xs)-1,len(ys)-1
  for j in range(ny+1):
   for k in range(nx+1):
    x,y=xs[k],ys[j];points.append((x,y));verts.extend([x-origin[0],y-origin[1]]);uv.extend([(x-l)/(r-l),(y-t)/(b-t)])
  alpha=im.getchannel('A')
  for j in range(ny):
   for k in range(nx):
    x0=max(0,int(xs[k])-2);x1=min(W,math.ceil(xs[k+1])+2);y0=max(0,int(ys[j])-2);y1=min(H,math.ceil(ys[j+1])+2)
    if alpha.crop((x0,y0,x1,y1)).getbbox() is None:continue
    a=j*(nx+1)+k;c=a+nx+1;ix.extend([a,c,a+1,a+1,c,c+1])
  if name.startswith('EyeSocket'):
   # Local-u column topology preserves orientation under monotone local-v motion.
   ee=meta['eyes'][name[-1]];px,py=ee['pivot'];aa=math.radians(ee['local_axis_angle_degrees']);cc,ss=math.cos(aa),math.sin(aa)
   corners=[(x-px)*cc+(y-py)*ss for x in [l+3,r-3] for y in [t+3,b-3]];umin,umax=min(corners),max(corners);nx,ny=48,40;points=[];verts=[];uv=[];ix=[]
   for j in range(ny+1):
    for k in range(nx+1):
     u=umin+(umax-umin)*k/nx;vl=-float('inf');vh=float('inf')
     for bb,dd,ll,hh in [(px+cc*u,-ss,l+3,r-3),(py+ss*u,cc,t+3,b-3)]:
      if abs(dd)>1e-10:
       v0,v1=sorted([(ll-bb)/dd,(hh-bb)/dd]);vl=max(vl,v0);vh=min(vh,v1)
     vv=vl+(vh-vl)*j/ny;x=px+cc*u-ss*vv;y=py+ss*u+cc*vv;points.append((x,y));verts.extend([x-origin[0],y-origin[1]]);uv.extend([min(1.,max(0.,(x-l)/(r-l))),min(1.,max(0.,(y-t)/(b-t)))])
   for j in range(ny):
    for k in range(nx):
     a=j*(nx+1)+k;c=a+nx+1;ix.extend([a,c,a+1,a+1,c,c+1])
  n=copy.deepcopy(proto);n.update(uuid=21000+i,name=name,zsort=-15. if name in ['TypingSleeveBridgeR','MouseSleeveBridgeL'] else -float(e['z']),mesh={'verts':verts,'uvs':uv,'indices':ix,'origin':[0.,0.]},textures=[i,4294967295,4294967295],opacity=1.,enabled=True);n['transform']={'trans':[0.,0.,0.],'rot':[0.,0.,0.],'scale':[1.,1.]};m['nodes']['children'].append(n);nodes[name]=n;coords[name]=points
 def parameter(name,keys,default=0.):
  lo,hi=keys[0],keys[-1];p={'uuid':23000+len(m['param']),'name':name,'is_vec2':False,'min':[lo,0.],'max':[hi,1.],'defaults':[default,0.],'axis_points':[[(v-lo)/(hi-lo) for v in keys],[0.]],'merge_mode':'Additive','bindings':[]};m['param'].append(p);return p
 def scalar(p,names,values,prop='opacity'):
  for name in names:p['bindings'].append({'node':nodes[name]['uuid'],'param_name':prop,'values':[[float(v)] for v in values],'isSet':[[True] for _ in values],'interpolate_mode':'Linear'})
 def deform(p,names,keys,fn):
  for name in names:p['bindings'].append({'node':nodes[name]['uuid'],'param_name':'deform','values':[[[list(fn(name,x,y,v)) for x,y in coords[name]]] for v in keys],'isSet':[[True] for _ in keys],'interpolate_mode':'Linear'})
 for side,e in meta['eyes'].items():
  a=math.radians(e['local_axis_angle_degrees']);c,s=math.cos(a),math.sin(a);px,py=e['pivot']
  def local(x,y):return ((x-px)*c+(y-py)*s,-(x-px)*s+(y-py)*c)
  def vlimits(box):return [min(local(x,y)[1] for x in [box[0],box[2]] for y in [box[1],box[3]]),max(local(x,y)[1] for x in [box[0],box[2]] for y in [box[1],box[3]])]
  outer=vlimits(bounds['EyeSocket'+side]);inner=vlimits(e['aperture_bbox']);keys=[0.,.06,.061,.65,1.];p=parameter('ParamEye'+side+'Open',keys,1.)
  scalar(p,e['open'],[0,0,1,1,1]);scalar(p,e['closed'],[1,1,0,0,0])
  def lid(name,x,y,v,c=c,s=s,px=px,py=py):
   yy=-(x-px)*s+(y-py)*c;dv=yy*(max(.08,v)-1);return(-s*dv,c*dv)
  deform(p,['EyeLash'+side],keys,lid)
  def skin(name,x,y,v,c=c,s=s,px=px,py=py,outer=outer,inner=inner,rect=bounds['EyeSocket'+side]):
   # For each local-eye u column, intersect its v-axis line with all four
   # ORIGINAL opaque rectangle edges. Pin those actual intersections, not the
   # extreme projected bbox corners. This preserves a monotone v map and
   # prevents moving the rectangular skin edge over the stationary iris.
   u=(x-px)*c+(y-py)*s;yy=-(x-px)*s+(y-py)*c;ot=-float('inf');ob=float('inf')
   for base,slope,lo,hi in [(px+c*u,-s,rect[0]+3,rect[2]-3),(py+s*u,c,rect[1]+3,rect[3]-3)]:
    if abs(slope)<1e-10:
     if not lo<=base<=hi:return(0.,0.)
    else:
     aa,bb=sorted([(lo-base)/slope,(hi-base)/slope]);ot=max(ot,aa);ob=min(ob,bb)
   if yy<=ot or yy>=ob or ot>=-.001 or ob<=.001:return(0.,0.)
   top=max(inner[0],ot+.0001);bot=min(inner[1],ob-.0001);amount=max(.02,v);nt,nb=top*amount,bot*amount
   if yy<top:new=ot+(yy-ot)*(nt-ot)/(top-ot)
   elif yy>bot:new=nb+(yy-bot)*(ob-nb)/(ob-bot)
   else:new=yy*amount
   dv=new-yy;return(-s*dv,c*dv)
  deform(p,['EyeSocket'+side],keys,skin)
 for role in ['X','Y']:
  keys=[-1.,0.,1.];p=parameter('ParamEyeBall'+role,keys);deform(p,['IrisL','IrisR'],keys,lambda n,x,y,v,role=role:(3*v,0.) if role=='X' else(0.,-3*v))
 keys=[0.,.12,.121,1.];p=parameter('ParamMouthOpenY',keys,1.);scalar(p,['MouthOpen'],[0,0,1,1]);scalar(p,['MouthClosed'],[1,1,0,0]);mp=meta['mouth']['pivot']
 deform(p,['MouthOpen'],keys,lambda n,x,y,v:(0.,(mp[1]-y)*(1-max(.08,v))))
 keys=[-1.,0.,1.];p=parameter('ParamMouthForm',keys);deform(p,['MouthOpen','MouthClosed'],keys,lambda n,x,y,v:(0.,-3*v*min(1.,((x-mp[0])/45)**2)))
 def polar(h,bridge,role):
  fixed=h['upper_fixed_anchor'];moving=h['bridge_moving_anchor'];dx,dy=moving[0]-fixed[0],moving[1]-fixed[1];length=math.hypot(dx,dy);angle=math.atan2(dy,dx);assert length>15
  n=nodes[bridge];c,s=math.cos(angle),math.sin(angle);verts=[]
  for x,y in coords[bridge]:x,y=x-fixed[0],y-fixed[1];verts.extend([c*x+s*y,-s*x+c*y])
  n['mesh']['verts']=verts;n['transform']={'trans':[fixed[0]-origin[0],fixed[1]-origin[1],0.],'rot':[0.,0.,angle],'scale':[1.,1.]}
  p=parameter('Param'+role+'Angle',[-math.pi,0.,math.pi]);scalar(p,[bridge],[-math.pi,0.,math.pi],'transform.r.z')
  ks=[.01,1.,12.];p=parameter('Param'+role+'Length',ks,1.);local=list(zip(verts[::2],verts[1::2]));p['bindings'].append({'node':n['uuid'],'param_name':'deform','values':[[[[max(0.,x)*(v-1.),0.] for x,y in local]] for v in ks],'isSet':[[True] for _ in ks],'interpolate_mode':'Linear'})
  return {'fixed':fixed,'moving':moving,'baseAngle':angle,'baseLength':length,'angleParameter':'Param'+role+'Angle','lengthParameter':'Param'+role+'Length'}
 def xy(names,ref,prefix):
  for axis,limit in [('X',W),('Y',H)]:
   a=0 if axis=='X' else 1;ks=sorted(set([0.,float(ref[a]),float(limit)]));p=parameter(prefix+axis,ks,ref[a]);deform(p,names,ks,lambda n,x,y,v,a=a:(v-ref[a],0.) if a==0 else(0.,v-ref[a]))
 mouse=meta['mouse_hand'];ref=mouse['reference_anchor'];xy(['MouseHandL']+(['MouseBody'] if 'MouseBody' in nodes else[]),ref,'ParamMouse');mouse_sleeve=polar(mouse,'MouseSleeveBridgeL','MouseSleeveL')
 for role,key in [('Left','left_finger_anchor'),('Right','right_finger_anchor'),('Wheel','left_finger_anchor')]:
  anchor=mouse[key];ks=[-1.,0.,1.] if role=='Wheel' else[0.,1.];p=parameter('ParamMouse'+role,ks)
  def mouse_press(n,x,y,v,a=anchor,role=role):
   shape=math.exp(-((x-a[0])/22)**2-((y-a[1])/28)**2);fixed_center=1-math.exp(-((x-ref[0])/12)**2-((y-ref[1])/12)**2)
   return (0.,(2 if role=='Wheel' else 4)*v*shape*fixed_center)
  deform(p,['MouseHandL']+(['MouseBody'] if 'MouseBody' in nodes else[]),ks,mouse_press)
 typing_contract=None
 if press:
  finger=press['finger_anchor'];hn=nodes['TypingHandR'];hn['mesh']['verts']=[v for x,y in coords['TypingHandR'] for v in [x-finger[0],y-finger[1]]];hn['transform']={'trans':[finger[0]-origin[0],finger[1]-origin[1],0.],'rot':[0.,0.,0.],'scale':[1.,1.]}
  for axis,limit in [('X',W),('Y',H)]:
   a=0 if axis=='X' else 1;ks=sorted(set([0.,float(finger[a]),float(limit)]));p=parameter('ParamTypingHandR'+axis,ks,finger[a]);scalar(p,['TypingHandR'],[v-finger[a] for v in ks],'transform.t.'+axis.lower())
  p=parameter('ParamTypingHandRAngle',[-math.pi,0.,math.pi]);scalar(p,['TypingHandR'],[-math.pi,0.,math.pi],'transform.r.z')
  sleeve=polar(press,'TypingSleeveBridgeR','TypingSleeveR');p=parameter('ParamTypingActive',[0.,1.]);scalar(p,['RaisedHandR','RaisedSleeveR'],[1,0]);scalar(p,['TypingHandR','TypingSleeveBridgeR'],[0,1]);p=parameter('ParamTypingPressR',[0.,1.])
  # Knuckle curl vanishes exactly at the fingertip and cuff anchors. Contact is
  # owned by the homography-mapped XY target, preventing double depression.
  cuff=press['bridge_moving_anchor'];center=[(finger[0]+cuff[0])/2,(finger[1]+cuff[1])/2]
  def curl(n,x,y,v):
   f=1-math.exp(-((x-finger[0])/12)**2-((y-finger[1])/12)**2);c=1-math.exp(-((x-cuff[0])/16)**2-((y-cuff[1])/16)**2);g=math.exp(-((x-center[0])/30)**2-((y-center[1])/35)**2);return(0.,3*v*f*c*g)
  deform(p,['TypingHandR'],[0.,1.],curl);typing_contract={'screenSide':'right','contactNode':'TypingHandR','contactLocal':[0.,0.],'handNode':'TypingHandR','bridgeNode':'TypingSleeveBridgeR','restHandNode':'RaisedHandR','restBridgeNode':'RaisedSleeveR','activeParameter':'ParamTypingActive','reference':finger,'fingerAnchor':finger,'wristAnchor':press['wrist_anchor'],'pressTravel':[0.,0.],'parameters':{'x':'ParamTypingHandRX','y':'ParamTypingHandRY','press':'ParamTypingPressR','angle':'ParamTypingHandRAngle'},'orientation':'point-cuff-toward-fixed','sleeve':sleeve}
 contract=json.loads((HERE/'rig-contract.schema-draft.json').read_text());contract.update(status='registered candidate; native validation pending',canvas=[W,H],origin=origin,defaultWindowWidth=700,typingHand=typing_contract)
 contract['keyboard'].update(quad=meta['keyboard_quad'])
 def solve(rows,rhs):
  a=[list(map(float,r))+[float(v)] for r,v in zip(rows,rhs)];n=len(a)
  for k in range(n):
   pivot=max(range(k,n),key=lambda i:abs(a[i][k]));a[k],a[pivot]=a[pivot],a[k];assert abs(a[k][k])>1e-12;v=a[k][k];a[k]=[x/v for x in a[k]]
   for i in range(n):
    if i!=k:
     v=a[i][k];a[i]=[x-v*y for x,y in zip(a[i],a[k])]
  return [r[-1] for r in a]
 rows=[];rhs=[]
 for (x,y),(u,v) in zip([(0,0),(600,0),(600,360),(0,360)],meta['mouse_quad']):rows.extend([[x,y,1,0,0,0,-u*x,-u*y],[0,0,0,x,y,1,-v*x,-v*y]]);rhs.extend([u,v])
 hh=solve(rows,rhs)+[1.];u,v=ref;home=solve([[u*hh[6]-hh[0],u*hh[7]-hh[1]],[v*hh[6]-hh[3],v*hh[7]-hh[4]]],[hh[2]-u,hh[5]-v])
 contract['mouse'].update(quad=meta['mouse_quad'],logicalSize=[600,360],home=home,travel={'min':[home[0]-80,home[1]-50],'max':[home[0]+80,home[1]+50]},bodyNode='MouseBody' if 'MouseBody' in nodes else None,bodyInModel='MouseBody' in nodes)
 contract['mouseHand'].update(contactNode='MouseBody',contactLocal=[ref[0]-origin[0],ref[1]-origin[1]],reference=ref,wristAnchor=mouse['wrist_anchor'],leftFingerAnchor=mouse['left_finger_anchor'],rightFingerAnchor=mouse['right_finger_anchor'],sleeve=mouse_sleeve)
 contract['defaultFace']={'ParamEyeLOpen':1.,'ParamEyeROpen':1.,'ParamMouthOpenY':1.}
 contract['frontNodes']=[n['name'] for n in m['nodes']['children'] if n['zsort'] < -12.]
 (HERE/'rig-contract.json').write_text(json.dumps(contract,indent=2)+'\n')
 write_model(HERE/'WhaleGirl-work-DRAFT.inx',m,textures)
 report={'status':'Registered draft; no native export claim','canvas':[W,H],'origin':origin,'parts':len(nodes),'parameters':[p['name'] for p in m['param']],'source':str(art),'keyboard':meta['keyboard_quad'],'mouse':meta['mouse_quad'],'typingHand':typing_contract,'mouseSleeve':mouse_sleeve,'decodedTexturePixels':sum(Image.open(io.BytesIO(t)).width*Image.open(io.BytesIO(t)).height for t in textures),'pending':['downhand and complete device/face registration approval','continuous blink/input tests','native Creator export']};(HERE/'authoring.json').write_text(json.dumps(report,indent=2)+'\n');print(HERE/'WhaleGirl-work-DRAFT.inx',len(nodes),'parts',len(m['param']),'params',report['decodedTexturePixels'],'pixels')
if __name__=='__main__':build(pathlib.Path(sys.argv[1]).resolve(),*[pathlib.Path(p).resolve() for p in sys.argv[2:]])
