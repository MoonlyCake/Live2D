"""Lossless packaging optimization: crop transparent padding and remap UVs.
Does not resize, repaint, or overwrite any source artwork. Mesh positions and all
keyframes remain unchanged. Original authoring textures remain in source INX.
"""
import io,json,pathlib,struct,sys
from PIL import Image
ROOT=pathlib.Path(__file__).resolve().parent
src=pathlib.Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/'WhaleGirl-core-DRAFT.inx'; b=src.read_bytes(); n=struct.unpack('>I',b[8:12])[0];model=json.loads(b[12:12+n]);p=12+n;assert b[p:p+8]==b'TEX_SECT';p+=8;count=struct.unpack('>I',b[p:p+4])[0];p+=4;textures=[];report=[];total=0
for i in range(count):
 size=struct.unpack('>I',b[p:p+4])[0];p+=4;typ=b[p];p+=1;raw=b[p:p+size];p+=size;assert typ==0
 im=Image.open(io.BytesIO(raw)).convert('RGBA');w,h=im.size;box=im.getbbox();assert box
 l,t,r,d=box;l=max(0,l-2);t=max(0,t-2);r=min(w,r+2);d=min(h,d+2);cropped=im.crop((l,t,r,d));cw,ch=cropped.size
 restored=Image.new('RGBA',im.size);restored.paste(cropped,(l,t))
 assert restored.getchannel('A').tobytes()==im.getchannel('A').tobytes()
 for a,z in zip(im.getdata(),restored.getdata()):
  if a[3]:assert a==z
 buf=io.BytesIO();cropped.save(buf,format='PNG');textures.append(buf.getvalue());total+=cw*ch
 for node in model['nodes']['children']:
  if node['textures'][0]!=i:continue
  uv=node['mesh']['uvs'];mapped=[(v*w-l)/cw if j%2==0 else (v*h-t)/ch for j,v in enumerate(uv)]
  assert all(-1e-12<=v<=1+1e-12 for v in mapped)
  node['mesh']['uvs']=[max(0.,min(1.,v)) for v in mapped]
 report.append({'texture':i,'source_size':[w,h],'pixel_crop':[l,t,r,d],'packed_size':[cw,ch],'visible_pixel_mismatch':0,'alpha_pixel_mismatch':0})
assert total<=32_000_000
j=json.dumps(model,separators=(',',':')).encode();out=b'TRNSRTS\0'+struct.pack('>I',len(j))+j+b'TEX_SECT'+struct.pack('>I',count)
for raw in textures:out+=struct.pack('>I',len(raw))+b'\0'+raw
path=pathlib.Path(sys.argv[2]) if len(sys.argv)>2 else ROOT/'WhaleGirl-core-packed-DRAFT.inx';path.write_bytes(out)
path.with_suffix('.packing.json').write_text(json.dumps({'status':'lossless packaging checked, native visual approval pending','source':src.name,'output':path.name,'total_decoded_pixels':total,'rgba_bytes':total*4,'mesh_positions_and_bindings_unchanged':True,'source_art_untouched':True,'textures':report},indent=2)+'\n')
print(path,len(out),'decoded pixels',total)
