import json,subprocess,re,sys,os
d=os.path.dirname(os.path.abspath(__file__)); pdf=sys.argv[1]
heads=json.load(open(d+'/toc_heads.json',encoding='utf8'))
n=int(re.search(r'Pages:\s+(\d+)',subprocess.run(['pdfinfo',pdf],capture_output=True,text=True).stdout).group(1))
pages=[subprocess.run(['pdftotext','-f',str(i),'-l',str(i),'-layout',pdf,'-'],capture_output=True,text=True).stdout for i in range(1,n+1)]
norm=lambda s:re.sub(r'\s+',' ',s).strip().lower()
pages=[norm(p) for p in pages]
# первая страница после содержания: где встречается «предисловие» как заголовок (после страницы с «содержание»)
cur=0; res={}
for i,(l,t) in enumerate(heads):
    key=norm(t)[:45]; found=None
    for p in range(max(cur,0),n):
        if p<=1 and l!=1: continue
        txt=pages[p]
        # пропускаем страницы содержания: там много точек
        if txt.count('. . .')>3 or txt.count('....')>3: continue
        if key in txt: found=p; break
    if found is None: print('НЕ НАЙДЕН',t); continue
    cur=found; res[i]=found+1
json.dump(res,open(d+'/toc_pages.json','w'))
print('найдено',len(res),'из',len(heads))
