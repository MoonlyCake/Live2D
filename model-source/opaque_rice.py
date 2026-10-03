"""Patch only the isolated packed candidate; retain every source texture byte.
Import apply_opaque_rice_fix(model) into final builder after rice parameters exist.
"""
import copy,json,math,pathlib,struct,sys

def apply_opaque_rice_fix(model):
    nodes={n['name']:n for n in model['nodes']['children']}
    p=next(p for p in model['param'] if p['name']=='ParamRiceBowlOpacity')
    rice=['RiceElbowBridgeL','RiceElbowBridgeR','RiceHoldingArmBowl','RiceSpoonArmEmpty','RiceBite']
    ids={nodes[n]['uuid'] for n in rice}
    assert all(b['param_name']=='opacity' and b['node'] in ids for b in p['bindings'])
    p['bindings']=[]
    # This control is now a short opaque retraction, not an alpha fade.
    # Runtime must lower RiceArm to zero before reducing this value, then
    # exclusively switch PoseSwitch to zero. The final switch remains discrete.
    for name in rice:
        n=nodes[name];right=name in ['RiceElbowBridgeR','RiceSpoonArmEmpty','RiceBite']
        pivot=(793,783) if right else (451,802)
        verts=n['mesh']['verts'];origin=n['mesh']['origin'];points=[(verts[i]-origin[0]+627,verts[i+1]-origin[1]+627) for i in range(0,len(verts),2)]
        if name in ['RiceSpoonArmEmpty','RiceBite']:
            base=next(b for q in model['param'] if q['name']=='ParamRiceArm' for b in q['bindings'] if b['node']==n['uuid'])['values'][0][0]
            points=[(x+d[0],y+d[1]) for (x,y),d in zip(points,base)]
        values=[]
        for v in [0.,1.]:
            angle=math.radians(-2 if right else 2)*(1-v);c,s=math.cos(angle),math.sin(angle)
            values.append([[[ (x-pivot[0])*(c-1)-(y-pivot[1])*s, (x-pivot[0])*s+(y-pivot[1])*(c-1)] for x,y in points]])
        p['bindings'].append({'node':n['uuid'],'param_name':'deform','values':values,'isSet':[[True],[True]],'interpolate_mode':'Linear'})
    return model

if __name__=='__main__':
    src=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else 'model-source/WhaleGirl-full-packed-DRAFT.inx');raw=src.read_bytes();n=struct.unpack('>I',raw[8:12])[0];model=json.loads(raw[12:12+n]);apply_opaque_rice_fix(model);payload=json.dumps(model,separators=(',',':')).encode();out=pathlib.Path('model-source/extras-candidate/WhaleGirl-opaque-rice-candidate.inx');out.write_bytes(raw[:8]+struct.pack('>I',len(payload))+payload+raw[12+n:]);print(out)
