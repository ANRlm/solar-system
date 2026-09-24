// GLSL：噪声库、程序化纹理生成器、天体渲染与后期处理

export const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute(vec4 x){return mod289(((x*34.)+1.)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1./6.,1./3.);const vec4 D=vec4(0.,.5,1.,2.);
  vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
  float n_=.142857142857;vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.*x_);
  vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.+1.;vec4 s1=floor(b1)*2.+1.;vec4 sh=-step(h,vec4(0.));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);m=m*m;
  return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p,int o){float s=0.,a=.5;for(int i=0;i<o;i++){s+=a*snoise(p);p=p*2.02+vec3(3.1,1.7,4.3);a*=.5;}return s;}
float ridged(vec3 p,int o){float s=0.,a=.5,w=1.;for(int i=0;i<o;i++){float n=1.-abs(snoise(p));n*=n*w;w=clamp(n*2.,0.,1.);s+=n*a;p=p*2.03+vec3(1.3,7.1,2.9);a*=.5;}return s;}
vec3 hash33(vec3 p){p=fract(p*vec3(.1031,.1030,.0973));p+=dot(p,p.yxz+33.33);return fract((p.xxy+p.yxx)*p.zyx);}
float hash12(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
float sq(float x){return x*x;}
float ss(float a,float b,float x){float t=clamp((x-a)/(b-a),0.,1.);return t*t*(3.-2.*t);}
`;

// 对数深度缓冲：远近尺度跨越 6 个数量级
const LOGV = '#include <common>\n#include <logdepthbuf_pars_vertex>\n';
const LOGF = '#include <logdepthbuf_pars_fragment>\n';

export const FS_VERT = /* glsl */ `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`;

// ---------------------------------------------------------------- 纹理生成（等距圆柱投影）
export const GEN_FRAG = /* glsl */ `
uniform sampler2D uMask,uReal,uReal2,uReal3;
uniform vec3 uNGP,uGC,uCol1,uCol2;
uniform vec2 uGrade;
uniform int uFeat;
uniform float uCrat,uSeed;
varying vec2 vUv;
#define PI 3.14159265359
#define C(r,g,b) pow(vec3(r,g,b),vec3(2.2))
${NOISE}
vec3 ll(float la,float lo){la=radians(la);lo=radians(lo);return vec3(cos(lo)*cos(la),sin(la),-sin(lo)*cos(la));}
float angd(vec3 a,vec3 b){return degrees(acos(clamp(dot(a,b),-1.,1.)));}
float lum(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
// 影像亮度的高通分量作伪高度：保留撞击坑等小尺度明暗起伏，去掉大尺度反照率差异
float relief(sampler2D t,vec2 uv){return lum(texture(t,uv).rgb)-lum(textureLod(t,uv,3.5).rgb);}
float smin(float a,float b,float k){float h=clamp((b-a+k)/(2.*k),0.,1.);return a*h+b*(1.-h)-k*h*(1.-h);}
// 撞击坑：x 高度，y 新鲜溅射物亮度
vec2 craters(vec3 p,float freq,float dens,float seed){
  vec3 q=p*freq,id=floor(q),f=fract(q);vec2 acc=vec2(0.);
  for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++)for(int z=-1;z<=1;z++){
    vec3 c=vec3(x,y,z),h=hash33(id+c+seed);
    if(h.x>dens)continue;
    vec3 o=hash33(id+c+seed+19.19);
    float rad=.1+.32*h.y*h.y;
    float d=length(c+o-f)/rad;
    if(d>2.4)continue;
    float cav=d*d-1.,rx=min(d-1.8,0.),rim=.35*rx*rx;
    float s=-smin(-smin(cav,rim,.25),.6,.2);
    acc.x+=s*rad;
    acc.y+=step(.82,h.z)*exp(-d*d*.35)*(1.-exp(-d*d*4.))*.8+step(.82,h.z)*step(d,1.)*.25;
  }
  return acc;
}
void main(){
  float phi=vUv.x*2.*PI,th=(1.-vUv.y)*PI;
  vec3 p=vec3(-cos(phi)*sin(th),cos(th),sin(phi)*sin(th));
  float lat=degrees(PI*.5-th),lon=degrees(phi)-180.;
  vec3 col=vec3(.5);float h=.5;vec4 extra=vec4(0.,0.,0.,1.);
#if defined(MERCURY)||defined(MARS)
  // 两极的经纬网格会把高通分量拉成条纹，高纬度淡出
  col=texture(uReal,vUv).rgb;
  h=.5+clamp(relief(uReal,vUv),-.12,.12)*RELIEF*(1.-ss(66.,80.,abs(lat)));
#elif defined(MOON)
  col=texture(uReal,vUv).rgb;
  h=texture(uReal2,vUv).r*.8+.1+relief(uReal,vUv)*.15;
#elif defined(EARTH)
  col=texture(uReal,vUv).rgb;
  // 海陆掩膜先模糊并按噪声扭曲采样位置，避免 2048 像素掩膜在近景出现锯齿海岸
  vec2 muv=vec2(vUv.x,1.-vUv.y),px=vec2(1./2048.,1./1024.);
  vec2 wuv=muv+vec2(fbm(p*30.,4),fbm(p*30.+7.,4))*px*2.5;
  float m=(texture(uMask,wuv).r*2.+texture(uMask,wuv+vec2(px.x,0.)).r+texture(uMask,wuv-vec2(px.x,0.)).r+texture(uMask,wuv+vec2(0.,px.y)).r+texture(uMask,wuv-vec2(0.,px.y)).r)/6.;
  float water=(1.-ss(.42,.58,m))*(1.-ss(78.,84.,lat))*(1.-ss(-68.,-72.,lat));
  // 贴图里的海洋偏亮偏艳；大气散射会再补一层蓝，这里压暗成深海色
  col=mix(col,col*vec3(.42,.5,.62),water);
  #ifdef PASS_B
  extra=vec4(ss(.04,.92,texture(uReal3,vUv).r),sqrt(lum(texture(uReal2,vUv).rgb)),water,1.);
  #endif
#elif defined(JUPITER)||defined(SATURN)||defined(VENUS)||defined(URANUS)||defined(NEPTUNE)
  col=texture(uReal,vUv).rgb;
#elif defined(IO)
  float n=fbm(p*3.,6),n2=fbm(p*12.,4);
  col=mix(C(.92,.84,.42),C(.95,.93,.80),ss(.05,.4,n));
  col=mix(col,C(.80,.50,.22),ss(.2,.5,fbm(p*5.+vec3(4.),5))*.7);
  col=mix(col,C(.55,.40,.25),ss(55.,75.,abs(lat))*.6);
  vec3 q=p*9.,id=floor(q),f=fract(q);float spot=0.,ring=0.;
  for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++)for(int z=-1;z<=1;z++){vec3 c=vec3(x,y,z),hh=hash33(id+c);if(hh.x>.35)continue;
    float d=length(c+hh-f)/(.06+.12*hh.y);spot=max(spot,ss(1.,.6,d+n2*.3));ring=max(ring,ss(.7,0.,abs(d-2.4+n2*1.6))*step(.93,hh.z)*ss(-.2,.4,n2));}
  float pele=angd(p,ll(-18.7,104.7));
  ring=max(ring,ss(1.6,0.,abs(pele-6.+n2*2.))*.9);
  col=mix(col,C(.75,.28,.12),ring*.8);
  col=mix(col,C(.12,.09,.06),spot);
  h=.5+n*.1-spot*.05;
#elif defined(EUROPA)
  float n=fbm(p*3.,5);
  col=mix(C(.88,.84,.76),C(.72,.60,.48),ss(.1,.5,fbm(p*2.+vec3(3.),5))*.8);
  float lin=0.;
  for(int i=0;i<4;i++){vec3 o=hash33(vec3(float(i),1.,2.))*10.;lin=max(lin,pow(max(1.-abs(snoise(p*(2.+float(i)*1.7)+o+fbm(p*6.+o,3)*.3)),0.),28.));}
  col=mix(col,C(.55,.36,.24),lin*.8);
  col=mix(col,C(.62,.46,.34),ss(.35,.6,fbm(p*6.+vec3(9.),4))*.5);
  h=.5+lin*.04+n*.03;
#elif defined(GANYMEDE)
  float n=fbm(p*2.5,6);
  float dk=ss(-.05,.15,fbm(p*1.5+vec3(5.),5));
  float groove=sin(dot(p,normalize(vec3(1.,.3,.7)))*140.+fbm(p*8.,4)*14.)*.5+.5;
  col=mix(C(.66,.63,.58)*(.92+.12*groove),C(.36,.33,.30),dk);
  vec2 c1=craters(p,6.,.4,1.),c2=craters(p,16.,.4,2.),c3=craters(p,40.,.35,3.);
  h=.5+(c1.x*.4+c2.x*.25+c3.x*.14)+groove*.02*(1.-dk);
  col=mix(col,C(.85,.84,.82),clamp(c1.y+c2.y+c3.y,0.,1.)*.6);
  col=mix(col,C(.82,.82,.84),ss(55.,75.,abs(lat))*.4);
#elif defined(CALLISTO)
  float n=fbm(p*3.,6);
  col=C(.32,.29,.25)*(.85+.3*(n*.5+.5));
  vec2 c1=craters(p,5.,.6,1.),c2=craters(p,12.,.6,2.),c3=craters(p,28.,.6,3.),c4=craters(p,64.,.55,4.);
  h=.5+c1.x*.45+c2.x*.3+c3.x*.18+c4.x*.1;
  col=mix(col,C(.80,.78,.74),clamp(c1.y+c2.y+c3.y+c4.y,0.,1.)*.75);
  float vh=angd(p,ll(18.,-56.));
  col=mix(col,C(.62,.60,.56),ss(3.,0.,abs(mod(vh,4.)-2.))*ss(30.,5.,vh)*.4);
#elif defined(ICY)
  // 参数化冰质 / 岩质小天体：底色 + 多尺度撞击坑，再按 uFeat 叠加标志性地貌
  float n=fbm(p*3.+uSeed,6),n2=fbm(p*11.+uSeed*1.7,4);
  vec2 c1=craters(p,4.,.45,uSeed),c2=craters(p,10.,.5,uSeed+1.),c3=craters(p,24.,.5,uSeed+2.),c4=craters(p,56.,.45,uSeed+3.);
  col=mix(pow(uCol1,vec3(2.2)),pow(uCol2,vec3(2.2)),ss(-.35,.45,n))*(.9+.2*(n2*.5+.5));
  h=.5+(c1.x*.5+c2.x*.34+c3.x*.22+c4.x*.12)*uCrat+n*.05;
  col=mix(col,col*1.3+.03,clamp(c2.y+c3.y+c4.y*.7,0.,1.)*.45*min(uCrat,1.));
  if(uFeat==1){ // 土卫一：赫歇尔撞击坑（半径约 20°）
    float d=angd(p,ll(-1.7,-111.8))/20.;
    h+=-.3*(1.-ss(.0,1.,d))+.12*exp(-sq((d-1.)/.12))+.1*exp(-d*d*90.);
    col*=1.-.12*ss(1.1,.5,d);
  }else if(uFeat==2){ // 土卫二：年轻平滑的南半球与蓝色“虎纹”
    h=mix(h,.5+n*.02,ss(-25.,-55.,lat));
    float st=pow(ss(.55,1.,abs(sin(dot(p.xz,vec2(.8,.6))*22.+fbm(p*5.,3)*2.))),6.)*ss(-60.,-72.,lat);
    col=mix(col,pow(vec3(.45,.62,.82),vec3(2.2)),st*.85);h-=st*.04;
  }else if(uFeat==3){ // 土卫八：前导半球漆黑的卡西尼区 + 赤道山脊
    float lead=dot(p,ll(0.,-90.));
    float dark=ss(-.15,.2,lead+n*.25)*ss(62.,38.,abs(lat)+n*10.);
    col=mix(col,pow(vec3(.2,.14,.1),vec3(2.2)),dark);
    h+=.16*exp(-sq(lat/1.3))*ss(-.3,.2,lead);
  }else if(uFeat==4){ // 土卫四：后随半球的明亮冰崖细纹
    float trail=ss(.1,.6,dot(p,ll(0.,90.)));
    float w=pow(max(1.-abs(snoise(p*vec3(7.,2.5,7.)+vec3(n))),0.),14.)+pow(max(1.-abs(snoise(p*vec3(13.,4.,13.)+vec3(n2))),0.),18.)*.6;
    col*=mix(1.,.82,trail);col=mix(col,pow(vec3(.96,.96,.97),vec3(2.2)),clamp(w,0.,1.)*trail);
  }else if(uFeat==5){ // 土卫三 / 天卫一 / 天卫三：绵长的峡谷
    vec3 nc=normalize(vec3(.35,.85,.25)+hash33(vec3(uSeed))*.4-.2);
    float cn=ss(.05,.012,abs(dot(p,nc))+n2*.015);
    h-=.22*cn;col*=1.-.15*cn;
    float od=angd(p,ll(32.8,-128.9))/22.;
    h+=(-.22*(1.-ss(0.,1.,od))+.08*exp(-sq((od-1.)/.15)))*step(uSeed,1.5);
  }else if(uFeat==6){ // 天卫五：冠状地形，一圈圈明暗相间的环带
    float cor=0.;
    for(int i=0;i<3;i++){vec3 c=ll(-40.+float(i)*35.,-160.+float(i)*95.);float d=angd(p,c);cor=max(cor,ss(38.,20.,d)*(.5+.5*sin(d*1.6+n*3.)));}
    col=mix(col,pow(uCol2*.8,vec3(2.2)),cor*.7);h+=cor*.05;
  }else if(uFeat==7){ // 天卫二：温达坑的明亮环
    float d=angd(p,ll(-7.9,-86.4));
    col=mix(col,pow(vec3(.82,.81,.8),vec3(2.2)),exp(-sq((d-4.5)/.9)));
  }else if(uFeat==8){ // 海卫一：哈密瓜地形与带暗色喷流条纹的南极冠
    vec3 q=p*16.,id=floor(q),f=fract(q);float dm=9.;
    for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++)for(int z=-1;z<=1;z++){vec3 c=vec3(x,y,z);dm=min(dm,length(c+hash33(id+c)-f));}
    h+=ss(.2,.6,dm)*.05*ss(-5.,10.,lat);
    float cap=ss(-5.,-20.,lat+n*12.);
    col=mix(col*(.9+.2*ss(.2,.6,dm)),pow(vec3(.95,.88,.86),vec3(2.2)),cap);
    float plume=pow(max(snoise(vec3(p.x*9.+p.z*9.,p.y*2.,uSeed)),0.),3.)*cap;
    col=mix(col,pow(vec3(.35,.28,.26),vec3(2.2)),plume*.8);
  }else if(uFeat==9){ // 冥王星：心形汤博区（西瓣斯普特尼克平原）、克苏鲁暗区、北极黄灰色
    // 斯普特尼克平原（西瓣，约 1050×800 km）与东瓣共同构成宽约 1600 km 的“心”
    vec3 sc=ll(22.,176.),se=normalize(cross(vec3(0.,1.,0.),sc)),sn=cross(sc,se);
    float sp=ss(1.08,.82,length(vec2(dot(p-sc,se)/radians(26.),dot(p-sc,sn)/radians(21.)))+n*.22);
    float east=ss(1.,.62,angd(p,ll(-2.,214.))/30.+n*.3);
    float cth=ss(1.,.6,length(vec2((lon-95.)/62.,(lat+3.)/20.))+n*.35);
    col=mix(col,pow(vec3(.30,.15,.10),vec3(2.2)),cth*.9);
    col=mix(col,pow(vec3(.84,.74,.62),vec3(2.2)),ss(50.,75.,lat)*.7);
    col=mix(col,pow(vec3(.92,.90,.88),vec3(2.2)),east*.6);
    col=mix(col,pow(vec3(.97,.96,.95),vec3(2.2)),sp);
    h=mix(h,.42,sp)+ridged(p*9.,4)*.1*ss(.3,.9,east+cth);
  }else if(uFeat==10){ // 冥卫一：北极红褐色魔多斑、赤道峡谷带
    col=mix(col,pow(vec3(.46,.28,.2),vec3(2.2)),ss(58.,78.,lat+n*10.));
    float cn=ss(4.,.5,abs(lat-5.+n*6.));h-=.12*cn;col*=1.-.08*cn;
  }else if(uFeat==11){ // 谷神星：奥卡托坑明亮的盐类沉积、阿胡纳山
    float oc=angd(p,ll(19.8,-120.7));
    h+=-.15*(1.-ss(3.,5.5,oc))+.05*exp(-sq((oc-5.5)/.6));
    col=mix(col,pow(vec3(.96,.96,.94),vec3(2.2)),exp(-sq(oc/.8))+exp(-sq(angd(p,ll(19.,-118.5))/.5))*.8);
    float ah=angd(p,ll(-10.5,-43.8));h+=.25*exp(-sq(ah/1.6));col=mix(col,pow(vec3(.7,.7,.68),vec3(2.2)),exp(-sq(ah/1.8))*.5);
  }else if(uFeat==12||uFeat==13){ // 火卫一 / 火卫二：平行沟槽；火卫一另有斯蒂克尼坑
    float g=pow(abs(sin(dot(p,normalize(vec3(.2,1.,.15)))*55.+n*2.5)),10.)*float(uFeat==12);
    h-=.03*g;col*=1.-.1*g;
    float st=angd(p,ll(-1.,-49.))/23.;
    h+=(-.35*(1.-ss(0.,1.,st))+.1*exp(-sq((st-1.)/.15)))*float(uFeat==12);
    col=mix(col,col*1.25,ss(1.2,.4,st)*.4*float(uFeat==12));
  }
#elif defined(COMET)
  float n=fbm(p*3.,6);
  vec2 c1=craters(p,5.,.4,1.),c2=craters(p,14.,.4,2.);
  col=C(.16,.15,.14)*(.75+.5*(n*.5+.5));
  h=.5+n*.25+c1.x*.3+c2.x*.2;
#elif defined(TITAN)
  float n=fbm(p*3.,6);
  col=mix(C(.74,.53,.27),C(.60,.42,.22),ss(-.1,.3,n)*ss(35.,15.,abs(lat)));
  col=mix(col,C(.52,.38,.22),ss(70.,78.,lat)*ss(.1,.3,fbm(p*6.,4))*.6);
  h=.5+n*.05;
#elif defined(SKY)
  // 场景方向 → 赤道坐标，采样真实银河轮廓，叠加程序化尘埃带与星云
  vec3 e=vec3(p.x,-p.z,p.y);
  const float eps=.40909280;
  vec3 q=vec3(e.x,e.y*cos(eps)-e.z*sin(eps),e.y*sin(eps)+e.z*cos(eps));
  float ra=atan(q.y,q.x),dec=asin(clamp(q.z,-1.,1.));
  vec2 muv=vec2(ra/(2.*PI)+.5,.5-dec/PI);
  float mw=textureLod(uMask,muv,1.).r,mwb=textureLod(uMask,muv,3.).r;
  float b=degrees(asin(clamp(dot(p,uNGP),-1.,1.)));
  float gc=dot(p,uGC),gca=acos(clamp(gc,-1.,1.));
  float n=fbm(p*5.,6)*.5+.5,nf=fbm(p*22.,5)*.5+.5;
  float band=exp(-sq(b/(7.+7.*max(gc,0.))));
  float bulge=exp(-sq(gca/.32))*exp(-sq(b/9.));
  float dust=ss(.45,.75,fbm(p*8.+vec3(3.),6)*.5+.5+.15*ridged(p*14.,4))*exp(-sq(b/(3.+3.*max(gc,0.))));
  float I=(mw*.9+mwb*.5)*(.5+.7*n)*(.65+.5*nf)+band*.18*n+bulge*.6;
  I*=1.-dust*.7;
  vec3 cw=mix(vec3(.62,.70,1.),vec3(1.,.82,.60),clamp(bulge*1.5+.35*max(gc,0.),0.,1.));
  float neb=ss(.6,.85,fbm(p*4.+vec3(9.),5)*.5+.5)*band;
  col=cw*I*.06+vec3(.85,.18,.22)*neb*.02+vec3(.25,.35,.95)*ss(.65,.9,fbm(p*3.+vec3(1.),4)*.5+.5)*band*.008;
  col+=vec3(.0007,.0009,.0016);
  gl_FragColor=vec4(sqrt(clamp(col*12.,0.,1.)),1.);
  return;
#endif
  col=mix(vec3(lum(col)),col,uGrade.y)*uGrade.x;
#ifdef PASS_B
  gl_FragColor=extra;
#else
  gl_FragColor=vec4(sqrt(clamp(col,0.,1.)),clamp(h,0.,1.));
#endif
}`;

// ---------------------------------------------------------------- 行星表面
export const PLANET_VERT = /* glsl */ `${LOGV}
varying vec2 vUv;varying vec3 vLocal,vPos;
#ifdef LUMPY
uniform vec4 uLumpy;uniform float uNeck;
#endif
void main(){vUv=uv;vLocal=position;vec3 pos=position;
#ifdef LUMPY
vec3 q=position;
float k=1.+uLumpy.w*(sin(q.x*3.1+1.3)*sin(q.y*2.7+.4)*sin(q.z*3.3+2.1)*.8+sin(q.x*6.3+q.y*5.1+1.)*sin(q.z*5.7+.3)*.35);
k*=1.-uNeck*exp(-q.x*q.x*9.);
pos=q*uLumpy.xyz*k;
#endif
vec4 wp=modelMatrix*vec4(pos,1.);vPos=wp.xyz;
gl_Position=projectionMatrix*viewMatrix*wp;
#include <logdepthbuf_vertex>
}`;

export const PLANET_FRAG = /* glsl */ `${LOGF}
uniform sampler2D uMapA,uMapB,uRingTex;
uniform vec2 uTexel;
uniform vec3 uSunPos,uSunCol,uSunRel;uniform float uSunRn,uSunI;
uniform mat3 uRot;uniform vec3 uCenter;uniform float uRadius;
uniform float uBump,uAmbient,uCloudShift,uLights;
uniform vec4 uOcc[4];uniform float uOccAtm[4];uniform int uOccN;
uniform vec3 uRingN;uniform vec2 uRingR;
uniform vec3 uShinePos,uShineCol;
varying vec2 vUv;varying vec3 vLocal,vPos;
${NOISE}
// 太阳作为面光源的软阴影（日食 / 卫星凌日影）；有大气的遮挡体在本影中透出折射红光
vec3 eclipse(vec3 P){
  vec3 light=vec3(1.);
  vec3 toS=uSunRel-P;float dS=length(toS);vec3 sd=toS/dS;float as=asin(min(uSunRn/dS,1.));
  for(int i=0;i<4;i++){
    if(i>=uOccN)break;
    vec3 toC=uOcc[i].xyz-P;float dC=length(toC);
    if(dC>=dS||dot(toC,sd)<=0.)continue;
    float ao=asin(min(uOcc[i].w/dC,1.));
    float th=acos(clamp(dot(sd,toC/dC),-1.,1.));
    float occ=ss(as+ao,abs(as-ao),th)*clamp(ao*ao/(as*as),0.,1.);
    light=light*(1.-occ)+vec3(.9,.3,.1)*.26*uOccAtm[i]*occ;
  }
  return light;
}
#ifdef RINGSHADOW
float ringShadow(vec3 P){
  vec3 sd=normalize(uSunPos-P);float dn=dot(sd,uRingN);
  if(abs(dn)<1e-4)return 1.;
  float t=dot(uCenter-P,uRingN)/dn;if(t<=0.)return 1.;
  float r=length(P+sd*t-uCenter)/uRadius;
  if(r<uRingR.x||r>uRingR.y)return 1.;
  return 1.-texture(uRingTex,vec2((r-uRingR.x)/(uRingR.y-uRingR.x),.5)).a*.92;
}
#endif
void main(){
  #include <logdepthbuf_fragment>
  vec3 nL=normalize(vLocal);
  float s=max(length(nL.xz),1e-3);
  vec3 T=vec3(nL.z,0.,-nL.x)/s,B=cross(nL,T);
  float arc=max(length(fwidth(nL)),1e-6);
  // 中心差分，步长至少 1.5 个纹素：避免 8 位高度在近景出现量化台阶；并限制最大坡度
  vec2 du=vec2(max(uTexel.x*1.5,arc/(6.2831853*s)),max(uTexel.y*1.5,arc/3.14159265));
  vec4 A=texture(uMapA,vUv);
  float hx=texture(uMapA,vUv+vec2(du.x,0.)).a-texture(uMapA,vUv-vec2(du.x,0.)).a,hy=texture(uMapA,vUv+vec2(0.,du.y)).a-texture(uMapA,vUv-vec2(0.,du.y)).a;
  vec2 g=vec2(hx/(2.*du.x*6.2831853*s),hy/(2.*du.y*3.14159265))*uBump;
  g*=min(1.,1.1/max(length(g),1e-4));
  vec3 nP=normalize(nL-g.x*T-g.y*B);
  #ifdef DETAIL
  // 近景微观凹凸：纹理分辨率之外的细节，随像素尺度淡出
  for(int k=0;k<2;k++){
    float f=k==0?900.:2300.;
    float amp=(1.-ss(.25,1.,arc*f))*.1;
    if(amp>0.){float e=.2;vec3 q=nL*f;float n0=snoise(q);
      nP=normalize(nP-amp*((snoise(q+T*e)-n0)*T+(snoise(q+B*e)-n0)*B)/e);}
  }
  #endif
  vec3 N=normalize(uRot*nP),Ng=normalize(uRot*nL);
  #ifdef LUMPY
  // 不规则天体：用屏幕空间导数求真实几何法线，再叠加纹理凹凸
  vec3 fn=normalize(cross(dFdx(vPos),dFdy(vPos)));
  if(dot(fn,cameraPosition-vPos)<0.)fn=-fn;
  N=normalize(fn+N-Ng);Ng=fn;
  #endif
  vec3 L=normalize(uSunPos-vPos),V=normalize(cameraPosition-vPos);
  float NL=dot(N,L),NgL=dot(Ng,L),NV=max(dot(N,V),0.);
  vec3 sun=uSunCol*uSunI*eclipse(Ng);
  #ifdef RINGSHADOW
  sun*=ringShadow(vPos);
  #endif
  #ifdef TINT
  sun*=mix(vec3(1.,.38,.14),vec3(1.),ss(-.02,.3,NgL));
  #endif
  float term=ss(-.04,.1,NgL);
  vec3 albedo=A.rgb*A.rgb;
  float mu0=max(NL,0.);
  vec3 col;
#if defined(ROCK)
  float ls=min(2.*mu0/(mu0+NV+1e-3),1.3);
  col=albedo*mix(mu0,ls,.55)*term*sun;
#elif defined(GAS)
  col=albedo*pow(mu0,.85)*pow(max(NV,.03),-.15)*term*sun;
#elif defined(EARTH)
  vec4 Bs=texture(uMapB,vUv);
  vec2 cuv=vUv+vec2(uCloudShift,0.);
  float cloud=texture(uMapB,cuv).r;
  // 近景云层微细节：超出纹理分辨率的部分用噪声补足
  float cd=1.-ss(.15,.5,arc*650.);
  if(cd>0.){vec3 q=nL*240.+vec3(uCloudShift*40.);cloud=clamp(cloud+(snoise(q)*.6+snoise(q*2.7)*.3*(1.-ss(.1,.4,arc*650.)))*cd*.4*(.15+cloud),0.,1.);}
  vec3 Ll=transpose(uRot)*L;
  vec2 sh=vec2(dot(Ll,T)/(6.2831853*s),dot(Ll,B)/3.14159265)*.0025/max(NgL,.12);
  float csh=texture(uMapB,cuv+sh).r;
  vec3 ground=albedo*mu0*term*(1.-csh*.8);
  vec3 H=normalize(L+V);float NH=max(dot(Ng,H),0.),a2=.012;
  float D=a2/(3.14159*pow(NH*NH*(a2-1.)+1.,2.));
  float F=.02+.98*pow(1.-max(dot(H,V),0.),5.);
  float spec=D*F/(4.*max(dot(Ng,V),.08))*ss(0.,.05,NgL)*Bs.b*(1.-csh);
  vec3 cl=vec3(.96)*(pow(max(NgL,0.),.8)+.04*ss(-.2,.1,NgL));
  col=mix(ground*sun+spec*sun,cl*sun,cloud);
  float night=1.-ss(-.18,.04,NgL);
  col+=vec3(1.,.66,.32)*Bs.g*Bs.g*night*(1.-cloud*.9)*uLights;
#endif
  col+=albedo*(uAmbient+uShineCol*max(dot(Ng,normalize(uShinePos-vPos)),0.));
  gl_FragColor=vec4(col,1.);
}`;

// ---------------------------------------------------------------- 大气单次散射（Rayleigh + Mie）
export const ATMO_VERT = /* glsl */ `${LOGV}
varying vec3 vPos;
void main(){vec4 wp=modelMatrix*vec4(position,1.);vPos=wp.xyz;gl_Position=projectionMatrix*viewMatrix*wp;
#include <logdepthbuf_vertex>
}`;
export const ATMO_FRAG = /* glsl */ `${LOGF}
uniform vec3 uCenter,uSunPos,uSunCol,uBR,uBM;uniform float uR,uRa,uHR,uHM,uG,uI;
varying vec3 vPos;
vec2 rs(vec3 ro,vec3 rd,float r){float b=dot(ro,rd),c=dot(ro,ro)-r*r,h=b*b-c;if(h<0.)return vec2(1e9,-1e9);h=sqrt(h);return vec2(-b-h,-b+h);}
float lsh(vec3 x,vec3 Ls){float t=dot(x,Ls);if(t>0.)return 1.;float b=length(x-Ls*t);return smoothstep(.985,1.012,b);}
void main(){
  #include <logdepthbuf_fragment>
  vec3 ro=(cameraPosition-uCenter)/uR,rd=normalize(vPos-cameraPosition);
  float ra=uRa/uR;
  vec2 ta=rs(ro,rd,ra);if(ta.x>ta.y)discard;
  vec2 tp=rs(ro,rd,1.);
  float t0=max(ta.x,0.),t1=ta.y;if(tp.x<tp.y&&tp.x>0.)t1=min(t1,tp.x);
  if(t1<=t0)discard;
  vec3 Ls=normalize(uSunPos-uCenter);
  float ds=(t1-t0)/float(STEPS);
  vec3 sR=vec3(0.),sM=vec3(0.);float oR=0.,oM=0.;
  for(int i=0;i<STEPS;i++){
    vec3 x=ro+rd*(t0+ds*(float(i)+.5));
    float hh=length(x)-1.;
    float dR=exp(-hh/uHR)*ds,dM=exp(-hh/uHM)*ds;
    oR+=dR;oM+=dM;
    float vis=lsh(x,Ls);if(vis<=0.)continue;
    float tl=rs(x,Ls,ra).y,dl=tl*.25,lR=0.,lM=0.;
    for(int j=0;j<4;j++){float hy=length(x+Ls*dl*(float(j)+.5))-1.;lR+=exp(-hy/uHR)*dl;lM+=exp(-hy/uHM)*dl;}
    vec3 att=exp(-(uBR*(oR+lR)+uBM*1.1*(oM+lM)))*vis;
    sR+=att*dR;sM+=att*dM;
  }
  float mu=dot(rd,Ls),g=uG;
  float pR=.0596831*(1.+mu*mu);
  float pM=.1193662*(1.-g*g)*(1.+mu*mu)/((2.+g*g)*pow(1.+g*g-2.*g*mu,1.5));
  gl_FragColor=vec4((sR*uBR*pR+sM*uBM*pM)*uSunCol*uI,1.);
}`;

// ---------------------------------------------------------------- 行星环
export const RING_VERT = /* glsl */ `${LOGV}
varying vec3 vPos;varying vec2 vXY;
void main(){vXY=position.xz;vec4 wp=modelMatrix*vec4(position,1.);vPos=wp.xyz;gl_Position=projectionMatrix*viewMatrix*wp;
#include <logdepthbuf_vertex>
}`;
export const RING_FRAG = /* glsl */ `${LOGF}
${NOISE}
uniform sampler2D uRingTex;uniform vec2 uRingR;uniform vec3 uSunPos,uSunCol,uN;uniform float uSunI;uniform vec4 uPlanet;
varying vec3 vPos;varying vec2 vXY;
void main(){
  #include <logdepthbuf_fragment>
  float r=length(vXY),t=(r-uRingR.x)/(uRingR.y-uRingR.x);
  if(t<0.||t>1.)discard;
  vec4 rc=texture(uRingTex,vec2(t,.5));
  vec3 alb=rc.rgb*rc.rgb;float a=rc.a;
  float fr=fwidth(r),det=snoise(vec3(r*900.,.5,0.))*(1.-ss(.2,.8,fr*900.))*.6+snoise(vec3(r*2600.,1.5,0.))*(1.-ss(.2,.8,fr*2600.))*.4;
  a=clamp(a*(1.+det*.45),0.,1.);alb*=1.+det*.18;
  vec3 L=normalize(uSunPos-vPos),V=normalize(cameraPosition-vPos);
  float ln=dot(L,uN),vn=dot(V,uN),lit=sqrt(abs(ln));
  vec3 oc=uPlanet.xyz-vPos;float tc=dot(oc,L),sh=1.;
  if(tc>0.)sh=smoothstep(uPlanet.w*.985,uPlanet.w*1.02,length(oc-L*tc));
  float fwd=pow(max(dot(V,-L),0.),6.);
  vec3 c=ln*vn>0.?alb*(.28+.72*lit):alb*((.08+.4*lit)*(1.-a*.7)+fwd*1.6*(1.-a));
  c=c*uSunCol*uSunI*sh+alb*.004;
  gl_FragColor=vec4(c,a);
}`;

// ---------------------------------------------------------------- 太阳
export const SUN_FRAG = /* glsl */ `${LOGF}
uniform float uTime,uI;
varying vec2 vUv;varying vec3 vLocal,vPos;
${NOISE}
float gran(vec3 p,float t){
  vec3 id=floor(p),f=fract(p);float d1=8.,d2=8.;
  for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++)for(int z=-1;z<=1;z++){
    vec3 c=vec3(x,y,z),o=hash33(id+c);o=.5+.42*sin(t*.35+6.2831*o);
    vec3 r=c+o-f;float d=dot(r,r);
    if(d<d1){d2=d1;d1=d;}else if(d<d2)d2=d;
  }
  return sqrt(d2)-sqrt(d1);
}
void main(){
  #include <logdepthbuf_fragment>
  vec3 p=normalize(vLocal);
  vec3 V=normalize(cameraPosition-vPos),N=normalize(vPos);
  float mu=max(dot(N,V),0.);
  float fw=length(fwidth(p));
  float t=uTime;
  float g=gran(p*70.+vec3(0.,t*.01,0.),t);
  float gc=1.-ss(.012,.03,fw);
  float g2=gran(p*170.,t*1.3);
  float gc2=1.-ss(.004,.012,fw);
  float sup=fbm(p*9.+vec3(t*.008),4);
  float lat=abs(p.y);
  float act=ss(.08,.2,lat)*ss(.62,.42,lat);
  float spots=ss(.5,.72,fbm(p*3.2+vec3(17.),4)+.25*act-.1)*act;
  float um=ss(.1,.24,spots),pen=ss(.0,.08,spots);
  float br=1.+(ss(.0,.3,g)-.55)*.5*gc+(ss(0.,.3,g2)-.55)*.22*gc2+sup*.16;
  br*=mix(1.,.45,pen)*mix(1.,.28,um);
  br+=ss(.02,.12,spots)*(1.-pen*.8)*.25*(1.-mu)+ss(.3,.7,fbm(p*20.,3))*.12*pow(1.-mu,2.);
  float ld=1.-.47*(1.-mu)-.23*pow(1.-mu,2.);
  vec3 c=mix(vec3(1.,.24,.02),vec3(1.,.68,.32),pow(mu,.5));
  gl_FragColor=vec4(c*br*ld*uI,1.);
}`;

export const CORONA_VERT = /* glsl */ `${LOGV}
uniform float uSize,uLift;varying vec2 vUv;varying vec3 vOff;
void main(){vUv=position.xy;
vec3 cr=vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]),cu=vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);
vec3 c=(modelMatrix*vec4(0.,0.,0.,1.)).xyz;
vOff=(position.x*cr+position.y*cu)*uSize;vec3 wp=c+vOff+normalize(cameraPosition-c)*uLift;
gl_Position=projectionMatrix*viewMatrix*vec4(wp,1.);
#include <logdepthbuf_vertex>
}`;
export const CORONA_FRAG = /* glsl */ `${LOGF}
uniform float uTime,uI,uK;
varying vec2 vUv;varying vec3 vOff;
${NOISE}
void main(){
  float q=length(vUv),r=q*uK;
  // 四角（q≥1）输出恒为 0；日面以内（r<0.99，球面细分最粗时内切半径仍 >0.994）必被太阳球体挡住——都不必算噪声
  // 边缘留出 2 像素：多重采样时轮廓像素只被球体覆盖一部分，其余采样点仍会显示日冕
  if(q>=1.||r+2.*fwidth(r)<.99)discard;
  #include <logdepthbuf_fragment>
  float a=atan(vUv.y,vUv.x);
  float n=snoise(vec3(cos(a)*2.5,sin(a)*2.5,uTime*.03))*.6+snoise(vec3(cos(a)*9.,sin(a)*9.,uTime*.05+r*.15))*.4;
  float x=max(r-1.,0.);
  float fall=exp(-x*(3.2-1.6*n))*.9+.22/(r*r*r)+exp(-x*1.3)*.025*(1.+n);
  vec3 c=mix(vec3(.92,.94,1.),vec3(1.,.78,.55),exp(-x*3.));
  // 日珥：随太阳本体固定在世界方向上的等离子体细丝；色球层：紧贴边缘的一圈红光
  vec3 dir=normalize(vOff+vec3(1e-5));
  float act=ss(.15,.65,snoise(dir*1.4+vec3(5.,1.,3.)));
  float fil=pow(max(1.-abs(snoise(dir*16.+vec3(x*7.,-x*4.,uTime*.01))),0.),10.);
  float prom=fil*act*exp(-x*7.);
  vec3 col=c*fall+vec3(1.,.3,.12)*prom*2.5+vec3(1.,.4,.22)*exp(-x*80.)*.9;
  gl_FragColor=vec4(col*uI*ss(1.,.55,q),1.);
}`;

// ---------------------------------------------------------------- 星空
export const SKY_VERT = /* glsl */ `varying vec3 vDir;void main(){vDir=position;vec4 c=projectionMatrix*vec4(mat3(viewMatrix)*position,1.);gl_Position=vec4(c.xy,c.w*.99999,c.w);}`;
export const SKY_FRAG = /* glsl */ `uniform sampler2D uSky;uniform float uGain;varying vec3 vDir;
void main(){vec3 d=normalize(vDir);float u=fract(atan(d.z,-d.x)/6.2831853),v=1.-acos(clamp(d.y,-1.,1.))/3.14159265;
vec3 c=textureLod(uSky,vec2(u,v),0.).rgb;gl_FragColor=vec4(c*c/12.*uGain,1.);}`;

export const STAR_VERT = /* glsl */ `
attribute float aI;attribute vec3 aColor;uniform float uPR,uGain;varying vec3 vCol;
void main(){vec4 c=projectionMatrix*vec4(mat3(viewMatrix)*position,1.);gl_Position=vec4(c.xy,c.w*.99999,c.w);
float i=aI*uGain;vCol=aColor*i;gl_PointSize=uPR*(2.2+2.6*sqrt(min(i,4.)));}`;
// 星座连线：与恒星一样在无穷远处，淡蓝细线
export const CONST_VERT = /* glsl */ `void main(){vec4 c=projectionMatrix*vec4(mat3(viewMatrix)*position,1.);gl_Position=vec4(c.xy,c.w*.99999,c.w);}`;
export const CONST_FRAG = /* glsl */ `uniform vec3 uColor;void main(){gl_FragColor=vec4(uColor,1.);}`;
export const STAR_FRAG = /* glsl */ `varying vec3 vCol;
void main(){float d=length(gl_PointCoord-.5)*2.;float a=exp(-d*d*5.)+exp(-d*d*28.)*.6;if(d>1.)discard;gl_FragColor=vec4(vCol*a,1.);}`;

// ---------------------------------------------------------------- 轨道线
// 轨道线：每个点复制成两侧顶点，在屏幕空间沿法线展开成固定像素宽的带（WebGL 原生线宽只有 1 像素）
export const ORBIT_VERT = /* glsl */ `${LOGV}
attribute vec3 aTan;attribute float aPhase,aSide;uniform float uPhase,uWidth;uniform vec2 uRes;varying float vA,vEdge;
void main(){float k=fract(uPhase-aPhase);vA=pow(1.-k,2.2)*.85+.12;vEdge=aSide;
// 屏幕方向由三维切线求得：沿切线走一段与视距成比例的距离再投影，采样再密也不会因浮点误差而翻转
vec4 a=projectionMatrix*modelViewMatrix*vec4(position,1.),b=projectionMatrix*modelViewMatrix*vec4(position+aTan*max(a.w,1e-3)*.02,1.);
vec2 d=(b.xy/max(b.w,1e-4)-a.xy/max(a.w,1e-4))*uRes;
if(a.w>1e-3&&b.w>1e-3&&dot(d,d)>1e-6){d=normalize(d);a.xy+=vec2(-d.y,d.x)*aSide*uWidth*2./uRes*a.w;}
gl_Position=a;
#include <logdepthbuf_vertex>
}`;
export const ORBIT_FRAG = /* glsl */ `${LOGF}
uniform vec3 uColor;uniform float uAlpha;varying float vA,vEdge;
void main(){
#include <logdepthbuf_fragment>
gl_FragColor=vec4(uColor,uAlpha*vA*(1.-smoothstep(.3,1.,abs(vEdge))));}`;

// ---------------------------------------------------------------- 小行星带（顶点着色器内解开普勒方程）
export const ROCK_VERT = /* glsl */ `${LOGV}
attribute vec4 aOrb,aOrb2;attribute vec3 aAxis;attribute float aTone;
uniform float uDays,uDayFrac,uPx;
varying vec3 vN,vPos;varying float vTone,vFade;
vec3 rot(vec3 v,vec3 k,float a){return v*cos(a)+cross(k,v)*sin(a)+k*dot(k,v)*(1.-cos(a));}
void main(){
  float a=aOrb.x,e=aOrb.y,inc=aOrb.z,node=aOrb.w,w=aOrb2.x;
  float M=mod(aOrb2.y+.01720209895/pow(a,1.5)*uDays,6.2831853);
  float E=M+e*sin(M);E-=(E-e*sin(E)-M)/(1.-e*cos(E));
  vec2 xy=vec2(a*(cos(E)-e),a*sqrt(1.-e*e)*sin(E));
  float cw=cos(w),sw=sin(w),cn=cos(node),sn=sin(node),ci=cos(inc),si=sin(inc);
  vec3 ec=vec3((cw*cn-sw*sn*ci)*xy.x+(-sw*cn-cw*sn*ci)*xy.y,(cw*sn+sw*cn*ci)*xy.x+(-sw*sn+cw*cn*ci)*xy.y,sw*si*xy.x+cw*si*xy.y);
  float r=length(ec);
  vec3 c=vec3(ec.x,ec.z,-ec.y)*(60.*pow(r,.55)/r);
  float ang=fract(uDayFrac*aOrb2.w)*6.2831853;
  vN=rot(normal,aAxis,ang);
  float dc=length(c-cameraPosition),sz=max(aOrb2.z,uPx*dc*1.1);
  // 覆盖率淡化（远处放大到最小像素尺寸的碎石）与近距离淡出（贴着镜头掠过时不突然出现大色块）
  vFade=pow(aOrb2.z/sz,2.)*smoothstep(aOrb2.z*8.,aOrb2.z*30.,dc);
  vec4 wp=vec4(c+rot(position*vec3(1.,.7+.3*fract(aTone*7.),.8),aAxis,ang)*sz,1.);
  vPos=wp.xyz;vTone=aTone;
  gl_Position=projectionMatrix*viewMatrix*wp;
  #include <logdepthbuf_vertex>
}`;
export const ROCK_FRAG = /* glsl */ `${LOGF}
uniform vec3 uSunCol,uTintA,uTintB;uniform float uSunI;varying vec3 vN,vPos;varying float vTone,vFade;
void main(){
  #include <logdepthbuf_fragment>
  vec3 alb=mix(uTintA,uTintB,step(.6,vTone))*(.7+.6*fract(vTone*13.));
  float d=max(dot(normalize(vN),normalize(-vPos)),0.);
  gl_FragColor=vec4(alb*(d*uSunCol*uSunI+.01),vFade);
}`;

// ---------------------------------------------------------------- 后期：体积光（屏幕空间径向模糊）
export const RAY_PRE = /* glsl */ `uniform sampler2D tDiffuse;uniform vec2 uSun;uniform float uAspect;varying vec2 vUv;
void main(){vec3 c=texture(tDiffuse,vUv).rgb;float l=max(max(c.r,c.g),c.b);
float m=1.-smoothstep(.0,.55,length((vUv-uSun)*vec2(uAspect,1.)));
gl_FragColor=vec4(c*max(l-1.4,0.)/max(l,1e-4)*m,1.);}`;
export const RAY_BLUR = /* glsl */ `uniform sampler2D tDiffuse;uniform vec2 uSun;uniform float uDensity,uDecay;varying vec2 vUv;
${NOISE}
void main(){vec2 d=(vUv-uSun)*uDensity/float(SAMPLES);vec2 tc=vUv-d*hash12(gl_FragCoord.xy);
float il=1.;vec3 s=vec3(0.);
for(int i=0;i<SAMPLES;i++){tc-=d;s+=texture(tDiffuse,tc).rgb*il;il*=uDecay;}
gl_FragColor=vec4(s/float(SAMPLES),1.);}`;

// ---------------------------------------------------------------- 后期：合成（光晕、色调映射、胶片感）
export const FINAL_FRAG = /* glsl */ `
uniform sampler2D tDiffuse,tRays,tBloom;
uniform vec2 uSun,uRes;uniform float uAspect,uSunVis,uFlare,uRays,uExposure,uTime,uGrain,uVig,uCA,uBloom;
uniform vec3 uOccl[4];
varying vec2 vUv;
${NOISE}
const mat3 IM=mat3(.59719,.07600,.02840,.35458,.90834,.13383,.04823,.01566,.83777);
const mat3 OM=mat3(1.60475,-.10208,-.00327,-.53108,1.10813,-.07276,-.07367,-.00605,1.07602);
// 场景 + 泛光（半分辨率泛光纹理线性采样，rgb·a 即原先加法混合的结果）
vec3 src(vec2 uv){vec4 b=texture(tBloom,uv);return texture(tDiffuse,uv).rgb+b.rgb*(b.a*uBloom);}
vec3 aces(vec3 v){v=IM*v;vec3 a=v*(v+.0245786)-.000090537,b=v*(.983729*v+.432951)+.238081;return clamp(OM*(a/b),0.,1.);}
vec3 flare(vec2 uv){
  vec2 as=vec2(uAspect,1.),p=(uv-.5)*as,s=(uSun-.5)*as;
  vec3 c=vec3(0.);
  vec3 G[6]=vec3[](vec3(.45,.045,.5),vec3(.8,.02,.8),vec3(1.1,.11,.14),vec3(1.45,.06,.3),vec3(-.25,.03,.35),vec3(1.9,.2,.07));
  vec3 GC[6]=vec3[](vec3(.3,.7,1.),vec3(1.,.55,.25),vec3(.4,1.,.55),vec3(.75,.45,1.),vec3(1.,.85,.4),vec3(.35,.55,1.));
  for(int i=0;i<6;i++){float d=length(p+s*G[i].x);float r=G[i].y;
    c+=GC[i]*G[i].z*.6*(ss(r,r*.55,d)*.5+exp(-sq((d-r)/(r*.1)))*.5);}
  vec2 ds=p-s;float rr=length(ds),ang=atan(ds.y,ds.x);
  c+=vec3(1.,.8,.6)*exp(-sq((rr-.34)/.012))*.035*(.6+.4*sin(ang*3.+1.));
  c+=vec3(.4,.6,1.)*exp(-abs(ds.y)*260.)*exp(-abs(ds.x)*1.6)*1.1;
  float burst=snoise(vec3(ang*9.,0.,uTime*.05))*.5+.5;
  c+=vec3(1.,.9,.75)*exp(-rr*9.)*(.25+.75*pow(max(burst,0.),3.))*.5;
  return c;
}
void main(){
  vec2 dc=vUv-.5;
  vec3 col;
  if(uCA>0.){vec2 o=dc*dot(dc,dc)*uCA;col=vec3(src(vUv-o).r,src(vUv).g,src(vUv+o).b);}
  else col=src(vUv);
  // 太空中没有介质：挡在太阳前的天体圆盘内不应出现光束
  float rm=1.;
  for(int i=0;i<4;i++){float r=uOccl[i].z;if(r>0.)rm*=smoothstep(r*.97,r*1.04,length((vUv-uOccl[i].xy)*vec2(uAspect,1.)));}
  col+=texture(tRays,vUv).rgb*uRays*rm;
  if(uSunVis>0.)col+=flare(vUv)*uSunVis*uFlare;
  col=aces(col*uExposure/.6);
  col*=1.-uVig*pow(length(dc*vec2(uAspect,1.))/length(vec2(uAspect,1.)*.5),2.4);
  col=mix(1.055*pow(col,vec3(1./2.4))-.055,col*12.92,step(col,vec3(.0031308)));
  float n=hash12(gl_FragCoord.xy+fract(uTime*7.1)*97.)-.5;
  col+=n*(1./255.+uGrain*(1.-abs(dot(col,vec3(.33))-.5)));
  gl_FragColor=vec4(col,1.);
}`;

// ---------------------------------------------------------------- 彗星：彗发（面向相机的光斑）与彗尾（沿曲线展开、面向相机的带）
export const COMA_FRAG = /* glsl */ `${LOGF}
${NOISE}
uniform float uI,uTime;uniform vec3 uSunward;varying vec2 vUv;varying vec3 vOff;
void main(){
  #include <logdepthbuf_fragment>
  float q=length(vUv);
  vec3 c=mix(vec3(.5,1.,.78),vec3(1.),exp(-q*q*60.));
  float base=exp(-q*q*9.)*.7+exp(-q*3.5)*.3+exp(-q*q*400.)*2.;
  // 向阳侧的喷流：彗核向阳面冰升华最强，自转把喷流拉成扇形亮纹；vOff 在光斑平面内，点积即向阳方向的投影
  float fan=max(dot(normalize(vOff+vec3(1e-6)),uSunward),0.);
  float jets=fan*fan*(.45+.55*snoise(vec3(atan(vUv.y,vUv.x)*4.,q*3.-uTime*.15,uTime*.05)))*exp(-q*5.)*.9;
  gl_FragColor=vec4((c*base+vec3(.92,1.,.96)*jets)*uI*(1.-smoothstep(.6,1.,q)),1.);
}`;
// 彗尾：沿曲线展开、面向相机的带。uv.y = t 从彗头到尾端，uv.x 为横向
// 离子尾（ION）：aK = 0 为主尾；aK ≥ 1 为射线——从彗头以不同方位角张开，随后折向主轴并行流向下游，缓慢摆动
// 尘埃尾：沿轨道向后弯曲；vLead 为朝运动方向一侧的横向坐标（前缘更亮、更锐利）
export const TAIL_VERT = /* glsl */ `${LOGV}
attribute float aK;
uniform vec3 uP0,uAway,uBack,uVel;uniform float uLen,uCurve,uW0,uW1,uTime;varying vec2 vUv;varying float vK,vLead;
void main(){
  vUv=uv;vK=aK;float t=uv.y,s=uv.x*2.-1.;
  vec3 p=uP0+(uAway*t+uBack*t*t*uCurve)*uLen;
  vec3 tg=normalize(uAway+uBack*2.*t*uCurve);
  float w=mix(uW0,uW1,t);
  #ifdef ION
  if(aK>0.){
    vec3 e1=normalize(cross(uAway,abs(uAway.y)<.9?vec3(0.,1.,0.):vec3(1.,0.,0.))),e2=cross(uAway,e1);
    float h=fract(sin(aK*12.9898)*43758.5453),a=aK*2.39996+uTime*.03*(h-.5);
    vec3 d=e1*cos(a)+e2*sin(a);
    p+=(d*(.04+.06*h)*t/(1.+4.*t)+cross(uAway,d)*sin(t*9.-uTime*(.5+.4*h)+h*6.28)*.012*t)*uLen;
    w*=.22+.1*h;
  }
  #endif
  vec3 sd=cross(tg,cameraPosition-p);
  sd=length(sd)>1e-9?normalize(sd):vec3(0.);
  vLead=s*(dot(sd,uVel)<0.?-1.:1.);
  p+=sd*s*w*uLen;
  gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);
  #include <logdepthbuf_vertex>
}`;
export const TAIL_FRAG = /* glsl */ `${LOGF}
${NOISE}
uniform vec3 uColor;uniform float uI,uTime;varying vec2 vUv;varying float vK,vLead;
void main(){
  #include <logdepthbuf_fragment>
  float t=vUv.y,s=vUv.x*2.-1.;
  float fade=pow(max(1.-t,0.),1.5)*smoothstep(0.,.05,t);
  #ifdef ION
  // 等离子体团块沿尾向外流动；射线更细、亮度各异
  bool ray=vK>.5;
  float flow=.5+.5*snoise(vec3(s*(ray?1.5:6.)+vK*5.3,t*5.-uTime*.45,uTime*.04+vK));
  float prof=ray?exp(-s*s*4.)*(.3+.35*fract(sin(vK*78.233)*43758.5453)):exp(-s*s*3.5);
  vec3 c=uColor*prof*mix(.35,1.,flow);
  #else
  // 前缘（朝运动方向）锐利、后缘弥散；斜向的细条纹对应不同时刻抛出的尘埃（striae）
  float x=vLead-.2,prof=exp(-sq(x/(x>0.?.3:.8)));
  float st=.5+pow(abs(snoise(vec3(s*7.,t*4.-uTime*.12,uTime*.03))),.7);
  float stria=.85+.15*sin(t*28.+vLead*5.+snoise(vec3(t*2.,0.,uTime*.01))*3.);
  vec3 c=uColor*prof*mix(1.,st,.3)*stria;
  #endif
  gl_FragColor=vec4(c*uI*fade,1.);
}`;
// 尘埃粒子：沿尘埃尾曲线分布，横向铺在轨道面内（uBack 方向宽、法向薄），各自以不同速度缓慢向外漂移
export const DUST_VERT = /* glsl */ `${LOGV}
attribute vec4 aSeed;
uniform vec3 uP0,uAway,uBack,uColor;uniform float uLen,uCurve,uW1,uTime,uI,uPR;uniform vec2 uRes;varying vec3 vCol;
void main(){
  float t=fract(aSeed.x+uTime*(.004+.012*aSeed.y));
  float g=aSeed.z*2.-1.;g*=abs(g);
  vec3 n=cross(uAway,uBack);
  vec3 p=uP0+(uAway*t+uBack*t*t*uCurve)*uLen+(uBack*g*mix(.01,uW1,t)+n*(aSeed.w-.5)*mix(.006,uW1*.25,t))*uLen;
  gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);
  vCol=uColor*uI*pow(1.-t,1.3)*smoothstep(0.,.03,t)*(.3+.7*fract(aSeed.y*7.31));
  // 彗尾在屏幕上很短时，数千个定大小的点会叠在几个像素里、加法混合后亮成一块方斑：按彗尾的屏幕长度淡出，交给光带表现
  vCol*=smoothstep(150.,600.,uLen*projectionMatrix[1][1]*uRes.y*.5/gl_Position.w);
  gl_PointSize=uPR*(1.+aSeed.w);
  #include <logdepthbuf_vertex>
}`;
export const DUST_FRAG = /* glsl */ `${LOGF}
varying vec3 vCol;
void main(){
  #include <logdepthbuf_fragment>
  float d=length(gl_PointCoord-.5)*2.;
  gl_FragColor=vec4(vCol*max(1.-d*d,0.),1.);
}`;
